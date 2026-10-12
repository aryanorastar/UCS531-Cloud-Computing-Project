# Part 5: Tests, smoke test, and notebook

## Local integration tests

```sh
source .venv/bin/activate
pytest -q
```

Tests call all six handlers in order using the real sample PDF bytes, Moto-backed S3/DynamoDB/SQS, and controlled Textract/Bedrock responses. They verify state transitions, extraction pagination, atomic counters, duplicate delivery, ownership, retries, request validation, IAM signing, and forged-client-context rejection. No AWS account or live model call is used; OCR/model quality is outside this test's evidence.

## Live smoke test

Deploy with `python -m scripts.deploy --smoke-test`, or test an existing stack:

```sh
python -m scripts.smoke_test --api-url "$RAG_API_BASE_URL"
```

The default PDF is `pdfs/Attention Is All You Need.pdf`. Override it with `--pdf` and a question with `--question`. The test uploads, waits for `READY`, checks scoped passages, waits for an answer, and checks source document/page metadata. This uses billable AWS services. Live deployment/testing is still pending credentials.

## Notebook usage

Install the project requirements in your notebook's Python environment and open `index.ipynb` from the repository root. Set `RAG_API_BASE_URL` to your own deployed invoke URL, including its stage. The client uses the default AWS profile or `AWS_PROFILE`.

1. First cell creates `RagClient` and the upload helper.
2. Second cell uploads all five PDFs, stores fresh IDs, and waits for each document to become ready.
3. Third cell defines a question helper using retrieval diagnostics and queued answer polling.
4. Fourth cell asks four questions about the uploaded Transformer paper, including an unsupported-topic question for evaluation.

The notebook and smoke test share `client.py`; API changes do not require independent copies of HTTP/auth/polling logic. Saved outputs and execution counts must stay cleared in commits. See [deployment prerequisites and failure investigation](DEPLOYMENT.md).
