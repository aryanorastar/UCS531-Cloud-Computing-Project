# Serverless RAG Pipeline on AWS for Document Q&A

Private project repository: [aryanorastar/UCS531-Cloud-Computing-Project](https://github.com/aryanorastar/UCS531-Cloud-Computing-Project).

This project describes an AWS application that accepts PDF documents, extracts their text, and answers questions using relevant passages from those documents. Retrieval-Augmented Generation (RAG) supplies retrieved text to an AI model as context for its answer.

## Current implementation

Reviewed on 12 October 2026. The repository contains a Python notebook client, manual AWS setup guides, and five sample research papers. **The backend Lambda source files referenced by the guides are absent.** There is no infrastructure template, dependency manifest, automated test suite, or web interface. A working deployment in this project's AWS account has not been verified.

| Included | Purpose |
| --- | --- |
| `index.ipynb` | Requests an upload URL, uploads PDFs to S3, then calls `/query` and `/answer` and prints answers with source excerpts. |
| `docs/` | Describes the intended AWS infrastructure and includes sample questions. |
| `pdfs/` | Five papers for ingestion and question-answering demonstrations. |
| `ARCHITECTURE.md` | Explains the documented pipeline, current evidence, and design gaps. |
| `ROADMAP.md` | Tracks the implementation checklist and recommended improvement order. |

The notebook uses your configured API and fresh document IDs. Saved execution outputs have been cleared. Its presence alone does not provision AWS resources or implement the backend.

## Documented workflow

1. The client calls `POST /upload-url` to receive a presigned S3 upload URL and document ID.
2. The client uploads a PDF directly to S3.
3. An S3 event starts an asynchronous Textract job. Textract sends completion status to SNS.
4. A result handler retrieves the extracted text, divides it into chunks, and stores them in DynamoDB.
5. An EventBridge schedule runs an embedding generator every five minutes. It uses Bedrock Titan to turn chunks into vectors.
6. `POST /query` embeds the question and ranks stored vectors by cosine similarity, returning the top chunks.
7. The client sends the question and chunks to `POST /answer`, which is intended to use a Bedrock DeepSeek model and return an answer with sources.

These are the intended backend behaviors described in the guides; their source code is not included. The documented DynamoDB design stores vectors and relies on application code to compare them.

## Repository structure

```text
.
├── ARCHITECTURE.md
├── ROADMAP.md
├── README.md
├── index.ipynb
├── docs/
│   ├── 1-Aws_Setup.md
│   ├── 2-Upload_Endpoint.md
│   ├── 3-Data_Ingestion.md
│   ├── 4-RAG_Query_API.md
│   ├── 5-Testing_Scripts.md
│   └── Sample_Questions.md
└── pdfs/
    └── five sample research papers
```

## Notebook configuration

The notebook needs Python, Jupyter, the `requests` package, and a compatible deployed API. Dependency versions have not yet been specified.

Set `RAG_API_BASE_URL` to **your own API's invoke URL, including its stage**. You can set it in the notebook before running the client cells:

```python
import os

os.environ["RAG_API_BASE_URL"] = "https://YOUR-API-ID.execute-api.ap-south-1.amazonaws.com/dev"
```

The client stops when no API URL is configured. Run the upload helper cell and batch upload cell, wait for backend processing, then run the query helper cell and question cell. The question cell selects the document ID returned by the current upload. A processing-status endpoint is not yet implemented, so upload completion does not establish that the document is ready for questions.

## Setup guides

The guides describe a manual setup and refer to backend files that still need to be supplied. Consult the architecture review before deploying; the permission model, database access patterns, and API timeouts require attention.

- [AWS infrastructure setup](docs/1-Aws_Setup.md)
- [Upload endpoint](docs/2-Upload_Endpoint.md)
- [Asynchronous ingestion](docs/3-Data_Ingestion.md)
- [Retrieval and answer endpoints](docs/4-RAG_Query_API.md)
- [Notebook usage](docs/5-Testing_Scripts.md)
- [Sample questions](docs/Sample_Questions.md)
