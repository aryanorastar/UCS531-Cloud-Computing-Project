"""Queue/poll answer jobs and run slow Bedrock generation outside API Gateway."""

import json
import os
import uuid

from botocore.exceptions import ClientError
from shared.common import (
    LOG,
    ApiError,
    api_handler,
    body,
    client,
    conditional_failure,
    owner_id,
    question_parameters,
    response,
    table,
    timestamp,
    validated_id,
)
from shared.rag import generate, ready_documents, retrieve


@api_handler
def api(event, context):
    owner = owner_id(event)
    if event.get("httpMethod") == "GET":
        job_id = validated_id((event.get("pathParameters") or {}).get("job_id"), "job_id")
        job = table("jobs").get_item(Key={"job_id": job_id}, ConsistentRead=True).get("Item")
        if not job or job["owner_id"] != owner or job["expires_at"] < timestamp():
            raise ApiError(404, "Answer job not found or expired.")
        fields = ["job_id", "status", "result", "error_message", "created_at", "updated_at"]
        return response(200, {key: job[key] for key in fields if key in job})
    question, document_id, top_k = question_parameters(body(event))
    ready_documents(owner, document_id)
    now = timestamp()
    job_id = uuid.uuid4().hex
    table("jobs").put_item(
        Item={
            "job_id": job_id,
            "owner_id": owner,
            "question": question,
            "document_id": document_id,
            "top_k": top_k,
            "status": "QUEUED",
            "created_at": now,
            "updated_at": now,
            "expires_at": now + 86400,
        },
        ConditionExpression="attribute_not_exists(job_id)",
    )
    try:
        client("sqs").send_message(
            QueueUrl=os.environ["ANSWER_QUEUE_URL"], MessageBody=json.dumps({"job_id": job_id})
        )
    except Exception:
        table("jobs").update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET #status = :failed, error_message = :message",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":failed": "FAILED",
                ":message": "Could not queue the answer. Submit a new request.",
            },
        )
        raise
    return response(202, {"job_id": job_id, "status": "QUEUED", "status_url": f"/answers/{job_id}"})


def run_job(record):
    job_id = validated_id(json.loads(record["body"])["job_id"], "job_id")
    job = table("jobs").get_item(Key={"job_id": job_id}, ConsistentRead=True).get("Item")
    if not job or job["status"] in ("COMPLETED", "FAILED"):
        return
    now = timestamp()
    if job["expires_at"] < now:
        finish_failed(job_id, "Answer job expired. Submit a new request.")
        return
    try:
        table("jobs").update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET #status = :generating, lease_until = :lease, updated_at = :now",
            ConditionExpression="#status = :queued OR (#status = :generating AND lease_until < :now)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":generating": "GENERATING",
                ":queued": "QUEUED",
                ":lease": now + 330,
                ":now": now,
            },
        )
    except ClientError as error:
        if conditional_failure(error):
            raise RuntimeError("Answer job is already being processed") from error
        raise
    try:
        # Ignore client-supplied top_chunks. Retrieve trusted text directly from storage.
        chunks = retrieve(job["question"], job["owner_id"], job.get("document_id"), int(job["top_k"]))
        result = generate(job["question"], chunks)
        from decimal import Decimal

        result = json.loads(json.dumps(result), parse_float=Decimal)
        table("jobs").update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET #status = :complete, #result = :result, updated_at = :now REMOVE lease_until",
            ExpressionAttributeNames={"#status": "status", "#result": "result"},
            ExpressionAttributeValues={":complete": "COMPLETED", ":result": result, ":now": timestamp()},
        )
    except ApiError as error:
        finish_failed(job_id, str(error))
    except Exception:
        attempts = int(record.get("attributes", {}).get("ApproximateReceiveCount", "1"))
        if attempts >= 3:
            finish_failed(
                job_id, "Answer generation failed repeatedly. Check Bedrock permissions, quotas, and logs."
            )
        else:
            table("jobs").update_item(
                Key={"job_id": job_id},
                UpdateExpression="SET #status = :queued, updated_at = :now REMOVE lease_until",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":queued": "QUEUED", ":now": timestamp()},
            )
        raise


def finish_failed(job_id, message):
    table("jobs").update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET #status = :failed, error_message = :message, updated_at = :now REMOVE lease_until",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":failed": "FAILED", ":message": message[:500], ":now": timestamp()},
    )


def lambda_handler(event, context):
    if "httpMethod" in event:
        return api(event, context)
    failures = []
    for record in event.get("Records", []):
        try:
            run_job(record)
        except Exception:
            LOG.exception("Answer queue record failed")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
