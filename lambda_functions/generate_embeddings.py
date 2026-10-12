"""DynamoDB stream consumer with atomic chunk completion and document counters."""

import os
from decimal import Decimal

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError
from shared.common import (
    LOG,
    client,
    conditional_failure,
    fail_document,
    get_document,
    mark_ready,
    table,
    timestamp,
)
from shared.rag import embedding

SERIALIZER = TypeSerializer()
DESERIALIZER = TypeDeserializer()


def serialize(values):
    return {key: SERIALIZER.serialize(value) for key, value in values.items()}


def process_chunk(image):
    key = {"document_id": image["document_id"], "chunk_id": image["chunk_id"]}
    chunk = table("chunks").get_item(Key=key, ConsistentRead=True).get("Item")
    if not chunk or chunk["status"] == "COMPLETED":
        if chunk:
            mark_ready(chunk["document_id"])
        return
    if chunk["status"] == "FAILED":
        raise ValueError("Chunk exhausted its embedding attempts")
    if get_document(chunk["document_id"])["status"] == "FAILED":
        return
    try:
        vector = embedding(chunk["text"])
        now = timestamp()
        client("dynamodb").transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": os.environ["CHUNKS_TABLE"],
                        "Key": serialize(key),
                        "UpdateExpression": "SET embedding = :vector, embedding_model = :model, embedding_dimensions = :dimensions, #status = :complete, updated_at = :now",
                        "ConditionExpression": "#status = :pending",
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": serialize(
                            {
                                ":vector": [Decimal(str(v)) for v in vector],
                                ":model": os.environ.get(
                                    "EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0"
                                ),
                                ":complete": "COMPLETED",
                                ":dimensions": len(vector),
                                ":pending": "PENDING",
                                ":now": now,
                            }
                        ),
                    }
                },
                {
                    "Update": {
                        "TableName": os.environ["DOCUMENTS_TABLE"],
                        "Key": serialize({"document_id": chunk["document_id"]}),
                        "UpdateExpression": "SET updated_at = :now ADD completed_chunks :one",
                        "ConditionExpression": "#status = :embedding",
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": serialize(
                            {":one": 1, ":now": now, ":embedding": "EMBEDDING"}
                        ),
                    }
                },
            ]
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "TransactionCanceledException":
            current = table("chunks").get_item(Key=key, ConsistentRead=True).get("Item", {})
            if current.get("status") == "COMPLETED":
                mark_ready(chunk["document_id"])
                return
        record_failure(key)
        raise
    except Exception:
        record_failure(key)
        raise
    mark_ready(chunk["document_id"])


def record_failure(key):
    try:
        result = table("chunks").update_item(
            Key=key,
            UpdateExpression="ADD attempts :one",
            ConditionExpression="#status = :pending",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":one": 1, ":pending": "PENDING"},
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as error:
        if conditional_failure(error):
            return
        raise
    if int(result["attempts"]) >= int(os.environ.get("MAX_EMBEDDING_ATTEMPTS", "3")):
        try:
            table("chunks").update_item(
                Key=key,
                UpdateExpression="SET #status = :failed",
                ConditionExpression="#status = :pending",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":failed": "FAILED", ":pending": "PENDING"},
            )
        except ClientError as error:
            if conditional_failure(error):
                return
            raise
        fail_document(
            key["document_id"],
            "Embedding failed after repeated attempts. Check Bedrock permissions, quotas, and failure logs.",
        )


def lambda_handler(event, context):
    failures = []
    for record in event.get("Records", []):
        if record.get("eventName") != "INSERT":
            continue
        try:
            image = {
                key: DESERIALIZER.deserialize(value) for key, value in record["dynamodb"]["NewImage"].items()
            }
            if image.get("status") == "PENDING":
                process_chunk(image)
        except Exception:
            LOG.exception("Embedding stream record failed")
            failures.append({"itemIdentifier": record["dynamodb"]["SequenceNumber"]})
    return {"batchItemFailures": failures}
