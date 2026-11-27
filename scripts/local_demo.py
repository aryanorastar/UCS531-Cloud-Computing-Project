"""Run the real Lambda pipeline locally against a PDF with simulated AWS services.

Moto supplies S3, DynamoDB, and SQS. pypdf stands in for Textract; deterministic
text vectors and an extractive answer stand in for Bedrock. No AWS account is used.
"""

import argparse
import hashlib
import io
import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from moto import mock_aws
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lambda_functions"))

import generate_answer  # noqa: E402
import generate_embeddings  # noqa: E402
import get_presigned_url  # noqa: E402
import handle_query  # noqa: E402
import handle_textract_result  # noqa: E402
import process_document_batch  # noqa: E402
from shared import common, rag  # noqa: E402

OWNER = "arn:aws:iam::123456789012:user/lab-presenter"
OTHER_OWNER = "arn:aws:iam::123456789012:user/another-student"
DEFAULT_PDF = ROOT / "pdfs" / "Attention Is All You Need.pdf"
DEFAULT_QUESTION = "What do the authors propose instead of recurrence?"
STOPWORDS = frozenset(
    "a an and are as at be by do does for from how in into is it of on or that the this to use uses what with".split()
)


def tokens(text):
    return [word for word in re.findall(r"[a-z][a-z0-9-]{2,}", text.lower()) if word not in STOPWORDS]


def best_sentence(text, question):
    query_words = set(tokens(question))
    best = (0, "")
    for sentence in re.split(r"(?<=[.!?])\s+", " ".join(text.split())):
        overlap = len(query_words.intersection(tokens(sentence)))
        if overlap > best[0] and 35 <= len(sentence) <= 450:
            best = (overlap, sentence)
    return best


class DemoBedrock:
    """Deterministic local substitutes; results are not Titan or DeepSeek output."""

    def invoke_model(self, **request):
        payload = json.loads(request["body"])
        dimensions = payload["dimensions"]
        vector = [0.0] * dimensions
        for word, count in Counter(tokens(payload["inputText"])).items():
            digest = hashlib.blake2b(word.encode(), digest_size=8).digest()
            index = int.from_bytes(digest, "big") % dimensions
            vector[index] += 1.0 + math.log(count)
        norm = math.sqrt(sum(value * value for value in vector))
        if norm:
            vector = [value / norm for value in vector]
        return {"body": io.BytesIO(json.dumps({"embedding": vector}).encode())}

    def converse(self, **request):
        prompt = request["messages"][0]["content"][0]["text"]
        question = prompt.split("QUESTION:\n", 1)[1].split("\n\nDOCUMENT EXCERPTS:\n", 1)[0]
        passages = prompt.split("\n\nDOCUMENT EXCERPTS:\n", 1)[1]
        best = (0, "", "")
        for match in re.finditer(r"(?m)^\[S(\d+)\] Document:.*\n", passages):
            end = passages.find("\n\n[S", match.end())
            excerpt = passages[match.end() : end if end >= 0 else None]
            overlap, sentence = best_sentence(excerpt, question)
            if overlap > best[0]:
                best = (overlap, sentence, match.group(1))
        if best[0] == 0:
            answer = "The retrieved excerpts do not provide enough evidence to answer this question."
        else:
            answer = f"{best[1]} [S{best[2]}]"
        return {"output": {"message": {"content": [{"text": answer}]}}}


class DemoTextract:
    """Expose pypdf's actual extracted lines through the Textract result contract."""

    def __init__(self, pdf_bytes):
        reader = PdfReader(io.BytesIO(pdf_bytes))
        self.pages = []
        for number, page in enumerate(reader.pages, 1):
            lines = [line.strip() for line in (page.extract_text() or "").splitlines() if line.strip()]
            self.pages.append([{"BlockType": "LINE", "Page": number, "Text": line} for line in lines])
        if not any(self.pages):
            raise ValueError("This local demo needs a text-based PDF; live Textract can OCR scanned PDFs.")
        self.job_id = None

    def start_document_text_detection(self, **request):
        self.job_id = "job-" + request["ClientRequestToken"][:32]
        return {"JobId": self.job_id}

    def get_document_text_detection(self, **request):
        if request["JobId"] != self.job_id:
            raise ValueError("Unknown local extraction job")
        index = int(request.get("NextToken", "0"))
        result = {
            "JobStatus": "SUCCEEDED",
            "DocumentMetadata": {"Pages": len(self.pages)},
            "Blocks": self.pages[index],
        }
        if index + 1 < len(self.pages):
            result["NextToken"] = str(index + 1)
        return result


def api_event(payload=None, *, method="POST", owner=OWNER, **path):
    return {
        "httpMethod": method,
        "body": json.dumps(payload or {}),
        "pathParameters": path,
        "requestContext": {"identity": {"userArn": owner}},
    }


def api_data(result, status=200):
    if result["statusCode"] != status:
        raise RuntimeError(f"Expected HTTP {status}; got {result['statusCode']}: {result['body']}")
    return json.loads(result["body"])


def create_tables():
    db = boto3.client("dynamodb", region_name="us-east-1")
    db.create_table(
        TableName="documents",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "document_id", "AttributeType": "S"},
            {"AttributeName": "owner_id", "AttributeType": "S"},
            {"AttributeName": "created_at", "AttributeType": "N"},
        ],
        KeySchema=[{"AttributeName": "document_id", "KeyType": "HASH"}],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "OwnerIndex",
                "KeySchema": [
                    {"AttributeName": "owner_id", "KeyType": "HASH"},
                    {"AttributeName": "created_at", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )
    db.create_table(
        TableName="chunks",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "document_id", "AttributeType": "S"},
            {"AttributeName": "chunk_id", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "document_id", "KeyType": "HASH"},
            {"AttributeName": "chunk_id", "KeyType": "RANGE"},
        ],
    )
    db.create_table(
        TableName="jobs",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "job_id", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "job_id", "KeyType": "HASH"}],
    )


def run(pdf=DEFAULT_PDF, question=DEFAULT_QUESTION):
    pdf = Path(pdf)
    payload = pdf.read_bytes()
    if pdf.suffix.lower() != ".pdf" or not payload.startswith(b"%PDF-"):
        raise ValueError("Choose a valid PDF file")
    textract = DemoTextract(payload)
    env = {
        "AWS_ACCESS_KEY_ID": "local-demo",
        "AWS_SECRET_ACCESS_KEY": "local-demo",
        "AWS_SESSION_TOKEN": "local-demo",
        "AWS_REGION": "us-east-1",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_EC2_METADATA_DISABLED": "true",
        "DOCUMENTS_TABLE": "documents",
        "CHUNKS_TABLE": "chunks",
        "JOBS_TABLE": "jobs",
        "DOCUMENTS_BUCKET": "local-demo-documents",
        "TEXTRACT_TOPIC_ARN": "arn:aws:sns:us-east-1:123456789012:local-demo",
        "TEXTRACT_ROLE_ARN": "arn:aws:iam::123456789012:role/local-demo",
        "EMBEDDING_DIMENSIONS": "256",
        "EMBEDDING_MODEL_ID": "local-hash-vector-v1",
        "GENERATION_MODEL_ID": "local-extractive-answer-v1",
    }
    with mock_aws(), patch.dict(os.environ, env):
        common.client.cache_clear()
        common.dynamodb.cache_clear()
        create_tables()
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket=env["DOCUMENTS_BUCKET"])
        s3.put_bucket_versioning(
            Bucket=env["DOCUMENTS_BUCKET"], VersioningConfiguration={"Status": "Enabled"}
        )
        queue = boto3.client("sqs", region_name="us-east-1").create_queue(QueueName="local-demo-answers")
        os.environ["ANSWER_QUEUE_URL"] = queue["QueueUrl"]
        real_client = common.client
        bedrock = DemoBedrock()
        with (
            patch.object(
                rag,
                "client",
                side_effect=lambda service, **options: (
                    bedrock if service == "bedrock-runtime" else real_client(service, **options)
                ),
            ),
            patch.object(
                process_document_batch,
                "client",
                side_effect=lambda service, **options: (
                    textract if service == "textract" else real_client(service, **options)
                ),
            ),
            patch.object(
                handle_textract_result,
                "client",
                side_effect=lambda service, **options: (
                    textract if service == "textract" else real_client(service, **options)
                ),
            ),
        ):
            print("LOCAL SIMULATION — actual PDF text; no AWS account, Textract, Titan, or DeepSeek calls")
            registration = api_data(
                get_presigned_url.lambda_handler(
                    api_event({"filename": pdf.name, "size_bytes": len(payload)}), None
                )
            )
            document_id = registration["document_id"]
            document = common.get_document(document_id)
            print(f"1. Registered {pdf.name}: {document['status']} ({document_id})")

            saved = s3.put_object(
                Bucket=env["DOCUMENTS_BUCKET"],
                Key=document["object_key"],
                Body=payload,
                ContentType="application/pdf",
            )
            s3_event = {
                "Records": [
                    {
                        "eventSource": "aws:s3",
                        "s3": {
                            "bucket": {"name": env["DOCUMENTS_BUCKET"]},
                            "object": {"key": document["object_key"], "versionId": saved["VersionId"]},
                        },
                    }
                ]
            }
            process_document_batch.lambda_handler(s3_event, None)
            document = common.get_document(document_id)
            if document["status"] != "EXTRACTING":
                raise RuntimeError(f"Expected EXTRACTING, got {document['status']}")
            print(f"2. S3 version validated; extraction started: {document['status']}")

            notification = {
                "Records": [
                    {
                        "EventSource": "aws:sns",
                        "Sns": {
                            "Message": json.dumps(
                                {"JobId": textract.job_id, "JobTag": document_id, "Status": "SUCCEEDED"}
                            )
                        },
                    }
                ]
            }
            handle_textract_result.lambda_handler(notification, None)
            document = common.get_document(document_id)
            if document["status"] != "EMBEDDING":
                raise RuntimeError(f"Expected EMBEDDING, got {document['status']}")
            print(
                f"3. Parsed {len(textract.pages)} PDF pages into {document['total_chunks']} chunks: EMBEDDING"
            )

            chunks = common.table("chunks").query(KeyConditionExpression=Key("document_id").eq(document_id))[
                "Items"
            ]
            serializer = TypeSerializer()
            stream = {
                "Records": [
                    {
                        "eventName": "INSERT",
                        "dynamodb": {
                            "SequenceNumber": str(index + 1),
                            "NewImage": {key: serializer.serialize(value) for key, value in chunk.items()},
                        },
                    }
                    for index, chunk in enumerate(chunks)
                ]
            }
            failures = generate_embeddings.lambda_handler(stream, None)["batchItemFailures"]
            document = api_data(
                get_presigned_url.lambda_handler(api_event(method="GET", document_id=document_id), None)
            )
            if failures or document["status"] != "READY":
                raise RuntimeError(f"Indexing failed: {failures}; document status is {document['status']}")
            print(f"4. Indexed {document['completed_chunks']}/{document['total_chunks']} chunks: READY")

            retrieval = api_data(
                handle_query.lambda_handler(
                    api_event({"question": question, "document_id": document_id, "top_k": 3}), None
                )
            )
            print(f"5. Retrieved {len(retrieval['top_chunks'])} passages for: {question}")
            for index, chunk in enumerate(retrieval["top_chunks"], 1):
                excerpt = (best_sentence(chunk["text"], question)[1] or " ".join(chunk["text"].split()))[:130]
                print(
                    f"   S{index} · page {chunk['pages'][0]} · score {chunk['similarity_score']:.3f} · {excerpt}…"
                )

            queued = api_data(
                generate_answer.lambda_handler(
                    api_event({"question": question, "document_id": document_id, "top_k": 3}), None
                ),
                202,
            )
            message = boto3.client("sqs", region_name="us-east-1").receive_message(
                QueueUrl=queue["QueueUrl"]
            )["Messages"][0]
            work = {
                "Records": [
                    {
                        "body": message["Body"],
                        "messageId": message["MessageId"],
                        "attributes": {"ApproximateReceiveCount": "1"},
                    }
                ]
            }
            failures = generate_answer.lambda_handler(work, None)["batchItemFailures"]
            answer = api_data(
                generate_answer.lambda_handler(api_event(method="GET", job_id=queued["job_id"]), None)
            )
            if failures or answer["status"] != "COMPLETED":
                raise RuntimeError(f"Answer job failed: {failures}; status is {answer['status']}")
            print("6. Queued and completed answer job (deterministic extractive stand-in):")
            print(f"   {answer['result']['answer']}")
            print(
                "   Sources: "
                + ", ".join(
                    f"{source['source_id']} p.{source['pages'][0]}" for source in answer["result"]["sources"]
                )
            )

            denied = api_data(
                get_presigned_url.lambda_handler(
                    api_event(method="GET", owner=OTHER_OWNER, document_id=document_id), None
                ),
                404,
            )
            print(f"7. Another IAM identity cannot read the document: HTTP 404 ({denied['error']})")
            return {"document": document, "retrieval": retrieval, "answer": answer}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--question", default=DEFAULT_QUESTION)
    args = parser.parse_args()
    run(args.pdf, args.question)


if __name__ == "__main__":
    main()
