"""Fetch all extraction pages, split text, and create deterministic pending chunks."""

import json
import os
from collections import defaultdict

from botocore.exceptions import ClientError
from shared.common import (
    client,
    conditional_failure,
    fail_document,
    get_document,
    mark_ready,
    table,
    timestamp,
)


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


def process_message(message):
    document_id = message["JobTag"]
    document = get_document(document_id)
    if document.get("textract_job_id") != message["JobId"]:
        raise ValueError("Extraction job is not registered yet or does not match")
    if document["status"] in ("READY", "FAILED"):
        return
    if message["Status"] != "SUCCEEDED":
        fail_document(document_id, "Textract could not extract this PDF. Check the extraction job logs.")
        return
    pages = defaultdict(list)
    params = {"JobId": message["JobId"], "MaxResults": 1000}
    while True:
        page = client("textract").get_document_text_detection(**params)
        if page["JobStatus"] != "SUCCEEDED":
            raise ValueError("Textract results are not complete")
        if page.get("DocumentMetadata", {}).get("Pages", 0) > 500:
            fail_document(document_id, "The demo supports PDFs with at most 500 pages.")
            return
        for block in page.get("Blocks", []):
            if block["BlockType"] == "LINE" and block.get("Text"):
                pages[int(block.get("Page", 1))].append(block["Text"])
        if not page.get("NextToken"):
            break
        params["NextToken"] = page["NextToken"]
    chunks = []
    for number, lines in sorted(pages.items()):
        for text in split_page(
            "\n".join(lines),
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
        fail_document(document_id, "No readable text was found in this PDF.")
        return
    try:
        table("documents").update_item(
            Key={"document_id": document_id},
            UpdateExpression="SET #status = :embedding, total_chunks = :total, updated_at = :now",
            ConditionExpression="#status IN (:extracting, :embedding)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":extracting": "EXTRACTING",
                ":embedding": "EMBEDDING",
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


def lambda_handler(event, context):
    for record in event.get("Records", []):
        if record.get("EventSource") == "aws:sns":
            process_message(json.loads(record["Sns"]["Message"]))
    return {"processed": len(event.get("Records", []))}
