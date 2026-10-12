"""Run a real PDF upload → readiness → retrieval → answer test on a deployed stack."""

import argparse
import json
from pathlib import Path

from client import RagClient


def run(api_url, *, profile=None, pdf=None, question=None):
    pdf = Path(pdf or Path(__file__).resolve().parents[1] / "pdfs/Attention Is All You Need.pdf")
    question = question or "What architecture does the Transformer use, and how does it handle attention?"
    client = RagClient(api_url, profile=profile)
    document_id = client.upload(pdf)
    print(f"Uploaded {pdf.name}: {document_id}", flush=True)
    document = client.wait_document(document_id)
    print(f"Document ready: {document['completed_chunks']} indexed chunks", flush=True)
    retrieval = client.query(question, document_id)
    if not retrieval["top_chunks"] or any(
        chunk["document_id"] != document_id for chunk in retrieval["top_chunks"]
    ):
        raise RuntimeError("Retrieval did not return chunks from the uploaded document.")
    result = client.answer(question, document_id)
    if not result.get("answer") or not result.get("sources"):
        raise RuntimeError("No answer or source metadata was returned.")
    if any(source["document_id"] != document_id or not source["pages"] for source in result["sources"]):
        raise RuntimeError("Answer source metadata does not match the uploaded PDF.")
    print(json.dumps({"document_id": document_id, **result}, indent=2), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url")
    parser.add_argument("--profile")
    parser.add_argument("--pdf")
    parser.add_argument("--question")
    args = parser.parse_args()
    run(args.api_url, profile=args.profile, pdf=args.pdf, question=args.question)


if __name__ == "__main__":
    main()
