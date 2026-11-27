"""Validate an immutable upload, then use Textract or its text-only fallback."""

import hashlib
import os
from contextlib import closing
from io import BytesIO
from urllib.parse import unquote_plus

from botocore.exceptions import BotoCoreError, ClientError
from pypdf import PdfReader
from shared.common import LOG, client, conditional_failure, fail_document, get_document, table, timestamp
from shared.ingestion import persist_pages

FALLBACK_MAX_BYTES = 10 * 1024 * 1024
FALLBACK_MAX_PAGES = 200
FALLBACK_MAX_CHARACTERS = 1_000_000


def record_extraction(document_id, version, method, job_id=None):
    update = "SET extraction_method = :method, updated_at = :now"
    values = {":method": method, ":now": timestamp(), ":version": version, ":extracting": "EXTRACTING"}
    if job_id is not None:
        update += ", textract_job_id = :job"
        values[":job"] = job_id
    try:
        table("documents").update_item(
            Key={"document_id": document_id},
            UpdateExpression=update,
            ConditionExpression="s3_version = :version AND #status = :extracting AND (attribute_not_exists(extraction_method) OR extraction_method = :method)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=values,
        )
    except ClientError as error:
        if conditional_failure(error):
            return False
        raise
    return True


def extract_text_fallback(document_id, params, size):
    """Read only the accepted S3 version; image-only pages still require OCR."""
    if size > FALLBACK_MAX_BYTES:
        fail_document(document_id, "PDF exceeds the 10 MiB text extraction fallback limit.")
        return
    with closing(client("s3").get_object(**params)["Body"]) as body:
        payload = body.read()
    try:
        reader = PdfReader(BytesIO(payload))
        if reader.is_encrypted:
            fail_document(document_id, "Password-protected PDFs cannot use the text extraction fallback.")
            return
        if len(reader.pages) > FALLBACK_MAX_PAGES:
            fail_document(document_id, "PDF exceeds the 200-page text extraction fallback limit.")
            return
        pages = []
        total_characters = 0
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            total_characters += len(text)
            if total_characters > FALLBACK_MAX_CHARACTERS:
                fail_document(document_id, "PDF exceeds the text extraction fallback's 1M-character limit.")
                return
            pages.append((number, text))
    except (BotoCoreError, ClientError, MemoryError):
        raise
    except Exception:
        LOG.exception("PDF text extraction failed for document %s", document_id)
        fail_document(
            document_id, "PDF text extraction failed; Textract OCR is unavailable in this AWS account."
        )
        return
    persist_pages(
        document_id,
        pages,
        extraction_method="pypdf",
        no_text_message=(
            "No extractable text was found. Textract OCR is unavailable in this AWS account; "
            "upload a text-based PDF."
        ),
    )


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
        if error.response["Error"]["Code"] == "SubscriptionRequiredException":
            LOG.warning("Textract is unavailable; extracting the PDF text layer for document %s", document_id)
            if record_extraction(document_id, version, "pypdf"):
                extract_text_fallback(document_id, params, head["ContentLength"])
            return
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
    if not record_extraction(document_id, version, "textract", job["JobId"]):
        return
    LOG.info("Started extraction for document %s", document_id)


def lambda_handler(event, context):
    for record in event.get("Records", []):
        if record.get("eventSource") == "aws:s3":
            process_record(record)
    return {"processed": len(event.get("Records", []))}
