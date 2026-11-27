"""AWS clients, API contracts, ownership, and document lifecycle helpers."""

import base64
import binascii
import hashlib
import json
import logging
import os
import re
import time
from decimal import Decimal
from functools import lru_cache, wraps

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)
ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")


class ApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


@lru_cache
def client(service, *, read_timeout=15, attempts=3):
    options = {"signature_version": "s3v4"} if service == "s3" else {}
    return boto3.client(
        service,
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        config=Config(
            connect_timeout=3,
            read_timeout=read_timeout,
            retries={"mode": "standard", "total_max_attempts": attempts},
            **options,
        ),
    )


@lru_cache
def dynamodb():
    return boto3.resource(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        config=Config(
            connect_timeout=3, read_timeout=10, retries={"mode": "standard", "total_max_attempts": 3}
        ),
    )


def table(kind):
    return dynamodb().Table(os.environ[f"{kind.upper()}_TABLE"])


def timestamp():
    return int(time.time())


def json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral() else float(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def response(status, data):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(data, default=json_default, allow_nan=False),
    }


def api_handler(function):
    @wraps(function)
    def wrapped(event, context):
        try:
            return function(event, context)
        except ApiError as error:
            return response(error.status, {"error": str(error)})
        except (ClientError, BotoCoreError):
            LOG.exception("AWS service call failed")
            return response(
                503, {"error": "An AWS service is unavailable. Retry later or check the deployment logs."}
            )
        except Exception:
            LOG.exception("API handler failed")
            return response(500, {"error": "The request failed. Check the deployment logs."})

    return wrapped


def body(event):
    raw = event.get("body") or "{}"
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        if not isinstance(raw, dict):
            if len(raw) > 65536:
                raise ApiError(413, "Request body is too large.")
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            raise ValueError("object required")
        return raw
    except (ValueError, TypeError, UnicodeError, binascii.Error) as error:
        raise ApiError(400, "Send a JSON object as the request body.") from error


def owner_id(event):
    """Keep an assumed role's owner stable across STS session names."""
    identity = event.get("requestContext", {}).get("identity", {})
    arn = identity.get("userArn", "")
    if not arn.startswith("arn:"):
        raise ApiError(401, "Use an AWS IAM signed request.")
    parts = arn.split(":", 5)
    if len(parts) != 6:
        raise ApiError(401, "Invalid AWS caller identity.")
    if parts[2] == "sts" and parts[5].startswith("assumed-role/"):
        resource = parts[5].split("/")
        arn = f"{parts[0]}:{parts[1]}:iam::{parts[4]}:role/{resource[1]}"
    return hashlib.sha256(arn.encode()).hexdigest()


def validated_id(value, name="document_id"):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ApiError(400, f"{name} must be a 32-character document/job ID.")
    return value


def question_parameters(data):
    question = data.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > 2000:
        raise ApiError(400, "question must contain 1–2000 characters.")
    top_k = data.get("top_k", 5)
    if type(top_k) is not int or not 1 <= top_k <= 10:
        raise ApiError(400, "top_k must be an integer from 1 to 10.")
    document_id = data.get("document_id")
    if document_id is not None:
        validated_id(document_id)
    return question.strip(), document_id, top_k


def get_document(document_id, owner=None):
    validated_id(document_id)
    item = table("documents").get_item(Key={"document_id": document_id}, ConsistentRead=True).get("Item")
    if not item or (owner is not None and item["owner_id"] != owner):
        raise ApiError(404, "Document not found.")
    return item


def conditional_failure(error):
    return (
        isinstance(error, ClientError)
        and error.response["Error"]["Code"] == "ConditionalCheckFailedException"
    )


def fail_document(document_id, message):
    try:
        table("documents").update_item(
            Key={"document_id": document_id},
            UpdateExpression="SET #status = :failed, error_message = :message, updated_at = :now",
            ConditionExpression="attribute_exists(document_id) AND #status <> :ready",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":failed": "FAILED",
                ":ready": "READY",
                ":message": message[:500],
                ":now": timestamp(),
            },
        )
    except ClientError as error:
        if not conditional_failure(error):
            raise


def mark_ready(document_id):
    try:
        table("documents").update_item(
            Key={"document_id": document_id},
            UpdateExpression="SET #status = :ready, updated_at = :now REMOVE error_message",
            ConditionExpression="#status = :embedding AND completed_chunks = total_chunks AND total_chunks > :zero",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":ready": "READY",
                ":embedding": "EMBEDDING",
                ":now": timestamp(),
                ":zero": 0,
            },
        )
    except ClientError as error:
        if not conditional_failure(error):
            raise


def all_items(table_object, **query):
    while True:
        page = table_object.query(**query)
        yield from page.get("Items", [])
        if not page.get("LastEvaluatedKey"):
            return
        query["ExclusiveStartKey"] = page["LastEvaluatedKey"]
