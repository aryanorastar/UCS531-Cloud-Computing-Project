"""IAM-signed client shared by the notebook and the live end-to-end smoke test."""

import os
import re
import time
from pathlib import Path

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


class AwsAuth(requests.auth.AuthBase):
    def __init__(self, session, region):
        self.session = session
        self.region = region

    def __call__(self, prepared):
        credentials = self.session.get_credentials()
        if credentials is None:
            raise RuntimeError("Configure an AWS profile or AWS SSO sign-in before calling the API.")
        request = AWSRequest(
            method=prepared.method, url=prepared.url, data=prepared.body, headers=dict(prepared.headers)
        )
        SigV4Auth(credentials.get_frozen_credentials(), "execute-api", self.region).add_auth(request)
        prepared.headers.update(dict(request.headers))
        return prepared


class RagClient:
    def __init__(self, api_base_url=None, *, profile=None, region=None):
        self.api_base_url = (api_base_url or os.environ.get("RAG_API_BASE_URL", "")).strip().rstrip("/")
        match = re.fullmatch(
            r"https://[a-z0-9]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com/[A-Za-z0-9]+", self.api_base_url
        )
        if not match:
            raise ValueError(
                "Set RAG_API_BASE_URL to your deployed API Gateway invoke URL, including its stage."
            )
        region = region or match.group(1)
        self.aws = boto3.Session(profile_name=profile, region_name=region)
        self.http = requests.Session()
        self.http.auth = AwsAuth(self.aws, region)

    def request(self, method, path, **kwargs):
        result = self.http.request(method, self.api_base_url + path, timeout=(5, 60), **kwargs)
        try:
            data = result.json()
        except ValueError as error:
            raise RuntimeError(f"API returned non-JSON data (HTTP {result.status_code}).") from error
        if not result.ok:
            raise RuntimeError(
                f"API request failed (HTTP {result.status_code}): {data.get('error', data.get('message', 'unknown error'))}"
            )
        return data

    def upload(self, file_path):
        path = Path(file_path)
        if not path.is_file() or path.suffix.lower() != ".pdf":
            raise ValueError("Select an existing PDF file.")
        with path.open("rb") as pdf:
            if pdf.read(5) != b"%PDF-":
                raise ValueError("File does not contain a PDF header.")
        registration = self.request(
            "POST", "/upload-url", json={"filename": path.name, "size_bytes": path.stat().st_size}
        )
        # Presigned S3 requests have their own signature; do not apply execute-api auth.
        with path.open("rb") as pdf:
            uploaded = requests.put(
                registration["upload_url"], data=pdf, headers=registration["upload_headers"], timeout=(5, 120)
            )
        if not uploaded.ok:
            raise RuntimeError(f"S3 upload failed (HTTP {uploaded.status_code}).")
        return registration["document_id"]

    def wait_document(self, document_id, *, timeout=1800, interval=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            document = self.request("GET", f"/documents/{document_id}")
            if document["status"] == "READY":
                return document
            if document["status"] == "FAILED":
                raise RuntimeError(document.get("error_message", "Document processing failed."))
            time.sleep(interval)
        raise TimeoutError(
            "Document processing did not become ready before the client timeout. Check status and failure logs."
        )

    def query(self, question, document_id=None, top_k=5):
        return self.request(
            "POST", "/query", json={"question": question, "document_id": document_id, "top_k": top_k}
        )

    def answer(self, question, document_id=None, top_k=5, *, timeout=900, interval=2):
        queued = self.request(
            "POST", "/answer", json={"question": question, "document_id": document_id, "top_k": top_k}
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.request("GET", f"/answers/{queued['job_id']}")
            if job["status"] == "COMPLETED":
                return job["result"]
            if job["status"] == "FAILED":
                raise RuntimeError(job.get("error_message", "Answer generation failed."))
            time.sleep(interval)
        raise TimeoutError(
            "Answer generation did not finish before the client timeout. Check the answer job and failure logs."
        )
