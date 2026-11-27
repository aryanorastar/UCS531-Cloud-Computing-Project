# Serverless PDF Q&A on AWS

Private repository: [aryanorastar/UCS531-Cloud-Computing-Project](https://github.com/aryanorastar/UCS531-Cloud-Computing-Project).

Upload a PDF, wait for text extraction and indexing, and ask questions answered from retrieved passages. The backend uses S3, asynchronous Textract, DynamoDB, Bedrock Titan embeddings, and Bedrock Amazon Nova 2 Lite answers.

## Current status

All six Lambda handlers, the shared client, an AWS SAM deployment, integration tests, and GitHub Actions workflows are implemented. Local tests simulate AWS storage and events and stub Textract/Bedrock responses; they do not validate a live model. The SAM template validates and packages for Python 3.12. A separate local demonstration parses text from an actual sample PDF and exercises the handlers with simulated AWS services and deterministic model substitutes.

**Live stack deployment and upload-to-answer verification remain pending.** On 27 November 2026, direct Titan V2 invocation and a Nova 2 Lite Converse invocation succeeded from AWS CloudShell in `us-east-1`. The earlier DeepSeek R1 invocation was blocked as a Legacy model in that account, which prompted the switch to Nova 2 Lite. These model probes do not test the SAM stack, Lambda execution roles, Textract, or the complete PDF flow. No AWS profile or deployment role is configured in the local evaluation workspace. The repository remains private. See [ARCHITECTURE.md](ARCHITECTURE.md) and [ROADMAP.md](ROADMAP.md) for implementation scope and remaining work.

## Full flow

1. An IAM-signed request to `POST /upload-url` registers a document and returns a 15-minute presigned S3 PUT URL.
2. The client streams the PDF into a private, versioned bucket using the returned headers.
3. `process_document_batch` verifies the stored version's size and PDF header and starts an idempotent Textract job.
4. `handle_textract_result` reads all result pages, creates overlapping text chunks with page references, and writes deterministic pending chunks.
5. DynamoDB Streams invokes `generate_embeddings` immediately. Chunk completion and the document's progress counter are committed atomically. When all chunks are indexed, document status becomes `READY`.
6. `POST /query` returns relevant passages using exact cosine similarity within the caller's document scope.
7. `POST /answer` queues a job and returns HTTP 202. The worker retrieves trusted passages itself, invokes Nova 2 Lite, and stores an answer with source metadata. The client polls `GET /answers/{job_id}`.

## Quick start

Use Python 3.12:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
pytest -q
python -m scripts.local_demo
sam validate --lint --region us-east-1
sam build --region us-east-1
```

If `python3.12` is unavailable but `uv` is installed, create the environment with `uv venv --seed --python 3.12 .venv`, activate it, and run `uv pip install -r requirements-dev.txt` before the commands above. `--seed` installs pip inside the environment, which SAM needs for its build.

The local demo prints each state transition, retrieved page references, an extractive answer, and an owner-isolation check. It uses real text from the included Transformer PDF; Moto replaces S3/DynamoDB/SQS, pypdf replaces Textract, and deterministic stand-ins replace Titan and Nova 2 Lite. **It requires no AWS account and is not evidence of live OCR, model accuracy, or cloud deployment.** Pass `--pdf` and `--question` to try another text-based PDF and question.

After signing in to your default AWS profile, deploy and run a real sample PDF:

```sh
python -m scripts.deploy --smoke-test
```

This provisions billable AWS resources and performs Textract/model calls. The default is `us-east-1`, with `amazon.titan-embed-text-v2:0` and the `us.amazon.nova-2-lite-v1:0` US cross-region inference profile. The template supports `us-east-1`, `us-east-2`, and `us-west-2` as source regions; this US profile is not the original Mumbai deployment path. [AWS's Nova 2 Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html) describes the profile and its routing regions.

The script exports stack outputs to ignored `deployment.json`. Set `RAG_API_BASE_URL` to its `ApiBaseUrl` output, including the stage, before using the notebook or client. API calls use your AWS credential chain and require `execute-api:Invoke` permission. [Deployment and GitHub OIDC setup](docs/DEPLOYMENT.md) explains account prerequisites, setup, and teardown.

## Client example

```python
from client import RagClient

rag = RagClient()  # RAG_API_BASE_URL and default AWS profile
identifier = rag.upload("pdfs/Attention Is All You Need.pdf")
rag.wait_document(identifier)
result = rag.answer("How does the Transformer use attention?", identifier)
print(result["answer"])
print(result["sources"])
```

`index.ipynb` uses this same client. It supports batch uploads, readiness polling, retrieval diagnostics, and answer polling. To use a named profile, set `AWS_PROFILE` or pass `profile=` to `RagClient` and deployment commands. Notebook outputs stay cleared in Git.

## Repository

| Path | Responsibility |
| --- | --- |
| `lambda_functions/` | Six handlers, shared contracts/retrieval code, and packaged dependencies |
| `template.yaml` | Complete SAM application infrastructure and scoped execution policies |
| `client.py` | IAM signing, streamed uploads, readiness checks, and answer polling |
| `scripts/deploy.py` | Credential/model preflight, build/deploy, stack outputs, optional live smoke test |
| `scripts/smoke_test.py` | Real upload-to-answer verification against a deployed API |
| `scripts/local_demo.py` | Offline, step-by-step handler demonstration using actual PDF text and simulated services |
| `scripts/bootstrap_github.py` | One-time AWS OIDC bootstrap and optional GitHub variable configuration |
| `infra/github-oidc.yaml` | OIDC trust, deployment roles, and private artifact bucket |
| `.github/workflows/` | Tests/build and optional automated AWS deployment |
| `tests/` | AWS-simulated integration, contracts, isolation, and failure checks |
| `docs/` | Deployment, API contracts, ingestion, and notebook guides |
| `pdfs/` | Five unchanged research papers for demonstrations |

## Baseline limits

The default limits are 25 MiB per PDF, 500 extraction pages, 2,000 chunks per document, and 2,500 chunks per search. Retrieval is an exact document-partition query, not an indexed vector database. Ownership is per IAM user or role; sessions of the same role share that scope. A web interface, stronger multi-user login, document deletion, and measured answer-quality evaluation remain future work.

[Lab evaluation guide](docs/EVALUATION_GUIDE.md) · [Upload API](docs/2-Upload_Endpoint.md) · [Ingestion](docs/3-Data_Ingestion.md) · [Query and answer APIs](docs/4-RAG_Query_API.md) · [Notebook usage](docs/5-Testing_Scripts.md) · [Sample questions](docs/Sample_Questions.md)
