"""Serve a same-origin evaluation UI backed by the IAM-signed Python client.

The browser never receives AWS credentials or presigned S3 URLs. This process
uses the operator's existing AWS credential chain to call the deployed API.
"""

import argparse
import json
import mimetypes
import os
import re
import tempfile
import threading
import time
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import requests
from pypdf import PdfReader

from client import RagClient

ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = Path(__file__).resolve().parent / "static"
PAPERS_DIR = ROOT / "pdfs"
SAMPLE_PDF = PAPERS_DIR / "Attention Is All You Need.pdf"
STATE_DIR = ROOT / ".demo"
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_MULTIPART_BYTES = MAX_PDF_BYTES + 256 * 1024
MAX_JSON_BYTES = 8192
DOCUMENT_ID = re.compile(r"[0-9a-f]{32}\Z")


class DemoRequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def validated_id(value):
    if not isinstance(value, str) or not DOCUMENT_ID.fullmatch(value):
        raise DemoRequestError(400, "Expected a 32-character document or job ID.")
    return value


def question_input(data):
    question = data.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > 2000:
        raise DemoRequestError(400, "Question must contain 1–2000 characters.")
    document_ids = data.get("document_ids")
    if not isinstance(document_ids, list) or len(document_ids) != 1:
        raise DemoRequestError(400, "Select exactly one uploaded document.")
    document_id = validated_id(document_ids[0])
    top_k = data.get("top_k", 5)
    if type(top_k) is not int or not 1 <= top_k <= 10:
        raise DemoRequestError(400, "top_k must be an integer from 1 to 10.")
    return {"question": question.strip(), "document_id": document_id, "top_k": top_k}


def validated_pdf(filename, payload):
    if (
        not isinstance(filename, str)
        or not filename.lower().endswith(".pdf")
        or len(filename) > 200
        or any(character in filename for character in ("/", "\\"))
        or any(ord(character) < 32 for character in filename)
    ):
        raise DemoRequestError(400, "Choose a PDF filename without directory components.")
    if not 5 <= len(payload) <= MAX_PDF_BYTES:
        raise DemoRequestError(413, "For this demo, select a PDF no larger than 10 MiB.")
    if not payload.startswith(b"%PDF-"):
        raise DemoRequestError(400, "The selected file does not have a PDF header.")
    return filename, payload


def parse_pdf_multipart(content_type, body):
    if not content_type.lower().startswith("multipart/form-data;"):
        raise DemoRequestError(415, "Upload the PDF as multipart form data.")
    envelope = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    message = BytesParser(policy=default).parsebytes(envelope)
    if not message.is_multipart():
        raise DemoRequestError(400, "The upload form is malformed.")
    files = [
        part
        for part in message.iter_parts()
        if part.get_param("name", header="content-disposition") == "file"
    ]
    if len(files) != 1:
        raise DemoRequestError(400, "Upload exactly one PDF in the file field.")
    part = files[0]
    payload = part.get_payload(decode=True)
    if not isinstance(payload, bytes):
        raise DemoRequestError(400, "The PDF upload is empty or malformed.")
    return validated_pdf(part.get_filename(), payload)


def page_count(source):
    try:
        return len(PdfReader(source).pages)
    except Exception:  # A page count is display metadata; an unreadable file must not block the demo.
        return None


def paper_catalog(papers_dir):
    """List the bundled research PDFs the operator can index with one click."""
    papers = {}
    for path in sorted(Path(papers_dir).glob("*.pdf")) if Path(papers_dir).is_dir() else []:
        papers[path.name] = {
            "name": path.name,
            "title": path.stem,
            "pages": page_count(path),
            "size_bytes": path.stat().st_size,
            "url": f"/papers/{quote(path.name)}",
            "path": path.resolve(),
        }
    return papers


class Library:
    """Local record of documents this operator indexed, so the UI survives reloads."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def entries(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [
            entry
            for entry in data
            if isinstance(entry, dict) and DOCUMENT_ID.fullmatch(str(entry.get("document_id")))
        ]

    def get(self, document_id):
        return next((entry for entry in self.entries() if entry["document_id"] == document_id), None)

    def _write(self, entries):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        temporary.replace(self.path)

    def add(self, entry):
        with self.lock:
            entries = [item for item in self.entries() if item["document_id"] != entry["document_id"]]
            self._write([entry, *entries][:50])
        return entry

    def remove(self, document_id):
        with self.lock:
            entries = self.entries()
            remaining = [item for item in entries if item["document_id"] != document_id]
            self._write(remaining)
        return len(remaining) != len(entries)


def make_handler(
    client,
    *,
    static_root=STATIC_ROOT,
    sample_pdf=SAMPLE_PDF,
    papers_dir=None,
    state_dir=STATE_DIR,
):
    """Create a request handler; injecting a fake client keeps route tests local."""
    static_root = Path(static_root).resolve()
    sample_pdf = Path(sample_pdf).resolve()
    papers = paper_catalog(papers_dir if papers_dir is not None else sample_pdf.parent)
    if sample_pdf.name not in papers and sample_pdf.is_file():
        papers[sample_pdf.name] = {
            "name": sample_pdf.name,
            "title": sample_pdf.stem,
            "pages": page_count(sample_pdf),
            "size_bytes": sample_pdf.stat().st_size,
            "url": f"/papers/{quote(sample_pdf.name)}",
            "path": sample_pdf,
        }
    library = Library(Path(state_dir) / "library.json")
    upload_cache = Path(state_dir) / "uploads"
    allowed_hosts = {"localhost", "127.0.0.1", "::1"}

    def pdf_path(entry):
        if entry.get("paper") in papers:
            return papers[entry["paper"]]["path"]
        cached = upload_cache / f"{entry['document_id']}.pdf"
        return cached if cached.is_file() else None

    def with_reader(entry):
        has_pdf = pdf_path(entry) is not None
        return {**entry, "pdf_url": f"/api/documents/{entry['document_id']}/pdf" if has_pdf else None}

    class DemoHandler(BaseHTTPRequestHandler):
        def _send(self, status, payload, content_type, *, extra_headers=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for key, value in (extra_headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(payload)

        def _json(self, status, data):
            self._send(status, json.dumps(data).encode("utf-8"), "application/json; charset=utf-8")

        def _read_body(self, limit):
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError as error:
                raise DemoRequestError(411, "A Content-Length header is required.") from error
            if length < 1:
                raise DemoRequestError(400, "The request body is empty.")
            if length > limit:
                raise DemoRequestError(413, "The request exceeds the demo size limit.")
            body = self.rfile.read(length)
            if len(body) != length:
                raise DemoRequestError(400, "The request body was incomplete.")
            return body

        def _read_json(self):
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if content_type != "application/json":
                raise DemoRequestError(415, "Send JSON with application/json Content-Type.")
            try:
                data = json.loads(self._read_body(MAX_JSON_BYTES))
            except (ValueError, UnicodeDecodeError) as error:
                raise DemoRequestError(400, "The JSON request is invalid.") from error
            if not isinstance(data, dict):
                raise DemoRequestError(400, "The JSON request must be an object.")
            return data

        def _check_post_origin(self):
            # Browser requests from another site must not invoke the AWS-backed proxy.
            site = self.headers.get("Sec-Fetch-Site")
            if site and site not in {"same-origin", "none"}:
                raise DemoRequestError(403, "Only same-origin demo requests are accepted.")
            origin = self.headers.get("Origin")
            if origin and urlsplit(origin).netloc != self.headers.get("Host"):
                raise DemoRequestError(403, "Only same-origin demo requests are accepted.")

        def _check_host(self):
            host = self.headers.get("Host", "")
            try:
                hostname = urlsplit(f"http://{host}").hostname
            except ValueError:
                hostname = None
            if not hostname or hostname.lower() not in allowed_hosts:
                raise DemoRequestError(403, "Open this demo through localhost.")

        def _upload(self, filename, payload, *, paper=None):
            filename, payload = validated_pdf(filename, payload)
            started = time.monotonic()
            with tempfile.TemporaryDirectory(prefix="rag-demo-") as directory:
                path = Path(directory) / filename
                path.write_bytes(payload)
                pages = page_count(path)
                document_id = client.upload(path)
            if paper is None:
                # Keep a local copy so the reader can show this PDF after a page reload.
                upload_cache.mkdir(parents=True, exist_ok=True)
                (upload_cache / f"{document_id}.pdf").write_bytes(payload)
            entry = library.add(
                {
                    "document_id": document_id,
                    "filename": filename,
                    "paper": paper,
                    "pages": pages,
                    "size_bytes": len(payload),
                    "upload_ms": round((time.monotonic() - started) * 1000),
                    "added_at": int(time.time()),
                }
            )
            return {
                **with_reader(entry),
                "status": "AWAITING_UPLOAD",
                "completed_chunks": 0,
                "total_chunks": 0,
            }

        def _document_pdf(self, document_id):
            path = pdf_path(library.get(document_id) or {"document_id": document_id})
            if path is None:
                raise DemoRequestError(404, "No local copy of this PDF is available for the reader.")
            return path

        def _serve_file(self, path, *, content_type=None):
            if not path.is_file():
                raise DemoRequestError(404, "Page not found.")
            media_type = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self._send(200, path.read_bytes(), media_type)

        def _dispatch_get(self):
            path = unquote(urlsplit(self.path).path)
            if path == "/api/health":
                aws = getattr(client, "aws", None)
                credentials = aws.get_credentials() if aws is not None else True
                self._json(
                    200,
                    {
                        "ok": credentials is not None,
                        "region": getattr(aws, "region_name", "unknown"),
                        "api_url": getattr(client, "api_base_url", ""),
                    },
                )
                return
            if path == "/api/papers":
                public = [{k: v for k, v in paper.items() if k != "path"} for paper in papers.values()]
                self._json(200, {"papers": public, "default": sample_pdf.name})
                return
            if path == "/api/library":
                self._json(200, {"documents": [with_reader(entry) for entry in library.entries()]})
                return
            if path.startswith("/api/documents/") and path.endswith("/pdf"):
                document_id = validated_id(path.removeprefix("/api/documents/").removesuffix("/pdf"))
                self._serve_file(self._document_pdf(document_id), content_type="application/pdf")
                return
            if path.startswith("/api/documents/"):
                document_id = validated_id(path.removeprefix("/api/documents/"))
                self._json(200, client.request("GET", f"/documents/{document_id}"))
                return
            if path.startswith("/papers/"):
                paper = papers.get(path.removeprefix("/papers/"))
                if paper is None:
                    raise DemoRequestError(404, "Page not found.")
                self._serve_file(paper["path"], content_type="application/pdf")
                return
            if path.startswith("/api/answers/"):
                job_id = validated_id(path.removeprefix("/api/answers/"))
                data = client.request("GET", f"/answers/{job_id}")
                result = data.get("result")
                if isinstance(result, dict):
                    data = {**data, **result}
                self._json(200, data)
                return
            if path == "/sample.pdf":
                self._serve_file(sample_pdf, content_type="application/pdf")
                return
            if path == "/":
                path = "/static/index.html"
            if not path.startswith("/static/"):
                raise DemoRequestError(404, "Page not found.")
            relative = Path(path.removeprefix("/static/"))
            target = (static_root / relative).resolve()
            if not target.is_relative_to(static_root) or target.is_dir():
                raise DemoRequestError(404, "Page not found.")
            self._serve_file(target)

        def _dispatch_post(self):
            self._check_post_origin()
            path = urlsplit(self.path).path
            if path == "/api/documents":
                body = self._read_body(MAX_MULTIPART_BYTES)
                filename, payload = parse_pdf_multipart(self.headers.get("Content-Type", ""), body)
                self._json(201, self._upload(filename, payload))
                return
            if path == "/api/sample-document":
                name = sample_pdf.name
                if self.headers.get("Content-Length") not in {None, "0"}:
                    name = self._read_json().get("paper")
                    if not isinstance(name, str) or name not in papers:
                        raise DemoRequestError(400, "Choose one of the bundled sample papers.")
                if name not in papers:
                    raise DemoRequestError(404, "No bundled sample paper is available.")
                paper = papers[name]
                self._json(201, self._upload(name, paper["path"].read_bytes(), paper=name))
                return
            if path == "/api/library":
                document_id = validated_id(self._read_json().get("document_id"))
                document = client.request("GET", f"/documents/{document_id}")
                filename = document.get("filename") or "Research paper.pdf"
                # A cached upload keeps its own bytes even if it shares a bundled paper's name.
                bundled = filename in papers and not (upload_cache / f"{document_id}.pdf").is_file()
                entry = library.get(document_id) or {
                    "document_id": document_id,
                    "filename": filename,
                    "paper": filename if bundled else None,
                    "pages": papers[filename]["pages"] if bundled else None,
                    "added_at": int(time.time()),
                }
                self._json(200, {"entry": with_reader(library.add(entry)), "document": document})
                return
            if path in {"/api/query", "/api/answers"}:
                request_data = question_input(self._read_json())
                remote_path = "/query" if path == "/api/query" else "/answer"
                result = client.request("POST", remote_path, json=request_data)
                self._json(200 if path == "/api/query" else 202, result)
                return
            raise DemoRequestError(404, "Page not found.")

        def _dispatch_delete(self):
            self._check_post_origin()
            path = urlsplit(self.path).path
            if not path.startswith("/api/library/"):
                raise DemoRequestError(404, "Page not found.")
            # Forgetting only edits the local list; the AWS document is not deleted.
            removed = library.remove(validated_id(path.removeprefix("/api/library/")))
            self._json(200 if removed else 404, {"removed": removed})

        def _handle(self, method):
            try:
                self._check_host()
                if method == "GET":
                    self._dispatch_get()
                elif method == "DELETE":
                    self._dispatch_delete()
                else:
                    self._dispatch_post()
            except DemoRequestError as error:
                self._json(error.status, {"error": str(error)})
            except requests.RequestException:
                self._json(502, {"error": "AWS request failed. Check connectivity and retry."})
            except RuntimeError as error:
                self._json(502, {"error": str(error)[:500]})
            except Exception:
                self.log_error("Unexpected demo server error")
                self._json(500, {"error": "The demo server encountered an error. Check its terminal logs."})

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def do_DELETE(self):
            self._handle("DELETE")

    return DemoHandler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.environ.get("RAG_API_BASE_URL"))
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE"))
    parser.add_argument("--host", default=os.environ.get("DEMO_UI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("DEMO_UI_PORT", "8080")))
    args = parser.parse_args(argv)
    if not args.api_url:
        parser.error("Set RAG_API_BASE_URL or pass --api-url with the deployed API URL.")
    if args.host not in {"127.0.0.1", "localhost"}:
        parser.error("This IAM-backed demo must listen on localhost only.")
    client = RagClient(args.api_url, profile=args.profile)
    if client.aws.get_credentials() is None:
        parser.error("Sign in with an AWS profile or run inside authenticated AWS CloudShell.")
    server = ThreadingHTTPServer((args.host, args.port), make_handler(client))
    server.daemon_threads = True
    print(f"PDF demo UI listening on http://{args.host}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
