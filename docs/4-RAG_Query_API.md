# Part 4: Retrieval and answer jobs

All routes require IAM-signed requests and check the caller's document/job ownership. Shared retrieval and Bedrock adapters live in [shared/rag.py](../lambda_functions/shared/rag.py).

## POST /query

Handler: [handle_query.py](../lambda_functions/handle_query.py).

```json
{"question":"How does attention work?","document_id":null,"top_k":5}
```

Use the current upload's document ID for a document-specific question; `null` searches only the caller's ready documents. Questions contain 1–2,000 characters and `top_k` is 1–10. Non-ready documents return 409; searches over 2,500 chunks return 413.

Retrieval embeds the question with Titan V2, queries document partitions with pagination, checks model/dimension compatibility, ranks cosine similarity, and returns `top_chunks`. Each result has document/chunk IDs, chunk index, filename, pages, text, and similarity score. Vectors are not exposed in the API response.

The store supports exact retrieval over a bounded corpus, not an indexed vector search. The owner index is eventually consistent for corpus-wide discovery; direct document status/chunk reads are consistent.

## POST /answer

Handler: [generate_answer.py](../lambda_functions/generate_answer.py), API mode.

Use the same question/document/top_k fields as `/query`. The API confirms scope/readiness, creates a job, sends its ID to SQS, and responds **HTTP 202** with `job_id`, `status: QUEUED`, and `status_url`.

Do not expect a synchronous answer body. Client-supplied `top_chunks` are ignored. The worker repeats trusted retrieval from storage, invokes `us.amazon.nova-2-lite-v1:0` through Bedrock Converse, and stores an answer and source metadata. The prompt requests grounded answers, source markers, and abstention without evidence. The live Transformer-PDF smoke at commit `a39914e` returned an answer with page-linked sources through the pypdf fallback; citation correctness and answer quality across the corpus still need measured evaluation.

## GET /answers/{job_id}

Returns job status and timestamps, plus `result` on completion or `error_message` on recorded failure. Result fields are `answer`, `sources`, and `model_id`. Sources include `source_id`, filename, document/chunk IDs, chunk index, pages, similarity score, and excerpt. Status is `QUEUED`, `GENERATING`, `COMPLETED`, or `FAILED`. Jobs expire after 24 hours; another owner's job returns 404.

`RagClient.answer` queues and polls automatically. Worker failures use partial SQS batch responses and retry limits; hard timeouts can temporarily leave a job in progress. Polling has a client timeout and deployment logs/queues are available for investigation.
