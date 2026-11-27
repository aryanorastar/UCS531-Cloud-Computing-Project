# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Folio, the lab demo interface: plain HTML, CSS, and JavaScript (no build step, no external fonts or libraries) served by a small Python standard-library process. The process uses the existing IAM-signed `RagClient` and AWS credential chain. This keeps AWS credentials out of browser code and avoids a frontend build step during the lab.

## Users

Aryan is the operator during a UCS531 lab evaluation. The teacher watches the live workflow and inspects its result. This is a demonstration surface, not an open multi-user product.

## Product Purpose

Make the deployed serverless PDF question-answering pipeline visible and usable: pick or upload a research PDF, watch each AWS service light up as extraction and indexing reach `READY`, ask a question, and inspect the answer beside the cited page of the PDF, the retrieved passages and their similarity scores.

## Operating Context

The backend is the `rag-pdf` AWS SAM stack in `us-east-1`. The browser demo runs on Aryan's authorized local Mac and opens at `127.0.0.1`; CloudShell does not provide an inbound browser preview for this local server. The same Python client can still run a command-line smoke test. A five-minute presentation and the included research PDFs are part of the evaluation workflow.

## Capabilities and Constraints

- API calls require IAM SigV4 and are made by the local Python server, using its AWS identity. Browser JavaScript never receives AWS credentials.
- A browser upload goes through the local demo server, which uses the existing presigned S3 upload flow. The production upload API and its ownership checks remain intact.
- The backend attempts Textract. In this account Textract returned `SubscriptionRequiredException`; the deployed fallback extracts an existing PDF text layer with pypdf and cannot OCR scanned pages.
- Document and answer jobs have asynchronous states. The UI must show progress, failure messages, and source page metadata without inventing completion or answer quality.
- The browser demo is intended for an operator-controlled environment. Public hosting, end-user accounts, and a general browser authentication system are outside its current scope.

## Evidence on Hand

- The deployed 15-page Transformer PDF smoke test reached `READY` with 38 chunks via pypdf, retrieved document-scoped passages, and returned a Nova 2 Lite answer with page-linked sources on 27 November 2026. See `ARCHITECTURE.md` for its precise scope.
- The repository contains five research PDFs, a nine-slide evaluation presentation, local tests, and a repeatable command-line smoke test.
- On 27 November 2026 all five bundled PDFs were indexed through the deployed stack (25 to 719 chunks), a browser question returned a cited answer in 7.3 s, and an off-topic question was declined for lack of evidence. See the README's verification table.
- No benchmark of citation accuracy across all papers or verified Textract OCR result exists.

## Product Principles

1. Show the actual state of the AWS workflow and make each next action obvious.
2. Keep the answer and its source pages together so the teacher can inspect the evidence.
3. Keep AWS credentials on the server side and preserve existing IAM and document ownership checks.
4. Distinguish a working text-PDF fallback from unverified OCR on scanned pages.
