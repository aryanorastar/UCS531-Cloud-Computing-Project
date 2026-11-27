"""Turn page text from Textract or a PDF text layer into idempotent chunks."""

import os

from botocore.exceptions import ClientError
from shared.common import conditional_failure, fail_document, mark_ready, table, timestamp


def split_page(text, size=1500, overlap=200):
    if not 0 <= overlap < size:
        raise ValueError("Chunk overlap must be smaller than chunk size")
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start + size // 2, end)
            if boundary > start:
                end = boundary
        chunk = text[start:end].strip()
        if chunk:
            yield chunk
        if end == len(text):
            break
        start = max(start + 1, end - overlap)


def persist_pages(
    document_id, pages, *, extraction_method, no_text_message="No readable text was found in this PDF."
):
    """Write deterministic chunks; duplicate extraction never replaces indexed vectors."""
    chunks = []
    for number, page_text in pages:
        for text in split_page(
            page_text,
            int(os.environ.get("CHUNK_CHARACTERS", "1500")),
            int(os.environ.get("CHUNK_OVERLAP", "200")),
        ):
            index = len(chunks)
            chunks.append(
                {
                    "document_id": document_id,
                    "chunk_id": f"{index:06d}",
                    "chunk_index": index,
                    "text": text,
                    "pages": [number],
                    "status": "PENDING",
                    "attempts": 0,
                }
            )
            if len(chunks) > int(os.environ.get("MAX_DOCUMENT_CHUNKS", "2000")):
                fail_document(document_id, "The PDF exceeds the demo chunk limit.")
                return
    if not chunks:
        fail_document(document_id, no_text_message)
        return
    try:
        table("documents").update_item(
            Key={"document_id": document_id},
            UpdateExpression="SET #status = :embedding, total_chunks = :total, extraction_method = :method, updated_at = :now",
            ConditionExpression="#status IN (:extracting, :embedding) AND (attribute_not_exists(extraction_method) OR extraction_method = :method)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":extracting": "EXTRACTING",
                ":embedding": "EMBEDDING",
                ":method": extraction_method,
                ":total": len(chunks),
                ":now": timestamp(),
            },
        )
    except ClientError as error:
        if conditional_failure(error):
            return
        raise
    for chunk in chunks:
        try:
            table("chunks").put_item(Item=chunk, ConditionExpression="attribute_not_exists(chunk_id)")
        except ClientError as error:
            if not conditional_failure(error):
                raise
    mark_ready(document_id)
