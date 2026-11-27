# Lab evaluation guide: Serverless PDF Q&A on AWS

Use this as a speaking and demo checklist. The project is a **serverless retrieval-augmented generation (RAG) pipeline** for research PDFs. It registers a PDF, extracts and indexes its text, then answers questions with passages and page references from that PDF.

## The 30-second explanation

> "Folio is a question-answering system for research papers that runs entirely on serverless AWS. When I upload a PDF, S3, Lambda, DynamoDB Streams and Bedrock's Titan model extract and index it; the diagram at the top lights up each service as the real state changes. When I ask a question, Lambda ranks the paper's chunks by cosine similarity, SQS hands the best passages to a worker, and Nova 2 Lite writes an answer that cites pages. Clicking a citation opens that page of the PDF. The browser never sees AWS credentials: a local server signs every call with IAM SigV4."

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

Before the slot: run `aws login --profile ucs531-demo --region us-east-1`, start the server ([run steps](DEPLOYMENT.md#run-the-browser-demo-against-the-existing-stack)), open `http://127.0.0.1:8080` and check the pill says **AWS LIVE · US-EAST-1**. All five bundled papers are already indexed. Open *Attention Is All You Need*. Use full screen; press `A` to hide the architecture if the projector is small.

| Time | Do | Say |
| --- | --- | --- |
| 0:00–0:30 | Point at the whole screen | The problem (long papers hide short answers) and RAG in one line: retrieve the relevant passages, then generate only from them. |
| 0:30–1:30 | Open the GAN paper and press **Re-index live** | Narrate the top diagram as it lights up: presigned PUT straight to S3 → S3 event → λ process → Textract is gated on this account so pypdf reads the text layer → chunks written to DynamoDB → Streams trigger λ embed → Titan vectors. The counter and event stream are real. READY arrives in about 10–15 s. |
| 1:30–2:45 | Back on the Transformer paper, click **How does self-attention work…** | Watch the Ask lane: λ query embeds the question and ranks 38 chunks (retrieval time shows on the node), λ answer returns HTTP 202, SQS queues the job, the worker calls Nova. Point at the Retrieve / Queue / Generate timings. |
| 2:45–3:30 | Click a citation chip, then the evidence strip | The reader jumps to the cited page so the claim can be checked. The strip shows where in the paper the evidence lives; dots are pages actually cited, dimmed cards were retrieved but not used. |
| 3:30–4:15 | Click **Off-topic test ↯** | The question is outside the paper, so the answer says there is not enough evidence. That is the grounding working, not a failure. |
| 4:15–5:00 | Click the **SQS** and **API Gateway** nodes; open the event stream with `` ` `` | Each card states the real configuration from `template.yaml` (throttling, DLQ, IAM). Close with the honest limits: OCR is gated, accuracy is not yet benchmarked. |

The numbers on screen are measured, not decorative: node metrics and the ingest panel come from the document and answer-job records; timings are measured by the browser around each API call.

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
| What do the colours and moving dots in the diagram mean? | Orange marching edges and dots are work in progress right now, green is finished, red is failed. They are driven by the polled document and job states, not by a timer. |
| What is the relevance strip under the answer? | One cell per page. Its brightness is the best cosine similarity between the question and any chunk on that page, among the top 10 retrieved. Dots mark pages the answer actually cites. |
| Why are some source cards dimmed? | The worker sends the top five passages to Nova, but the model may cite only some of them. Dimmed cards were retrieved but not cited, which helps judge how the answer was built. |
| How is the latency split? | Retrieve is the synchronous `/query` call. Queue is the wait from `POST /answer` until the worker marks the job GENERATING (includes a possible Lambda cold start). Generate is the Nova call until COMPLETED. |
| Why did the big survey take minutes? | 144 pages became 719 chunks, and DynamoDB Streams invokes the embedding Lambda once per chunk with batch size 1. It took 283 s. Larger batches or parallel shards would speed this up at the cost of coarser retries. |
| What is the deployment/service model? | AWS public cloud. The application uses managed, serverless services: Lambda (functions), API Gateway, S3, DynamoDB, SQS/SNS, Textract, and Bedrock. SAM/CloudFormation provides infrastructure as code. |
| How would you control cost? | Limit PDF size/pages/chunks and search breadth, use asynchronous work only when needed, inspect per-service usage, set account budgets, and test with small PDFs. A budget and measured per-question cost are not yet configured. |

## Evidence and limits to state precisely

- The repository contains a deployable SAM template, six handlers, a signed Python client, a smoke-test command, and local integration tests. See `README.md`, `ARCHITECTURE.md`, and `ROADMAP.md` for the current status.
- Local tests simulate AWS data services and control Textract/Bedrock replies. They prove orchestration and many failure checks, **not** live IAM permissions, OCR accuracy, model quality, or cloud latency.
- On 27 November 2026 in `us-east-1`, a separate AWS CloudShell session successfully invoked Titan V2 and the Nova 2 Lite US inference profile through Bedrock Converse. The earlier DeepSeek R1 invocation was blocked as Legacy. These direct probes do not exercise the deployed Lambda roles or the PDF pipeline.
- The `rag-pdf` CloudFormation stack in `us-east-1` passed the live smoke at commit `a39914e`. Fresh document `6512893e0649491591ee0d69c68a3ff2` reached `READY` with 38 chunks via `pypdf`; retrieval returned passages; Nova 2 Lite returned a nonempty answer and sources from that document, including S1 page 2 and S2 page 5. This verifies the deployed text-PDF path for one sample.
- On 27 November 2026, the browser demo at Mac `localhost:8080` used the temporary `ucs531-demo` AWS login profile to upload the same Transformer sample as document `90cedb25809042298d83b23f8eb9711e`. The interface showed 37/38 indexed chunks and then `READY` 38/38 via `pypdf`. A preset question completed with a Nova answer and five source cards; S4 page 5 excerpt expanded. This verifies one real browser-to-AWS flow. Browser failure states and PDF new-tab navigation were not checked in that run.
- After the UI race fix, a second sample upload first surfaced a transient AWS request failure in the browser. The retry succeeded as document `8334410045ae4b8e945c37f0bcd49988`, reached `READY` 38/38, and returned another five-source cited answer. This verifies the visible error and retry path; asynchronous `FAILED` job states and PDF new-tab navigation remain unchecked.
- Later the same day the redesigned interface (Folio) was run against the same stack: all five bundled papers reached `READY` (Transformer 38 chunks, BERT 54, ResNet 52, GAN 25, LLM Survey 719 from 144 pages); a live GAN re-index went from upload to `READY` in 10–13 s with each state visible; "How does self-attention work in the encoder and decoder?" returned an answer citing pages 3 and 5 in 7.3 s; and the off-topic question "Who won the 2022 FIFA World Cup?" was declined for lack of evidence.
- Textract returned `SubscriptionRequiredException` under the account's Free plan. No billing-plan change was made. Textract OCR remains blocked and unverified, and a pypdf result does not show OCR on scanned pages.
- Current design limits include 25 MiB PDFs, 500 Textract pages, 2,000 chunks per document, and 2,500 chunks per search. The pypdf fallback is capped at 10 MiB, 200 pages, and 1 million characters. It cannot OCR scanned pages. The browser UI is an operator-run local adapter; a public multi-user login, owner-scoped deletion, measured answer-quality benchmark, and automatic recovery for every hard-timeout state remain future work.

**Good closing line:** “The live text-PDF path now works from upload through cited answer. My next checks are citation accuracy, latency, and cost across the included papers; OCR needs Textract access and its own test.”
