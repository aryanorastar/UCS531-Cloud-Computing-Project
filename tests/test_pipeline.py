import base64
import json
from urllib.parse import parse_qs, urlparse

import generate_answer
import generate_embeddings
import get_presigned_url
import handle_query
import handle_textract_result
import process_document_batch
import pytest
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from shared import common, rag

ARYAN = "arn:aws:iam::123456789012:user/aryan"
OTHER = "arn:aws:iam::123456789012:user/another-user"


def event(payload=None, *, method="POST", arn=ARYAN, **paths):
    return {
        "httpMethod": method,
        "body": json.dumps(payload or {}),
        "pathParameters": paths,
        "requestContext": {"identity": {"userArn": arn}},
    }


def decoded(result, expected=200):
    assert result["statusCode"] == expected, result
    return json.loads(result["body"])


def upload(aws, *, arn=ARYAN, payload=None):
    payload = aws["pdf"] if payload is None else payload
    registration = decoded(
        get_presigned_url.lambda_handler(
            event({"filename": "paper.pdf", "size_bytes": len(payload)}, arn=arn), None
        )
    )
    document = common.get_document(registration["document_id"])
    saved = aws["s3"].put_object(
        Bucket="test-rag-documents", Key=document["object_key"], Body=payload, ContentType="application/pdf"
    )
    s3_event = {
        "Records": [
            {
                "eventSource": "aws:s3",
                "s3": {
                    "bucket": {"name": "test-rag-documents"},
                    "object": {"key": document["object_key"], "versionId": saved["VersionId"]},
                },
            }
        ]
    }
    return registration, s3_event


def extract(aws, registration, s3_event):
    process_document_batch.lambda_handler(s3_event, None)
    document = common.get_document(registration["document_id"])
    message = {"JobId": document["textract_job_id"], "JobTag": document["document_id"], "Status": "SUCCEEDED"}
    notification = {"Records": [{"EventSource": "aws:sns", "Sns": {"Message": json.dumps(message)}}]}
    handle_textract_result.lambda_handler(notification, None)
    return notification


def stream(document_id):
    serializer = TypeSerializer()
    chunks = common.table("chunks").query(KeyConditionExpression=Key("document_id").eq(document_id))["Items"]
    return {
        "Records": [
            {
                "eventName": "INSERT",
                "dynamodb": {
                    "SequenceNumber": str(i + 1),
                    "NewImage": {key: serializer.serialize(value) for key, value in item.items()},
                },
            }
            for i, item in enumerate(chunks)
        ]
    }


def ready(aws, *, arn=ARYAN):
    registration, notification = upload(aws, arn=arn)
    extract(aws, registration, notification)
    records = stream(registration["document_id"])
    assert generate_embeddings.lambda_handler(records, None) == {"batchItemFailures": []}
    return registration["document_id"]


def test_full_sample_pdf_upload_to_answer(aws):
    registration, s3_event = upload(aws)
    document_id = registration["document_id"]
    assert common.get_document(document_id)["status"] == "AWAITING_UPLOAD"
    signed = parse_qs(urlparse(registration["upload_url"]).query)
    assert "content-length" in signed["X-Amz-SignedHeaders"][0]
    assert "content-type" in signed["X-Amz-SignedHeaders"][0]
    assert registration["upload_headers"]["Content-Length"] == str(len(aws["pdf"]))
    extraction_event = extract(aws, registration, s3_event)
    assert common.get_document(document_id)["status"] == "EMBEDDING"
    assert len(aws["textract"].results) == 2
    assert aws["textract"].results[1]["NextToken"] == "second"
    assert (
        aws["textract"].starts[0]["DocumentLocation"]["S3Object"]["Version"]
        == s3_event["Records"][0]["s3"]["object"]["versionId"]
    )
    records = stream(document_id)
    assert generate_embeddings.lambda_handler(records, None) == {"batchItemFailures": []}
    document = decoded(get_presigned_url.lambda_handler(event(method="GET", document_id=document_id), None))
    assert document["status"] == "READY"
    assert document["completed_chunks"] == document["total_chunks"] == 2
    retrieval = decoded(
        handle_query.lambda_handler(
            event({"question": "What is attention?", "document_id": document_id}), None
        )
    )
    assert retrieval["top_chunks"][0]["pages"] == [1]
    queued = decoded(
        generate_answer.lambda_handler(
            event(
                {
                    "question": "What is attention?",
                    "document_id": document_id,
                    "top_chunks": [{"text": "INJECTED CLIENT TEXT", "filename": "fake.pdf"}],
                }
            ),
            None,
        ),
        202,
    )
    received = common.client("sqs").receive_message(QueueUrl=aws["queue"])["Messages"][0]
    work = {
        "Records": [
            {
                "body": received["Body"],
                "messageId": received["MessageId"],
                "attributes": {"ApproximateReceiveCount": "1"},
            }
        ]
    }
    assert generate_answer.lambda_handler(work, None) == {"batchItemFailures": []}
    completed = decoded(generate_answer.lambda_handler(event(method="GET", job_id=queued["job_id"]), None))
    assert completed["status"] == "COMPLETED"
    assert completed["result"]["answer"]
    assert all(source["document_id"] == document_id for source in completed["result"]["sources"])
    assert "INJECTED CLIENT TEXT" not in aws["bedrock"].prompts[0]["messages"][0]["content"][0]["text"]
    assert generate_answer.lambda_handler(work, None) == {"batchItemFailures": []}
    assert len(aws["bedrock"].prompts) == 1
    process_document_batch.lambda_handler(s3_event, None)
    handle_textract_result.lambda_handler(extraction_event, None)
    generate_embeddings.lambda_handler(records, None)
    assert len(aws["textract"].starts) == 1
    assert common.get_document(document_id)["completed_chunks"] == 2


@pytest.mark.parametrize(
    "payload",
    [
        {"filename": "../a.pdf", "size_bytes": 10},
        {"filename": "paper.txt", "size_bytes": 10},
        {"filename": "paper.pdf", "size_bytes": True},
        {"filename": "paper.pdf", "size_bytes": 26214401},
        {"filename": "paper.pdf"},
        {"filename": "a\n.pdf", "size_bytes": 10},
    ],
)
def test_invalid_uploads_rejected(aws, payload):
    decoded(get_presigned_url.lambda_handler(event(payload), None), 400)
    assert common.table("documents").scan()["Count"] == 0


def test_invalid_json_and_authentication(aws):
    request = event()
    request["body"] = "not JSON"
    decoded(get_presigned_url.lambda_handler(request, None), 400)
    decoded(get_presigned_url.lambda_handler({"body": "{}"}, None), 401)
    request["body"] = base64.b64encode(b'{"filename":"a.pdf","size_bytes":10}').decode()
    request["isBase64Encoded"] = True
    decoded(get_presigned_url.lambda_handler(request, None))
    request["body"] = "!not-base64!"
    decoded(get_presigned_url.lambda_handler(request, None), 400)


def test_assumed_role_ownership_stable_across_sessions():
    one = common.owner_id(event(arn="arn:aws:sts::123456789012:assumed-role/demo-role/session-one"))
    two = common.owner_id(event(arn="arn:aws:sts::123456789012:assumed-role/demo-role/session-two"))
    assert one == two
    assert one != common.owner_id(event(arn=OTHER))


def test_document_and_job_isolation(aws):
    document_id = ready(aws)
    decoded(
        get_presigned_url.lambda_handler(event(method="GET", arn=OTHER, document_id=document_id), None), 404
    )
    decoded(
        handle_query.lambda_handler(
            event({"question": "attention", "document_id": document_id}, arn=OTHER), None
        ),
        404,
    )
    decoded(handle_query.lambda_handler(event({"question": "attention"}, arn=OTHER), None), 409)
    queued = decoded(
        generate_answer.lambda_handler(event({"question": "attention", "document_id": document_id}), None),
        202,
    )
    decoded(
        generate_answer.lambda_handler(event(method="GET", arn=OTHER, job_id=queued["job_id"]), None), 404
    )


def test_not_ready_document_rejected(aws):
    registration, _ = upload(aws)
    decoded(
        handle_query.lambda_handler(
            event({"question": "attention", "document_id": registration["document_id"]}), None
        ),
        409,
    )
    decoded(
        generate_answer.lambda_handler(
            event({"question": "attention", "document_id": registration["document_id"]}), None
        ),
        409,
    )


@pytest.mark.parametrize("payload", [b"this is not a pdf", b"%PDF-invalid-size"])
def test_invalid_pdf_and_mismatched_size_fail_before_textract(aws, payload):
    registration, s3_event = upload(aws, payload=payload)
    if payload.startswith(b"%PDF-"):
        common.table("documents").update_item(
            Key={"document_id": registration["document_id"]},
            UpdateExpression="SET expected_size = :size",
            ExpressionAttributeValues={":size": len(payload) + 1},
        )
    process_document_batch.lambda_handler(s3_event, None)
    assert common.get_document(registration["document_id"])["status"] == "FAILED"
    assert not aws["textract"].starts


def test_duplicate_extraction_preserves_completed_chunks(aws):
    registration, s3_event = upload(aws)
    notification = extract(aws, registration, s3_event)
    records = stream(registration["document_id"])
    generate_embeddings.lambda_handler({"Records": records["Records"][:1]}, None)
    handle_textract_result.lambda_handler(notification, None)
    assert common.get_document(registration["document_id"])["completed_chunks"] == 1
    first = common.table("chunks").get_item(
        Key={"document_id": registration["document_id"], "chunk_id": "000000"}
    )["Item"]
    assert first["status"] == "COMPLETED"
    generate_embeddings.lambda_handler(records, None)
    assert common.get_document(registration["document_id"])["completed_chunks"] == 2


def test_embedding_retry_and_bounded_failure(aws):
    registration, s3_event = upload(aws)
    extract(aws, registration, s3_event)
    first = {"Records": stream(registration["document_id"])["Records"][:1]}
    aws["bedrock"].fail = True
    expected = {"batchItemFailures": [{"itemIdentifier": "1"}]}
    assert generate_embeddings.lambda_handler(first, None) == expected
    aws["bedrock"].fail = False
    assert generate_embeddings.lambda_handler(first, None) == {"batchItemFailures": []}
    assert common.get_document(registration["document_id"])["completed_chunks"] == 1
    second = {"Records": stream(registration["document_id"])["Records"][1:]}
    aws["bedrock"].fail = True
    for _ in range(3):
        assert generate_embeddings.lambda_handler(second, None)["batchItemFailures"]
    assert common.get_document(registration["document_id"])["status"] == "FAILED"


def test_answer_retries_and_failure_visible(aws):
    document_id = ready(aws)
    queued = decoded(
        generate_answer.lambda_handler(event({"question": "attention", "document_id": document_id}), None),
        202,
    )
    aws["bedrock"].fail = True
    for count in [1, 2, 3]:
        work = {
            "Records": [
                {
                    "body": json.dumps({"job_id": queued["job_id"]}),
                    "messageId": "message",
                    "attributes": {"ApproximateReceiveCount": str(count)},
                }
            ]
        }
        assert generate_answer.lambda_handler(work, None)["batchItemFailures"]
    assert common.table("jobs").get_item(Key={"job_id": queued["job_id"]})["Item"]["status"] == "FAILED"


def test_pagination_with_empty_first_page():
    class Pages:
        def __init__(self):
            self.calls = []

        def query(self, **request):
            self.calls.append(dict(request))
            return (
                {"Items": [2, 3]}
                if request.get("ExclusiveStartKey")
                else {"Items": [], "LastEvaluatedKey": {"document_id": "cursor"}}
            )

    pages = Pages()
    assert list(common.all_items(pages)) == [2, 3]
    assert pages.calls[1]["ExclusiveStartKey"] == {"document_id": "cursor"}


def test_retrieval_limit_and_model_mismatch(aws, monkeypatch):
    document_id = ready(aws)
    monkeypatch.setenv("MAX_RETRIEVAL_CHUNKS", "1")
    decoded(
        handle_query.lambda_handler(event({"question": "attention", "document_id": document_id}), None), 413
    )
    monkeypatch.setenv("MAX_RETRIEVAL_CHUNKS", "2500")
    monkeypatch.setenv("EMBEDDING_MODEL_ID", "different-model")
    decoded(
        handle_query.lambda_handler(event({"question": "attention", "document_id": document_id}), None), 409
    )


def test_chunk_overlap_and_cosine_dimension_guards():
    text = " ".join(f"word{i}" for i in range(60))
    chunks = list(handle_textract_result.split_page(text, size=80, overlap=20))
    assert chunks[0].startswith("word0") and chunks[-1].endswith("word59")
    assert all(0 < len(chunk) <= 80 for chunk in chunks)
    with pytest.raises(ValueError):
        list(handle_textract_result.split_page(text, size=20, overlap=20))
    with pytest.raises(ValueError):
        rag.cosine([1, 0], [1])
