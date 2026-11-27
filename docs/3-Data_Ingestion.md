# Part 3: PDF ingestion with a text-layer fallback

The SAM template provisions triggers and permissions for these handlers:

1. [process_document_batch.py](../lambda_functions/process_document_batch.py) receives S3 object-creation events under `uploads/` with `.pdf` suffix. It checks registered ownership/key, size, PDF header, and S3 version; freezes the first accepted version; starts Textract with an idempotent token when available. On `SubscriptionRequiredException` only, it reads the accepted version's existing text layer with pypdf and feeds that page text into shared chunk persistence.
2. [handle_textract_result.py](../lambda_functions/handle_textract_result.py) receives SNS completion notifications for the Textract path. It verifies the job/document link, retrieves every Textract result page, and feeds page text into the same chunk-persistence helper. Both paths split overlapping chunks, record the expected count, and conditionally insert deterministic `PENDING` chunks.
3. [generate_embeddings.py](../lambda_functions/generate_embeddings.py) receives newly inserted pending chunks through DynamoDB Streams. Titan V2 generates normalized vectors. A DynamoDB transaction stores a completed vector and increments the document count together. When the count equals the expected total, the document becomes `READY`.

Embedding runs are event-driven; no five-minute full-table polling schedule remains. The stream filter ignores updates so vector writes cannot recursively invoke embedding work.

Chunk size defaults to 1,500 characters and overlap to 200, preserving page references and preferring word boundaries. This is a baseline chunker; sentence/section-aware extraction and relevance evaluation are future work. The general limits are 25 MiB per PDF, 500 Textract pages, and 2,000 chunks. The pypdf fallback is deliberately narrower at 10 MiB, 200 pages, and 1 million extracted characters. It rejects encrypted PDFs and fails visibly on image-only PDFs because it cannot perform OCR. The document-status API reports `extraction_method` as `textract` or `pypdf` after the path is selected.

Duplicate notifications do not overwrite completed chunks or double-count progress. External model calls may still repeat under concurrent at-least-once delivery. Three recorded embedding failures mark a document failed; stream retries and asynchronous handler retries are bounded and have failure destinations. Operators still need recovery tools for hard timeouts/delivery exhaustion.

The initial live `rag-pdf` stack in `us-east-1` accepted a PDF upload, then Textract returned `SubscriptionRequiredException` under this account's Free plan. No billing-plan change was made. After the bounded fallback and scoped chunk-write permission were deployed, the live smoke at commit `a39914e` processed a fresh Transformer PDF into 38 `READY` chunks via `pypdf`, then completed retrieval and a Nova answer with source pages. That verifies text-layer extraction and the downstream cloud path for this sample. Textract OCR has not been verified in this account.

[Architecture](../ARCHITECTURE.md) · [Deployment/failure operations](DEPLOYMENT.md)
