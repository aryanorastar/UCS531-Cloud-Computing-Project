# Implementation checklist

Updated on 27 November 2026 (late). Checked items are implemented or verified at the scope stated on each line; unchecked work remains outstanding. See [ARCHITECTURE.md](ARCHITECTURE.md) for design and evidence limits.

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
- [x] Configure Titan V2, embedding dimensions, Nova 2 Lite US profile, and scoped model permissions.
- [x] Build and validate the packaged Lambda artifacts locally.
- [x] Provide a credential/model preflight, deployment script, and real sample-PDF smoke test.
- [x] Add GitHub CI and OIDC deployment workflows plus a one-time bootstrap template/script.
- [x] Probe Titan V2 and Nova 2 Lite directly from AWS CloudShell in `us-east-1` (27 November 2026); DeepSeek R1 was blocked as Legacy in this account.
- [x] Deploy the `rag-pdf` CloudFormation stack in `us-east-1` from AWS CloudShell; confirm the API accepts an upload.
- [x] Configure a temporary local AWS login profile for the browser demo; verify its identity and the deployed API path.
- [ ] Provision a least-privilege deployment role for repeatable SAM deployment. CloudShell's root-identity model probes do not verify Lambda execution-role permissions.
- [ ] Provision AWS/GitHub OIDC deployment resources and repository variables.
- [x] Identify the live Textract gate: `StartDocumentTextDetection` returned `SubscriptionRequiredException` under this account's Free plan; no billing-plan change was made.
- [x] Implement a bounded pypdf text-layer fallback for that specific error, with an `extraction_method` status field and local regression tests.
- [x] Redeploy the fallback and pass the real Transformer PDF upload → pypdf extraction → indexing → retrieval → Nova answer smoke test at commit `a39914e` in `us-east-1` (38 `READY` chunks with source pages).
- [x] Verify the application's Lambda/Bedrock permissions for the exercised text-PDF path through that full smoke test; first fix the fallback starter's missing chunk-table `PutItem` grant with a scoped permission.

Acceptance: the deployed backend answered a question about a fresh uploaded Transformer PDF using the real API, storage, Lambda, DynamoDB Streams, Titan, SQS, and Nova services. The live sample used `extraction_method: pypdf`; it verifies the text-PDF path, not Textract OCR or answer quality across the corpus. A fresh checkout's repeatable least-privilege deployment still needs separate verification.

## 2. Reliable ingestion and processing status

- [x] Document metadata and explicit states, with a status API and client polling.
- [x] Signed upload headers, size/header checks, immutable S3 version, and idempotent Textract start.
- [x] Job correlation, Textract/DynamoDB pagination, deterministic chunks, overlapping page-aware text.
- [x] Conditional writes and atomic embedding/counter completion; duplicate-event regression checks.
- [x] Bounded embedding attempts, asynchronous failure queues, failure messages, log retention, and queue alarms.
- [x] Share page-aware chunk persistence between Textract results and the pypdf fallback; cap fallback at 10 MiB, 200 pages, and 1 million characters.
- [ ] Verify the 144-page sample and complete result pagination through live Textract when account access permits; the text-layer fallback has separate 200-page and 1 million-character caps.
- [ ] Verify Textract OCR separately when account access permits it; scanned/image-only PDFs are outside the pypdf fallback.
- [ ] Add a recovery/status reconciliation path for hard timeouts and exhausted delivery retries.
- [ ] Add tested operator redrive/re-ingestion tools and operational notification destinations.
- [ ] Configure account budgets and cost reporting before sustained cloud use.

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
- [x] Test the SubscriptionRequired fallback, immutable-version handling, visible failure on no text, resource caps, and non-fallback errors.
- [x] Return HTTP 400 for malformed base64 API bodies.
- [x] Keep notebook outputs and local configuration/credentials out of commits.
- [x] Pass the live AWS smoke test through the deployed text-PDF fallback using the actual Transformer PDF; record 38 indexed chunks, document-scoped passages, and a Nova answer with page-linked sources.
- [ ] Build an expected-answer/source evaluation set with unanswerable and cross-document questions.
- [ ] Measure accuracy, citation validity, latency, and cost across all sample papers.
- [ ] Add reranking or a dedicated vector index only when measurements justify it.

## 5. Client and product follow-up

- [x] Shared signed Python client with streamed uploads, explicit request timeouts, and status polling.
- [x] Notebook uses the same client as the deployment smoke test.
- [x] Add an operator-run browser demo over the existing IAM-signed client, with upload, processing progress, question answering, and source pages. Keep AWS credentials server-side and restrict writes to same-origin requests.
- [x] Verify the Mac browser → local signed client → deployed API path on 27 November 2026: sample document `90cedb25809042298d83b23f8eb9711e` progressed from 37/38 to `READY` 38/38 via `pypdf`; a preset question completed with a Nova answer and five source cards, including S4 page 5 excerpt.
- [x] Verify a recoverable browser error: a transient AWS upload request failure appeared in the UI, and retrying the sample upload reached `READY` 38/38 and another cited answer.
- [x] Redesign the browser demo as Folio: live two-lane architecture driven by real states, service cards, library of all bundled papers, embedded PDF reader that jumps to cited pages, timed Retrieve/Queue/Generate steps, evidence ribbon with similarity scores, cited-versus-retrieved sources, event stream, light/dark themes, keyboard shortcuts.
- [x] Verify Folio live on 27 November 2026: all five bundled papers `READY` (25–719 chunks), live GAN re-index in 10–13 s, cited answer in 7.3 s, off-topic question declined.
- [x] Fix large uploads on slow links: the S3 PUT used a 5 s connect timeout that urllib3 also applies to body writes, so the 8.6 MB survey failed; it now uses 60 s.
- [ ] Verify asynchronous document/answer `FAILED` displays in the browser. The live run checked the generated source target and expanded excerpt, not the new-tab behavior.
- [ ] Add document listing and owner-scoped deletion through the same API/store.
- [ ] Add a production web application with per-user authentication, authorization, and suitable hosting before exposing the UI beyond an operator-controlled machine.

Direct CloudShell model probes alone proved access only for that identity; the subsequent live smoke exercised the deployed Lambda roles and completed the text-PDF path for one sample. It does not establish Textract OCR, accuracy across papers, a billing-plan change, a deadline, or measured cost.
