# Lab evaluation guide: Serverless PDF Q&A on AWS

Use this as a speaking and demo checklist. The project is a **serverless retrieval-augmented generation (RAG) pipeline** for research PDFs. It registers a PDF, extracts and indexes its text, then answers questions with passages and page references from that PDF.

## The 30-second explanation

> “I built a browser demo for an event-driven PDF question-answering system on AWS. I can upload a paper, watch its processing state, ask a question, and inspect the answer beside its source pages. Behind the page, an IAM-signed Python client sends requests to the deployed API. S3, Lambda, DynamoDB Streams, Titan embeddings, SQS, and Nova 2 Lite do the actual processing. The verified Transformer-paper run indexed 38 text chunks. This account's Textract subscription gate means scanned-page OCR is still unverified.”

**Define RAG simply:** first *retrieve* relevant passages from the uploaded material, then *generate* an answer using those passages as context. The model is not fine-tuned on these papers.

The browser page is an operator demo hosted by a local Python server. It uses that server's AWS credentials and the existing IAM-protected API; it is not a public login system or an additional cloud backend.

## Architecture to draw on the board

```text
                  upload                         extraction and indexing
Python client ── POST /upload-url ── API Gateway ── Lambda ── DynamoDB documents
       │                                      │
       └── presigned PUT ─────────────────── S3 (private, versioned)
                                               │ object event
                                               ▼
                                          Lambda ── Textract ── SNS ── Result Lambda ──┐
                                             │                                        │
                                             └── pypdf text-layer fallback ───────────┤
                                                                                      ▼
                                                                               DynamoDB chunks
                                                       │ Stream INSERT
                                                       ▼
                                            Lambda ── Bedrock Titan V2
                                                       │ vectors + progress
                                                       ▼
                                                document READY

                  question                           answer
Python client ── POST /query ── Lambda ── embed question + cosine search
       │
       └──────── POST /answer ── Lambda ── SQS ── worker Lambda
                                                 │ trusted retrieval
                                                 └── Bedrock Nova 2 Lite
       └──────── GET /answers/{job_id} ── answer + source filenames/pages
```

**Key states:** document `AWAITING_UPLOAD → EXTRACTING → EMBEDDING → READY` (or `FAILED`); answer job `QUEUED → GENERATING → COMPLETED` (or `FAILED`). Upload success does not mean the document is ready.

## Five-minute demonstration

Before the evaluation, start the browser demo with the same AWS identity used to upload the document; follow [the browser launch steps](DEPLOYMENT.md). Choose the included Transformer sample and let it reach `READY` before the timed slot. Keep that tab open with a question and source pages available. A new upload or model answer can take longer than the speaking slot, so keep the verified CloudShell smoke output and [PDF slides](../presentation/UCS531_Lab_Evaluation.pdf) available as backup.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:35 | Browser demo home | State the problem and define retrieval-augmented generation: find relevant passages, then answer from them. |
| 0:35–1:20 | Sample document card and its `READY` status | Point out that upload, extraction, chunking, and Titan indexing are asynchronous; `READY` means all expected chunks are indexed. |
| 1:20–2:45 | Ask “How does the Transformer use attention?” | Show the queued answer state and the Nova 2 Lite result. The answer worker retrieves trusted passages itself. |
| 2:45–3:30 | Source cards and page numbers | Expand a source card and compare its excerpt with the answer. Explain that stored page metadata comes from the indexed PDF. |
| 3:30–4:30 | UI pipeline diagram, then `template.yaml` if asked | Trace the browser → local signed client → API Gateway → S3/Lambda/DynamoDB/Bedrock/SQS path. The UI does not contain AWS credentials. |
| 4:30–5:00 | Extraction method and limitation label | State that the live text-PDF path passed, while Textract OCR on scans is blocked in this account and citation quality still needs broader measurement. |

The source IDs, excerpts, and page metadata come from the API response. The UI builds links to the included sample PDF or browser-selected local file at the returned page number; those links do not make the private S3 object public. The live run verified a rendered link and an expanded source excerpt, but did not independently verify opening the PDF in a new tab. Use the excerpt in the timed demo.

If the live browser flow is unavailable during the evaluation, run the offline command below and show the already recorded live AWS smoke result. Describe the offline output as simulated and the recorded cloud result as live.

### Offline demonstration (available without local AWS credentials)

```sh
python -m scripts.local_demo
python -m pytest -q tests/test_pipeline.py::test_full_sample_pdf_upload_to_answer
python -m pytest -q
```

The local demo parses text from the actual Transformer PDF, prints each state transition and retrieved page, produces a deterministic extractive answer, and checks another IAM identity cannot read the document. Moto simulates S3/DynamoDB/SQS; the demo's pypdf extraction stands in for Textract, while the production fallback also uses pypdf when that specific service error occurs. Deterministic functions substitute for Titan and Nova 2 Lite. The focused test runs all six handlers with controlled Textract/Bedrock responses. Additional tests cover fallback limits, no-text PDFs, duplicate events, isolation, retries, signing, and forged client passages. **Describe this as local integration verification, not as a live AWS or AI-quality result.**

If a command fails on the evaluation machine, show the already obtained test output and the exact environment used. Do not call a failed run a pass.

### Live demonstration when AWS is already deployed and verified

Set `RAG_API_BASE_URL` to the stack's `ApiBaseUrl` output, including the stage, and use the same AWS IAM identity that owns the uploaded document. Run against the existing stack:

```sh
python -m scripts.smoke_test --api-url "$RAG_API_BASE_URL"
```

The smoke test uploads the Transformer paper, waits for `READY`, prints `extraction_method`, checks document-scoped passages, asks a question, and checks the answer and source pages. The initial attempt stopped at Textract `SubscriptionRequiredException` under this account's Free plan. After the fallback and a scoped chunk-write permission fix, the live run at commit `a39914e` passed: a fresh PDF reached `READY` with 38 chunks via `pypdf`; retrieval passed; Nova returned an answer with source pages. The test uses billable AWS services and can take several minutes. Show that recorded output in a timed presentation. This verifies the text-PDF cloud path, **not** Textract OCR or answer accuracy across the corpus.

## Explain the cloud design as a scenario answer

**Scenario:** “Five students upload papers at different times; some PDFs are long, and answer generation can be slow. How would you make this reliable without managing servers?”

**Proposal:** API Gateway + Lambda for the API, direct S3 uploads, asynchronous Textract with SNS when available, a bounded pypdf fallback for text-layer PDFs when Textract returns a subscription gate, DynamoDB for state and chunks, Streams for indexing, SQS for long answer jobs, and Bedrock for embeddings/generation. SAM declares the resources and permissions.

**Why:** S3 handles large object storage without routing PDF bytes through the API. Events and queues decouple long work from request deadlines. Lambda scales with demand, and DynamoDB stores progress durably. The client can poll explicit state instead of assuming an upload instantly creates an answer.

**Trade-off:** Exact cosine search reads a bounded set of stored vectors, so retrieval cost and latency grow with corpus size. A dedicated vector index becomes appropriate after measuring that limit. Model calls, Textract pages, requests, storage, and logs also incur cost; serverless is pay-for-usage, not free.

## Likely viva questions

| Question | Short answer |
| --- | --- |
| Why S3 instead of DynamoDB for the PDF? | S3 is object storage for the original file, with versioning and private access. DynamoDB holds small metadata, job state, chunks, and vectors that are queried by key. |
| Why a presigned upload URL? | `RagClient` sends PDF bytes directly to S3 after the API registers a controlled object key and signs a short-lived upload, reducing API transfer and timeout pressure. The browser demo first hands the file to its local Python server; that server calls the same client. The processing Lambda still validates the stored PDF header and size. |
| Why asynchronous Textract and SNS? | Extraction of a large PDF can exceed a synchronous API request. When available, Textract performs the job and notifies the result handler when it finishes. The current account's Free plan returned `SubscriptionRequiredException`, so text-layer PDFs use bounded pypdf extraction; scanned pages still need OCR. |
| Why DynamoDB Streams? | A new pending chunk automatically triggers embedding. A transaction completes the chunk and increments the document's progress together, so duplicate events do not double-count completion. |
| What is an embedding? | A numeric vector representing text. The question and chunks use the same Titan model and vector dimension; cosine similarity ranks the closest chunks. |
| Why overlap chunks? | A fact at a chunk boundary can otherwise lose surrounding context. This implementation uses approximately 1,500-character chunks with 200-character overlap and retains page references. |
| Why SQS for `/answer`? | Generation may outlast an API Gateway request. The API returns HTTP 202 and a job ID; the worker processes it with retries, and the client polls the result. |
| How do you reduce hallucinations? | Retrieve from the selected document, pass only those passages to the model, ask for citations and abstention, and return stored source metadata. This is a mitigation; citation correctness and answer quality still need measured evaluation. |
| What stops one caller reading another's paper? | API Gateway requires IAM SigV4. The handlers derive ownership from the AWS principal and check it on status, retrieval, and answer jobs. The browser demo uses its server's one IAM principal, so everyone who can reach that local demo shares its scope; do not expose it as a public multi-user app. |
| What if an event arrives twice? | Textract starts with a deterministic token; extraction uses deterministic chunk IDs and conditional writes; embedding completion and the counter change atomically. Duplicate external model calls can still happen under concurrent delivery. |
| What happens on failure? | Recorded failures move a document/job to `FAILED`; retries are bounded and failed deliveries can go to failure queues with alarms. Hard timeouts may leave a state in progress, so automated reconciliation remains future work. |
| Why not a vector database now? | The initial corpus is small. A document-partition query and exact cosine ranking are simpler and auditable, with explicit search limits. Measure latency and corpus size before adding an index. |
| What is the deployment/service model? | AWS public cloud. The application uses managed, serverless services: Lambda (functions), API Gateway, S3, DynamoDB, SQS/SNS, Textract, and Bedrock. SAM/CloudFormation provides infrastructure as code. |
| How would you control cost? | Limit PDF size/pages/chunks and search breadth, use asynchronous work only when needed, inspect per-service usage, set account budgets, and test with small PDFs. A budget and measured per-question cost are not yet configured. |

## Evidence and limits to state precisely

- The repository contains a deployable SAM template, six handlers, a signed Python client, a smoke-test command, and local integration tests. See `README.md`, `ARCHITECTURE.md`, and `ROADMAP.md` for the current status.
- Local tests simulate AWS data services and control Textract/Bedrock replies. They prove orchestration and many failure checks, **not** live IAM permissions, OCR accuracy, model quality, or cloud latency.
- On 27 November 2026 in `us-east-1`, a separate AWS CloudShell session successfully invoked Titan V2 and the Nova 2 Lite US inference profile through Bedrock Converse. The earlier DeepSeek R1 invocation was blocked as Legacy. These direct probes do not exercise the deployed Lambda roles or the PDF pipeline.
- The `rag-pdf` CloudFormation stack in `us-east-1` passed the live smoke at commit `a39914e`. Fresh document `6512893e0649491591ee0d69c68a3ff2` reached `READY` with 38 chunks via `pypdf`; retrieval returned passages; Nova 2 Lite returned a nonempty answer and sources from that document, including S1 page 2 and S2 page 5. This verifies the deployed text-PDF path for one sample.
- On 27 November 2026, the browser demo at Mac `localhost:8080` used the temporary `ucs531-demo` AWS login profile to upload the same Transformer sample as document `90cedb25809042298d83b23f8eb9711e`. The interface showed 37/38 indexed chunks and then `READY` 38/38 via `pypdf`. A preset question completed with a Nova answer and five source cards; S4 page 5 excerpt expanded. This verifies one real browser-to-AWS flow. Browser failure states and PDF new-tab navigation were not checked in that run.
- After the UI race fix, a second sample upload first surfaced a transient AWS request failure in the browser. The retry succeeded as document `8334410045ae4b8e945c37f0bcd49988`, reached `READY` 38/38, and returned another five-source cited answer. This verifies the visible error and retry path; asynchronous `FAILED` job states and PDF new-tab navigation remain unchecked.
- Textract returned `SubscriptionRequiredException` under the account's Free plan. No billing-plan change was made. Textract OCR remains blocked and unverified, and a pypdf result does not show OCR on scanned pages.
- Current design limits include 25 MiB PDFs, 500 Textract pages, 2,000 chunks per document, and 2,500 chunks per search. The pypdf fallback is capped at 10 MiB, 200 pages, and 1 million characters. It cannot OCR scanned pages. The browser UI is an operator-run local adapter; a public multi-user login, owner-scoped deletion, measured answer-quality benchmark, and automatic recovery for every hard-timeout state remain future work.

**Good closing line:** “The live text-PDF path now works from upload through cited answer. My next checks are citation accuracy, latency, and cost across the included papers; OCR needs Textract access and its own test.”
