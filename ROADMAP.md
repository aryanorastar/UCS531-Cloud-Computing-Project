# Implementation checklist

Status reviewed on 12 October 2026. Checked items describe verified repository changes; unchecked items are proposed work, not completed functionality. See [ARCHITECTURE.md](ARCHITECTURE.md) for evidence and design constraints.

## Completed foundation

- [x] Create an independent private repository under `aryanorastar`.
- [x] Review the notebook, all setup guides, sample corpus, and imported Git history.
- [x] Replace imported deployment endpoints with explicit `RAG_API_BASE_URL` configuration.
- [x] Clear saved notebook outputs, execution counts, and inherited kernel metadata.
- [x] Select a fresh upload's document ID instead of a saved ID.
- [x] Correct README implementation claims and repository structure.
- [x] Record the actual architecture, gaps, and staged implementation checklist.
- [x] Remove the upstream remote and replace inherited history with a fresh import commit.

## 1. Make the backend reproducible

- [ ] Implement all six backend handlers referenced by the guides.
- [ ] Choose Python/runtime versions and declare notebook/backend dependencies.
- [ ] Define consistent request/response schemas, error responses, resource names, and stage configuration.
- [ ] Choose a single infrastructure-as-code approach and provision S3, DynamoDB, Lambdas, API Gateway, Textract notifications, IAM, and processing triggers together.
- [ ] Verify the selected Bedrock model IDs, embedding dimensions, region support, and account permissions.
- [ ] Deploy into this project's AWS account and document provisioning and teardown.

Acceptance: a fresh checkout can provision the backend without copying untracked console code, then upload one paper and obtain a grounded answer.

## 2. Make ingestion reliable and observable

- [ ] Store document metadata and states: uploaded, extracting, embedding, ready, failed.
- [ ] Add a document-status API and have the client wait for readiness instead of a fixed delay.
- [ ] Make event processing idempotent, correlate Textract jobs to documents, and fetch every result page.
- [ ] Handle DynamoDB pagination and partial/unprocessed writes.
- [ ] Persist chunk order, page/section references, and embedding model/version metadata.
- [ ] Add bounded retries, actionable failure states, and recovery; use a queue and dead-letter handling if adopting event-driven embedding generation.
- [ ] Add request/job identifiers, structured logs, metrics, alarms, budget controls, and retention rules to the deployment.

Acceptance: duplicate events do not duplicate chunks; failed jobs are visible and recoverable; the 144-page sample can become ready with all extraction pages processed.

## 3. Make the API safe and answers trustworthy

- [ ] Use separate, resource-scoped Lambda and Textract roles, including scoped PassRole and trust conditions.
- [ ] Define authentication and enforce document ownership for upload, status, retrieval, answering, and deletion.
- [ ] Validate filenames, file type/size, question length, document scope, and allowed `top_k` range; apply throttling and usage bounds.
- [ ] Make document reads efficient with keys/indexes designed for document access; validate isolation before corpus-wide searches.
- [ ] Retrieve or verify answer context server-side; provide one server-orchestrated answer route while preserving useful retrieval diagnostics.
- [ ] Use grounded prompts, explicit insufficient-evidence behavior, and verified document/page citations.
- [ ] Align API Gateway, Lambda, model invocation, and client timeouts.

Acceptance: invalid requests fail clearly; a caller cannot read another caller's documents; unsupported questions receive an evidence-based abstention; clients cannot forge verified sources.

## 4. Measure retrieval quality and cost

- [ ] Build an evaluation set from sample questions, with expected facts and source passages, plus unanswerable and cross-document cases.
- [ ] Compare structure-aware, overlapping chunks and record retrieval recall, citation validity, answer correctness, latency, and cost.
- [ ] Add reranking or an indexed vector store only where measured results justify it; retain a shared retrieval interface.
- [ ] Optimize repeat embedding/extraction work, memory usage, and processing concurrency from observed bottlenecks.

Acceptance: a repeatable report explains where answers are accurate, where they abstain, and how cost/latency change with corpus size.

## 5. Improve the client experience

- [ ] Add explicit request timeouts, consistent JSON/error handling, and streamed file uploads.
- [ ] Add document listing, readiness feedback, and deletion through the same API.
- [ ] Build a small web upload/question interface after the backend flow is verified.
- [ ] Display document/page citations, processing progress, and useful failure messages.

Acceptance: a user can upload, monitor, question, and remove a document without copying IDs manually. Browser functionality is proposed; no web interface currently exists.

## Validation policy

- [ ] Add targeted backend and API contract tests, including plain HTTP JSON versus Lambda proxy envelopes, authorization, pagination, and duplicate events.
- [ ] Add an explicit end-to-end smoke test against this project's deployment and a CI workflow for code/infrastructure validation.
- [ ] Keep notebook outputs and local credentials out of committed artifacts; never treat saved output as evidence of a current deployment.

The ownership cleanup was checked offline with notebook parsing, Python syntax checks, mocked HTTP calls, file-preservation checks, and GitHub repository/history verification. Live AWS behavior remains unverified.
