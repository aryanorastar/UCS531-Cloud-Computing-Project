# Lab evaluation guide: Serverless PDF Q&A on AWS

Use this as a speaking and demo checklist. The project is a **serverless retrieval-augmented generation (RAG) pipeline** for research PDFs. It registers a PDF, extracts and indexes its text, then answers questions with passages and page references from that PDF.

## The 30-second explanation

> “I built an event-driven PDF question-answering system on AWS. A client uploads a PDF directly to a private S3 bucket through a short-lived signed URL. S3 starts asynchronous Textract OCR; a notification creates page-aware chunks in DynamoDB; DynamoDB Streams triggers Titan embeddings. A question is embedded and compared with the stored chunks, and an SQS worker asks DeepSeek R1 to answer from the retrieved evidence. The API is IAM-authenticated, answers are polled asynchronously, and the response includes source pages. I can demonstrate the complete orchestration with local AWS simulations. A live AWS/model run is a separate acceptance step and should be claimed only if it has actually passed.”

**Define RAG simply:** first *retrieve* relevant passages from the uploaded material, then *generate* an answer using those passages as context. The model is not fine-tuned on these papers.

## Architecture to draw on the board

```text
                  upload                         extraction and indexing
Python client ── POST /upload-url ── API Gateway ── Lambda ── DynamoDB documents
       │                                      │
       └── presigned PUT ─────────────────── S3 (private, versioned)
                                               │ object event
                                               ▼
                                          Lambda ── Textract (async)
                                                       │ SNS result
                                                       ▼
                                            Lambda ── DynamoDB chunks
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
                                                 └── Bedrock DeepSeek R1
       └──────── GET /answers/{job_id} ── answer + source filenames/pages
```

**Key states:** document `AWAITING_UPLOAD → EXTRACTING → EMBEDDING → READY` (or `FAILED`); answer job `QUEUED → GENERATING → COMPLETED` (or `FAILED`). Upload success does not mean the document is ready.

## Five-minute demonstration

Before the evaluation, install the dependencies in a Python 3.12 virtual environment and run the commands yourself. On a machine with `uv`, use `uv venv --seed --python 3.12 .venv`, `source .venv/bin/activate`, and `uv pip install -r requirements-dev.txt`. Keep the repository root as the working directory. Choose the **live path only after the deployment and end-to-end smoke test have succeeded**. Have the architecture diagram and the relevant test open before beginning; do not spend the five minutes waiting for a new deployment or a long PDF extraction.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:35 | The diagram above or `ARCHITECTURE.md` | State the problem, the RAG idea, and why processing is event-driven. |
| 0:35–1:20 | `template.yaml` | Point out the API, private S3 bucket, DynamoDB tables/stream, Textract/SNS, SQS, Bedrock permissions, alarms, and six Lambda handlers. SAM provisions the stack as code. |
| 1:20–2:15 | `client.py` and `lambda_functions/get_presigned_url.py` | Explain IAM signing, direct S3 upload, 15-minute URL, server-side document identity, and status polling. |
| 2:15–3:10 | `lambda_functions/handle_textract_result.py`, `lambda_functions/generate_embeddings.py` | Explain page-aware overlapping chunks, deterministic IDs, stream-triggered embeddings, and atomic progress counting. |
| 3:10–4:05 | `lambda_functions/shared/rag.py`, `lambda_functions/generate_answer.py` | Explain document-scoped cosine retrieval, asynchronous generation, and why the worker retrieves passages itself instead of trusting client-supplied text. |
| 4:05–5:00 | Run the appropriate verification below | State exactly what was exercised. End with one limitation and one measured next step. |

### Local demonstration when no AWS account is configured

```sh
python -m scripts.local_demo
python -m pytest -q tests/test_pipeline.py::test_full_sample_pdf_upload_to_answer
python -m pytest -q
```

The local demo parses text from the actual Transformer PDF, prints each state transition and retrieved page, produces a deterministic extractive answer, and checks another IAM identity cannot read the document. Moto simulates S3/DynamoDB/SQS; pypdf substitutes for Textract; deterministic functions substitute for Titan and DeepSeek. The focused test also runs all six handlers in sequence with controlled Textract/Bedrock responses and checks extraction pagination, duplicate delivery, and rejection of forged client passages. The wider suite covers isolation, malformed files, retries, failure states, signing, and model contracts. **Describe this as local integration verification, not as a live AWS or AI-quality result.**

If a command fails on the evaluation machine, show the already obtained test output and the exact environment used. Do not call a failed run a pass.

### Live demonstration when AWS is already deployed and verified

Set `RAG_API_BASE_URL` to the stack's `ApiBaseUrl` output, including the stage, and use the same AWS IAM identity that owns the uploaded document. Run against the existing stack:

```sh
python -m scripts.smoke_test --api-url "$RAG_API_BASE_URL"
```

The smoke test uploads the Transformer paper, waits for `READY`, checks document-scoped passages, asks a question, and checks the answer and source pages. The first run can take several minutes and uses billable Textract and Bedrock calls. For a timed presentation, start it before the five-minute slot and show its final output plus the document and answer states. A passing smoke test verifies service integration and source metadata; it does **not** establish answer accuracy across the corpus.

## Explain the cloud design as a scenario answer

**Scenario:** “Five students upload papers at different times; some PDFs are long, and answer generation can be slow. How would you make this reliable without managing servers?”

**Proposal:** API Gateway + Lambda for the API, direct S3 uploads, asynchronous Textract with SNS, DynamoDB for state and chunks, Streams for indexing, SQS for long answer jobs, and Bedrock for embeddings/generation. SAM declares the resources and permissions.

**Why:** S3 handles large object storage without routing PDF bytes through the API. Events and queues decouple long work from request deadlines. Lambda scales with demand, and DynamoDB stores progress durably. The client can poll explicit state instead of assuming an upload instantly creates an answer.

**Trade-off:** Exact cosine search reads a bounded set of stored vectors, so retrieval cost and latency grow with corpus size. A dedicated vector index becomes appropriate after measuring that limit. Model calls, Textract pages, requests, storage, and logs also incur cost; serverless is pay-for-usage, not free.

## Likely viva questions

| Question | Short answer |
| --- | --- |
| Why S3 instead of DynamoDB for the PDF? | S3 is object storage for the original file, with versioning and private access. DynamoDB holds small metadata, job state, chunks, and vectors that are queried by key. |
| Why a presigned upload URL? | The client sends PDF bytes straight to S3. The API only registers a controlled object key and signs a short-lived upload, reducing API transfer and timeout pressure. The processing Lambda still validates the stored PDF header and size. |
| Why asynchronous Textract and SNS? | Extraction of a large PDF can exceed a synchronous API request. Textract performs the job and notifies the result handler when it finishes. |
| Why DynamoDB Streams? | A new pending chunk automatically triggers embedding. A transaction completes the chunk and increments the document's progress together, so duplicate events do not double-count completion. |
| What is an embedding? | A numeric vector representing text. The question and chunks use the same Titan model and vector dimension; cosine similarity ranks the closest chunks. |
| Why overlap chunks? | A fact at a chunk boundary can otherwise lose surrounding context. This implementation uses approximately 1,500-character chunks with 200-character overlap and retains page references. |
| Why SQS for `/answer`? | Generation may outlast an API Gateway request. The API returns HTTP 202 and a job ID; the worker processes it with retries, and the client polls the result. |
| How do you reduce hallucinations? | Retrieve from the selected document, pass only those passages to the model, ask for citations and abstention, and return stored source metadata. This is a mitigation; citation correctness and answer quality still need measured evaluation. |
| What stops one caller reading another's paper? | API Gateway requires IAM SigV4. The handlers derive ownership from the AWS principal and check it on status, retrieval, and answer jobs. Sessions of the same role share one scope, so separate users need distinct principals or future login. |
| What if an event arrives twice? | Textract starts with a deterministic token; extraction uses deterministic chunk IDs and conditional writes; embedding completion and the counter change atomically. Duplicate external model calls can still happen under concurrent delivery. |
| What happens on failure? | Recorded failures move a document/job to `FAILED`; retries are bounded and failed deliveries can go to failure queues with alarms. Hard timeouts may leave a state in progress, so automated reconciliation remains future work. |
| Why not a vector database now? | The initial corpus is small. A document-partition query and exact cosine ranking are simpler and auditable, with explicit search limits. Measure latency and corpus size before adding an index. |
| What is the deployment/service model? | AWS public cloud. The application uses managed, serverless services: Lambda (functions), API Gateway, S3, DynamoDB, SQS/SNS, Textract, and Bedrock. SAM/CloudFormation provides infrastructure as code. |
| How would you control cost? | Limit PDF size/pages/chunks and search breadth, use asynchronous work only when needed, inspect per-service usage, set account budgets, and test with small PDFs. A budget and measured per-question cost are not yet configured. |

## Evidence and limits to state precisely

- The repository contains a deployable SAM template, six handlers, a signed Python client, a smoke-test command, and local integration tests. See `README.md`, `ARCHITECTURE.md`, and `ROADMAP.md` for the current status.
- Local tests simulate AWS data services and control Textract/Bedrock replies. They prove orchestration and many failure checks, **not** live IAM permissions, OCR accuracy, model quality, or cloud latency.
- A real deployment and real-model smoke test must be described as verified only after it passes in the actual AWS account. Keep the exact region, command, and output as evidence.
- Current design limits include 25 MiB PDFs, 500 extraction pages, 2,000 chunks per document, and 2,500 chunks per search. No web UI, owner-scoped deletion, measured answer-quality benchmark, or automatic recovery for every hard-timeout state is claimed.

**Good closing line:** “The core contribution is the complete, stateful cloud workflow and its failure-aware boundaries. My next measurement is a live sample-paper run followed by citation accuracy, latency, and cost across the five included PDFs.”
