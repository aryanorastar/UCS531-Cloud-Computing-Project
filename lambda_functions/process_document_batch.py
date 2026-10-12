"""Validate an immutable S3 upload version and start an idempotent Textract job."""

import hashlib
import os
from urllib.parse import unquote_plus

from botocore.exceptions import ClientError
from shared.common import LOG, client, conditional_failure, fail_document, get_document, table, timestamp


def process_record(record):
    bucket = record["s3"]["bucket"]["name"]
    obj = record["s3"]["object"]
    key = unquote_plus(obj["key"])
    if bucket != os.environ["DOCUMENTS_BUCKET"] or not key.startswith("uploads/") or not key.endswith(".pdf"):
        return
    parts = key.split("/")
    if len(parts) != 4:
        return
    document_id = parts[2]
    document = get_document(document_id)
    if document["object_key"] != key or document["owner_id"] != parts[1]:
        raise ValueError("Upload key does not match registered document")
    if document.get("textract_job_id") or document["status"] in ("EMBEDDING", "READY", "FAILED"):
        return
    version = obj.get("versionId")
    if not version:
        raise ValueError("S3 bucket versioning must be enabled")
    if document.get("s3_version") and document["s3_version"] != version:
        return
    params = {"Bucket": bucket, "Key": key, "VersionId": version}
    head = client("s3").head_object(**params)
    if head["ContentLength"] != document["expected_size"] or head["ContentLength"] > int(
        os.environ.get("MAX_UPLOAD_BYTES", "26214400")
    ):
        fail_document(document_id, "Uploaded file size does not match the registered PDF.")
        return
    header = client("s3").get_object(**params, Range="bytes=0-4")["Body"].read()
    if header != b"%PDF-":
        fail_document(document_id, "Uploaded file is not a PDF.")
        return
    try:
        table("documents").update_item(
            Key={"document_id": document_id},
            UpdateExpression="SET #status = :extracting, s3_version = :version, updated_at = :now",
            ConditionExpression="#status IN (:awaiting, :extracting) AND (attribute_not_exists(s3_version) OR s3_version = :version)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":awaiting": "AWAITING_UPLOAD",
                ":extracting": "EXTRACTING",
                ":version": version,
                ":now": timestamp(),
            },
        )
    except ClientError as error:
        if conditional_failure(error):
            return
        raise
    token = hashlib.sha256(f"{document_id}:{version}".encode()).hexdigest()
    try:
        job = client("textract").start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key, "Version": version}},
            ClientRequestToken=token,
            JobTag=document_id,
            NotificationChannel={
                "SNSTopicArn": os.environ["TEXTRACT_TOPIC_ARN"],
                "RoleArn": os.environ["TEXTRACT_ROLE_ARN"],
            },
        )
    except ClientError as error:
        if error.response["Error"]["Code"] in {
            "AccessDeniedException",
            "InvalidS3ObjectException",
            "UnsupportedDocumentException",
            "BadDocumentException",
            "DocumentTooLargeException",
            "InvalidParameterException",
        }:
            LOG.exception("Extraction could not start for document %s", document_id)
            fail_document(
                document_id,
                "Extraction could not start. Check the PDF and the deployment's Textract/S3 permissions.",
            )
            return
        raise
    table("documents").update_item(
        Key={"document_id": document_id},
        UpdateExpression="SET textract_job_id = :job, updated_at = :now",
        ConditionExpression="s3_version = :version",
        ExpressionAttributeValues={":job": job["JobId"], ":version": version, ":now": timestamp()},
    )
    LOG.info("Started extraction for document %s", document_id)


def lambda_handler(event, context):
    for record in event.get("Records", []):
        if record.get("eventSource") == "aws:s3":
            process_record(record)
    return {"processed": len(event.get("Records", []))}
