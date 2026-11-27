# Implementation checklist

Updated on 27 November 2026. Checked items are implemented/locally verified. Unchecked acceptance steps remain outstanding. See [ARCHITECTURE.md](ARCHITECTURE.md) for design and limitations.

## Completed foundation

- [x] Independent private repository under `aryanorastar`.
- [x] Remove inherited deployment settings, saved notebook outputs/IDs, upstream remote, and inherited active history.
- [x] Preserve the five sample research PDFs.
- [x] Review the ecosystem and update architecture, guides, and this checklist together.

## 1. Reproducible upload-to-answer baseline

- [x] Implement all six backend handlers with shared contracts/storage/retrieval helpers.
- [x] Declare Python 3.12 and pinned runtime/development dependencies.
- [x] Provision API, private versioned S3, tables, SNS/Textract roles, stream processing, queues, logs, and alarms in SAM.
- [x] Grant the stream and queue consumers their resource-scoped event-source read permissions; cover these contracts with a template test.
- [x] Configure Titan V2, embedding dimensions, DeepSeek R1 US profile, and scoped model permissions.
- [x] Build and validate the packaged Lambda artifacts locally.
- [x] Provide a credential/model preflight, deployment script, and real sample-PDF smoke test.
- [x] Add GitHub CI and OIDC deployment workflows plus a one-time bootstrap template/script.
- [ ] Configure a real default AWS profile or authorized deployment role.
- [ ] Provision AWS/GitHub OIDC deployment resources and repository variables.
- [ ] Deploy the application and verify actual Lambda/Bedrock permissions and quotas.
- [ ] Pass the real sample PDF upload → extraction → indexing → retrieval → answer smoke test.

Acceptance: a fresh checkout provisions the backend and answers a question about the uploaded PDF using real AWS services. Local orchestration passes; live acceptance remains pending credentials.

## 2. Reliable ingestion and processing status

- [x] Document metadata and explicit states, with a status API and client polling.
- [x] Signed upload headers, size/header checks, immutable S3 version, and idempotent Textract start.
- [x] Job correlation, Textract/DynamoDB pagination, deterministic chunks, overlapping page-aware text.
- [x] Conditional writes and atomic embedding/counter completion; duplicate-event regression checks.
- [x] Bounded embedding attempts, asynchronous failure queues, failure messages, log retention, and queue alarms.
- [ ] Verify the 144-page sample on live AWS with all result pages processed.
- [ ] Add a recovery/status reconciliation path for hard timeouts and exhausted delivery retries.
- [ ] Add tested operator redrive/re-ingestion tools and operational notification destinations.
- [ ] Configure account budgets and cost reporting after account access is available.

## 3. Scoped API and grounded answers

- [x] IAM-authenticated API and owner checks on upload status, retrieval, and answer jobs.
- [x] Separate resource-scoped Lambda/Textract roles and scoped PassRole/trust conditions.
- [x] Validate PDF registration, IDs, question length, top_k, and search size; throttle the API.
- [x] Query document partitions and use an owner index for corpus-wide retrieval.
- [x] Server-side answer retrieval, queued generation, and answer-status polling.
- [x] Evidence-only prompt instructions and source metadata from stored chunks.
- [x] Match embedding model/dimensions and deliberately separate API and worker timeouts.
- [ ] Add stronger end-user login if multiple people share an IAM role.
- [ ] Evaluate abstention/citation correctness and defend document prompt injection beyond prompt instructions.
- [ ] Add answer-job reconciliation for hard timeouts and expiry.

## 4. Tests, quality, and scale

- [x] Integration tests run every handler in sequence using the actual sample PDF bytes, simulated AWS data services, and controlled OCR/model responses.
- [x] Provide a local walkthrough that extracts actual text from the sample PDF and runs the same handlers with simulated AWS services and deterministic model substitutes.
- [x] Test malformed requests, unsigned callers, ownership, status, pagination, duplicate events, retry exhaustion, forged client context, and signing.
- [x] Return HTTP 400 for malformed base64 API bodies.
- [x] Keep notebook outputs and local configuration/credentials out of commits.
- [ ] Run the live AWS smoke test; simulated tests do not measure OCR/AI quality.
- [ ] Build an expected-answer/source evaluation set with unanswerable and cross-document questions.
- [ ] Measure accuracy, citation validity, latency, and cost across all sample papers.
- [ ] Add reranking or a dedicated vector index only when measurements justify it.

## 5. Client and product follow-up

- [x] Shared signed Python client with streamed uploads, explicit request timeouts, and status polling.
- [x] Notebook uses the same client as the deployment smoke test.
- [ ] Add document listing and owner-scoped deletion through the same API/store.
- [ ] Add a web interface after the live backend passes its acceptance test.

No live stack, model answer, deadline, cost estimate, or successful cloud deployment is implied by the completed source-code items above.
