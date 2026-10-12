# Part 3: Asynchronous PDF ingestion

The SAM template provisions triggers and permissions for these handlers:

1. [process_document_batch.py](../lambda_functions/process_document_batch.py) receives S3 object-creation events under `uploads/` with `.pdf` suffix. It checks registered ownership/key, size, PDF header, and S3 version; freezes the first accepted version; starts Textract with an idempotent token; stores the job ID.
2. [handle_textract_result.py](../lambda_functions/handle_textract_result.py) receives SNS completion notifications. It verifies the job/document link, retrieves every Textract page, assembles page text, splits overlapping chunks, records the expected count, and conditionally inserts deterministic `PENDING` chunks.
3. [generate_embeddings.py](../lambda_functions/generate_embeddings.py) receives newly inserted pending chunks through DynamoDB Streams. Titan V2 generates normalized vectors. A DynamoDB transaction stores a completed vector and increments the document count together. When the count equals the expected total, the document becomes `READY`.

Embedding runs are event-driven; no five-minute full-table polling schedule remains. The stream filter ignores updates so vector writes cannot recursively invoke embedding work.

Chunk size defaults to 1,500 characters and overlap to 200, preserving page references and preferring word boundaries. This is a baseline chunker; sentence/section-aware extraction and relevance evaluation are future work. PDFs are limited to 500 pages and 2,000 chunks.

Duplicate notifications do not overwrite completed chunks or double-count progress. External model calls may still repeat under concurrent at-least-once delivery. Three recorded embedding failures mark a document failed; stream retries and asynchronous handler retries are bounded and have failure destinations. Operators still need recovery tools for hard timeouts/delivery exhaustion.

[Architecture](../ARCHITECTURE.md) · [Deployment/failure operations](DEPLOYMENT.md)
