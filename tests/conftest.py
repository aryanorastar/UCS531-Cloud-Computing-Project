import io
import json
from pathlib import Path

import boto3
import process_document_batch
import pytest
from moto import mock_aws
from shared import common, rag


class Bedrock:
    fail = False
    prompts = []

    def invoke_model(self, **request):
        if self.fail:
            raise RuntimeError("simulated Bedrock outage")
        payload = json.loads(request["body"])
        text = payload["inputText"].lower()
        features = [1.0, 0.0, 0.0] if "attention" in text or "transformer" in text else [0.0, 1.0, 0.0]
        vector = features + [0.0] * (payload["dimensions"] - 3)
        return {"body": io.BytesIO(json.dumps({"embedding": vector}).encode())}

    def converse(self, **request):
        if self.fail:
            raise RuntimeError("simulated Bedrock outage")
        self.prompts.append(request)
        return {
            "output": {
                "message": {
                    "content": [
                        {"text": "The Transformer uses encoder and decoder layers with attention [S1]."}
                    ]
                }
            }
        }


class Textract:
    def __init__(self):
        self.starts = []
        self.results = []
        self.pages = [
            {
                "JobStatus": "SUCCEEDED",
                "DocumentMetadata": {"Pages": 2},
                "Blocks": [
                    {
                        "BlockType": "LINE",
                        "Page": 1,
                        "Text": "The Transformer uses encoder and decoder layers with multi-head attention.",
                    }
                ],
                "NextToken": "second",
            },
            {
                "JobStatus": "SUCCEEDED",
                "DocumentMetadata": {"Pages": 2},
                "Blocks": [
                    {
                        "BlockType": "LINE",
                        "Page": 2,
                        "Text": "Attention replaces recurrence in the model architecture.",
                    }
                ],
            },
        ]

    def start_document_text_detection(self, **request):
        self.starts.append(request)
        return {"JobId": "job-" + request["ClientRequestToken"][:32]}

    def get_document_text_detection(self, **request):
        self.results.append(request)
        return self.pages[1 if request.get("NextToken") else 0]


@pytest.fixture
def aws(monkeypatch):
    for key, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_REGION": "us-east-1",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_EC2_METADATA_DISABLED": "true",
        "DOCUMENTS_TABLE": "documents",
        "CHUNKS_TABLE": "chunks",
        "JOBS_TABLE": "jobs",
        "DOCUMENTS_BUCKET": "test-rag-documents",
        "TEXTRACT_TOPIC_ARN": "arn:aws:sns:us-east-1:123456789012:extract",
        "TEXTRACT_ROLE_ARN": "arn:aws:iam::123456789012:role/textract",
        "EMBEDDING_DIMENSIONS": "256",
        "EMBEDDING_MODEL_ID": "amazon.titan-embed-text-v2:0",
        "GENERATION_MODEL_ID": "us.amazon.nova-2-lite-v1:0",
    }.items():
        monkeypatch.setenv(key, value)
    common.client.cache_clear()
    common.dynamodb.cache_clear()
    with mock_aws():
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
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="test-rag-documents")
        s3.put_bucket_versioning(Bucket="test-rag-documents", VersioningConfiguration={"Status": "Enabled"})
        queue = boto3.client("sqs", region_name="us-east-1").create_queue(QueueName="answers")["QueueUrl"]
        monkeypatch.setenv("ANSWER_QUEUE_URL", queue)
        model = Bedrock()
        model.prompts = []
        textract = Textract()
        real_client = common.client
        monkeypatch.setattr(
            rag,
            "client",
            lambda service, **options: (
                model if service == "bedrock-runtime" else real_client(service, **options)
            ),
        )
        monkeypatch.setattr(
            process_document_batch,
            "client",
            lambda service, **options: textract if service == "textract" else real_client(service, **options),
        )
        import handle_textract_result

        monkeypatch.setattr(
            handle_textract_result,
            "client",
            lambda service, **options: textract if service == "textract" else real_client(service, **options),
        )
        yield {
            "s3": s3,
            "queue": queue,
            "bedrock": model,
            "textract": textract,
            "pdf": (Path(__file__).resolve().parents[1] / "pdfs/Attention Is All You Need.pdf").read_bytes(),
        }
    common.client.cache_clear()
    common.dynamodb.cache_clear()
