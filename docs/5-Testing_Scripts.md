# Part 5: Notebook testing and usage

The notebook is a client for an already deployed API. Backend source and reproducible deployment are still missing; see [the architecture review](../ARCHITECTURE.md) and [implementation checklist](../ROADMAP.md).

## Configure your API

Set `RAG_API_BASE_URL` to your own API Gateway invoke URL, including its stage, before running the helper cells:

```python
import os

os.environ["RAG_API_BASE_URL"] = "https://YOUR-API-ID.execute-api.ap-south-1.amazonaws.com/dev"
```

The notebook derives `/upload-url`, `/query`, and `/answer` from this one setting. It raises an error when no URL is configured. Python, Jupyter, and `requests` are needed; dependency versions are not yet declared.

## Upload documents

1. Run the first code cell to define the upload helpers.
2. Run the second code cell to upload all five sample PDFs, or call `upload_document` with a selected file.
3. Use the returned document ID from your current upload.

```python
doc_id = upload_document("pdfs/Attention Is All You Need.pdf")
```

The batch cell stores IDs in `document_ids`. A successful upload does not mean extraction and embedding have finished. The current design schedules embeddings every five minutes, and there is no status endpoint yet. Confirm backend processing completion before querying; a fixed wait is not a readiness guarantee.

## Ask questions

1. Run the third code cell to define `test_full_rag_pipeline`.
2. Run the fourth code cell. It selects the Transformer paper's ID from the current batch upload and asks four sample questions.

For a single successful upload, use its returned ID:

```python
test_full_rag_pipeline("What is a Transformer model?", doc_id)
```

The function calls `/query` for relevant chunks, passes them to `/answer`, and prints the answer and source excerpts. For an intentionally corpus-wide question:

```python
test_full_rag_pipeline("Compare BERT and the original Transformer.", None)
```

The backend must enforce the caller's allowed document scope for both document-specific and corpus-wide requests. That enforcement cannot currently be verified because backend code is absent.

## Evidence and limitations

The notebook contains demonstration calls, not automated tests with expected results. Saved outputs have been cleared and should be cleared before commits. No live AWS run has been performed for this repository. API authentication, request timeouts, processing-status polling, and answer-quality evaluation are tracked as future work.
