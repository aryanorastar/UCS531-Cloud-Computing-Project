# Part 2: Upload registration and document status

Handler: [get_presigned_url.py](../lambda_functions/get_presigned_url.py). Both routes require an AWS IAM-signed request. Use [the shared client](../client.py) to sign requests and stream PDF uploads.

## POST /upload-url

Request:

```json
{"filename":"paper.pdf","size_bytes":12345}
```

The filename must end in `.pdf` and contain no directory/control components. Exact size is required and must be 5 bytes to 25 MiB. The endpoint creates a fresh 32-character document ID and an owner-scoped S3 key; it returns `document_id`, `upload_url`, `upload_headers`, `expires_in` (900 seconds), and `status_url`.

Send the PDF bytes with PUT to `upload_url` using the exact returned headers. The signature binds content type and content length. The application uses the private bucket's default encryption; the client does not need direct S3 permissions beyond the signed URL. The starter validates the stored version's actual size and PDF header before invoking Textract.

## GET /documents/{document_id}

Returns the caller's document ID, filename, processing state, expected/completed chunk counts, timestamps, and a recorded error when available. States are `AWAITING_UPLOAD`, `EXTRACTING`, `EMBEDDING`, `READY`, and `FAILED`. Another owner's document returns 404.

Upload success is not readiness. `RagClient.wait_document` polls this endpoint, stops on a recorded failure, and has a client timeout. Hard timeouts/delivery failures may require failure-queue investigation. See [deployment operations](DEPLOYMENT.md).
