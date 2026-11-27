# Part 5: Tests, smoke test, and notebook

## Local integration tests

```sh
source .venv/bin/activate
pytest -q
```

Tests call all six handlers in order using the real sample PDF bytes, Moto-backed S3/DynamoDB/SQS, and controlled Textract/Bedrock responses. They verify state transitions, extraction pagination, atomic counters, duplicate delivery, ownership, retries, request validation, IAM signing, and forged-client-context rejection. No AWS account or live model call is used; OCR/model quality is outside this test's evidence.

Focused fallback regressions simulate Textract `SubscriptionRequiredException` and verify that pypdf reads the accepted S3 version, preserves page references, reports `extraction_method: pypdf`, survives duplicate events, and fails visibly on PDFs without a text layer or over the resource limits. Unrelated Textract errors do not trigger the fallback. These tests do not verify OCR or a deployed Lambda.

## Offline walkthrough

```sh
python -m scripts.local_demo
```

This extracts actual text from the included Transformer PDF with pypdf, then runs the application handlers using Moto for S3/DynamoDB/SQS and deterministic substitutes for Textract and Bedrock. It prints document states, retrieved page references, an extractive answer, and an ownership check. Use `--pdf` and `--question` to try another text-based PDF. The walkthrough is a local demonstration, not live Textract or model verification. [Lab evaluation guide](EVALUATION_GUIDE.md) gives a timed presentation script.

## Live smoke test

Deploy with `python -m scripts.deploy --smoke-test`, or test an existing stack:

```sh
python -m scripts.smoke_test --api-url "$RAG_API_BASE_URL"
```

The default PDF is `pdfs/Attention Is All You Need.pdf`. Override it with `--pdf` and a question with `--question`. The test uploads, waits for `READY`, prints the selected `extraction_method`, checks scoped passages, waits for an answer, and checks source document/page metadata. This uses billable AWS services. At commit `a39914e`, the live run in `us-east-1` passed: a fresh Transformer PDF reached `READY` with 38 chunks via `pypdf`; retrieval passed; Nova 2 Lite returned a nonempty answer and sources from that document, including S1 on page 2 and S2 on page 5. The earlier Textract attempt had returned `SubscriptionRequiredException`; OCR remains unverified.

## Notebook usage

Install the project requirements in your notebook's Python environment and open `index.ipynb` from the repository root. Set `RAG_API_BASE_URL` to your own deployed invoke URL, including its stage. The client uses the default AWS profile or `AWS_PROFILE`.

1. First cell creates `RagClient` and the upload helper.
2. Second cell uploads all five PDFs, stores fresh IDs, and waits for each document to become ready.
3. Third cell defines a question helper using retrieval diagnostics and queued answer polling.
4. Fourth cell asks four questions about the uploaded Transformer paper, including an unsupported-topic question for evaluation.

The notebook and smoke test share `client.py`; API changes do not require independent copies of HTTP/auth/polling logic. Saved outputs and execution counts must stay cleared in commits. See [deployment prerequisites and failure investigation](DEPLOYMENT.md).
