"""Fetch all extraction pages, split text, and create deterministic pending chunks."""

import json
from collections import defaultdict

from shared.common import client, fail_document, get_document
from shared.ingestion import persist_pages
from shared.ingestion import split_page as split_page


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
    persist_pages(
        document_id,
        ((number, "\n".join(lines)) for number, lines in sorted(pages.items())),
        extraction_method="textract",
    )


def lambda_handler(event, context):
    for record in event.get("Records", []):
        if record.get("EventSource") == "aws:sns":
            process_message(json.loads(record["Sns"]["Message"]))
    return {"processed": len(event.get("Records", []))}
