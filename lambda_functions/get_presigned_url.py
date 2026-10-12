"""Upload URL and document readiness endpoints (IAM authenticated)."""

import os
import uuid

from shared.common import (
    ApiError,
    api_handler,
    body,
    client,
    get_document,
    owner_id,
    response,
    table,
    timestamp,
)


@api_handler
def lambda_handler(event, context):
    owner = owner_id(event)
    if event.get("httpMethod") == "GET":
        document_id = (event.get("pathParameters") or {}).get("document_id")
        document = get_document(document_id, owner)
        allowed = [
            "document_id",
            "filename",
            "status",
            "total_chunks",
            "completed_chunks",
            "created_at",
            "updated_at",
            "error_message",
        ]
        return response(200, {k: document[k] for k in allowed if k in document})
    data = body(event)
    filename = data.get("filename")
    if (
        not isinstance(filename, str)
        or len(filename) > 200
        or not filename.lower().endswith(".pdf")
        or any(c in filename for c in ("/", "\\"))
        or any(ord(c) < 32 for c in filename)
    ):
        raise ApiError(400, "filename must be a PDF filename without directory components.")
    size = data.get("size_bytes")
    maximum = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    if type(size) is not int or not 5 <= size <= maximum:
        raise ApiError(400, f"size_bytes must be an integer from 5 to {maximum}.")
    document_id = uuid.uuid4().hex
    object_key = f"uploads/{owner}/{document_id}/document.pdf"
    expires = 900
    url = client("s3").generate_presigned_url(
        "put_object",
        Params={
            "Bucket": os.environ["DOCUMENTS_BUCKET"],
            "Key": object_key,
            "ContentType": "application/pdf",
            "ContentLength": size,
        },
        ExpiresIn=expires,
        HttpMethod="PUT",
    )
    now = timestamp()
    table("documents").put_item(
        Item={
            "document_id": document_id,
            "owner_id": owner,
            "filename": filename,
            "object_key": object_key,
            "expected_size": size,
            "status": "AWAITING_UPLOAD",
            "total_chunks": 0,
            "completed_chunks": 0,
            "created_at": now,
            "updated_at": now,
        },
        ConditionExpression="attribute_not_exists(document_id)",
    )
    return response(
        200,
        {
            "document_id": document_id,
            "upload_url": url,
            "expires_in": expires,
            "upload_headers": {"Content-Type": "application/pdf", "Content-Length": str(size)},
            "status_url": f"/documents/{document_id}",
        },
    )
