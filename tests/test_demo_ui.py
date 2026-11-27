"""Exercise the browser proxy without an AWS account or model calls."""

import threading
from http.server import ThreadingHTTPServer

import pytest
import requests

import demo_ui.server as server_module
from demo_ui.server import DemoRequestError, make_handler, validated_pdf

DOCUMENT_ID = "a" * 32
JOB_ID = "b" * 32


class FakeAws:
    region_name = "us-east-1"

    def get_credentials(self):
        return object()


class FakeClient:
    aws = FakeAws()
    api_base_url = "https://example.execute-api.us-east-1.amazonaws.com/dev"

    def __init__(self):
        self.uploaded = []
        self.calls = []

    def upload(self, path):
        self.uploaded.append((path.name, path.read_bytes()))
        return DOCUMENT_ID

    def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if method == "GET" and path == f"/documents/{DOCUMENT_ID}":
            return {
                "document_id": DOCUMENT_ID,
                "filename": "sample.pdf",
                "status": "READY",
                "total_chunks": 38,
                "completed_chunks": 38,
                "extraction_method": "pypdf",
            }
        if method == "POST" and path == "/query":
            return {"top_chunks": [{"document_id": DOCUMENT_ID, "pages": [2], "text": "Attention"}]}
        if method == "POST" and path == "/answer":
            return {"job_id": JOB_ID, "status": "QUEUED"}
        if method == "GET" and path == f"/answers/{JOB_ID}":
            return {
                "job_id": JOB_ID,
                "status": "COMPLETED",
                "result": {
                    "answer": "The Transformer uses attention [S1].",
                    "sources": [{"source_id": "S1", "document_id": DOCUMENT_ID, "pages": [2]}],
                },
            }
        raise AssertionError(f"Unexpected call: {method} {path}")


@pytest.fixture
def live_proxy(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<h1>PDF demo</h1>", encoding="utf-8")
    (static / "app.css").write_text("body{color:black}", encoding="utf-8")
    sample = tmp_path / "sample.pdf"
    sample.write_bytes(b"%PDF-sample")
    client = FakeClient()
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        make_handler(client, static_root=static, sample_pdf=sample, state_dir=tmp_path / "state"),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", client
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


def test_browser_routes_use_signed_client_and_normalize_answer(live_proxy):
    base, client = live_proxy
    health = requests.get(f"{base}/api/health", timeout=3)
    assert health.status_code == 200
    assert health.json() == {"ok": True, "region": "us-east-1", "api_url": client.api_base_url}
    assert requests.get(base, timeout=3).text == "<h1>PDF demo</h1>"
    assert requests.get(f"{base}/static/app.css", timeout=3).text == "body{color:black}"
    assert requests.get(f"{base}/sample.pdf", timeout=3).content == b"%PDF-sample"

    uploaded = requests.post(f"{base}/api/sample-document", timeout=3)
    assert uploaded.status_code == 201
    assert uploaded.json()["document_id"] == DOCUMENT_ID
    assert client.uploaded == [("sample.pdf", b"%PDF-sample")]
    document = requests.get(f"{base}/api/documents/{DOCUMENT_ID}", timeout=3).json()
    assert document["status"] == "READY"
    assert document["completed_chunks"] == 38

    question = {"question": "How does attention work?", "document_ids": [DOCUMENT_ID], "top_k": 3}
    passages = requests.post(f"{base}/api/query", json=question, timeout=3).json()
    assert passages["top_chunks"][0]["pages"] == [2]
    queued = requests.post(f"{base}/api/answers", json=question, timeout=3)
    assert queued.status_code == 202
    assert queued.json()["job_id"] == JOB_ID
    answer = requests.get(f"{base}/api/answers/{JOB_ID}", timeout=3).json()
    assert answer["status"] == "COMPLETED"
    assert answer["answer"] == "The Transformer uses attention [S1]."
    assert answer["sources"][0]["pages"] == [2]
    assert client.calls[-2][2]["json"] == {
        "question": "How does attention work?",
        "document_id": DOCUMENT_ID,
        "top_k": 3,
    }


def test_custom_upload_preserves_filename_and_rejects_bad_input(live_proxy):
    base, client = live_proxy
    result = requests.post(
        f"{base}/api/documents",
        files={"file": ("paper.pdf", b"%PDF-custom", "application/pdf")},
        timeout=3,
    )
    assert result.status_code == 201
    assert result.json()["filename"] == "paper.pdf"
    assert client.uploaded == [("paper.pdf", b"%PDF-custom")]

    invalid = requests.post(
        f"{base}/api/documents",
        files={"file": ("fake.pdf", b"not a PDF", "application/pdf")},
        timeout=3,
    )
    assert invalid.status_code == 400
    assert len(client.uploaded) == 1
    traversal = requests.get(f"{base}/%2e%2e/client.py", timeout=3)
    assert traversal.status_code == 404
    blocked = requests.post(
        f"{base}/api/sample-document",
        headers={"Origin": "https://unrelated.example"},
        timeout=3,
    )
    assert blocked.status_code == 403
    rebound = requests.get(f"{base}/api/health", headers={"Host": "unrelated.example"}, timeout=3)
    assert rebound.status_code == 403
    assert len(client.uploaded) == 1


def test_pdf_limit_and_document_scope_validation(live_proxy, monkeypatch):
    base, client = live_proxy
    monkeypatch.setattr(server_module, "MAX_PDF_BYTES", 8)
    with pytest.raises(DemoRequestError):
        validated_pdf("paper.pdf", b"%PDF-xxxx")
    for data in (
        {"question": "Question", "document_ids": []},
        {"question": "Question", "document_ids": [DOCUMENT_ID, JOB_ID]},
        {"question": "Question", "document_ids": ["bad"]},
        {"question": "Question", "document_ids": [DOCUMENT_ID], "top_k": True},
    ):
        response = requests.post(f"{base}/api/answers", json=data, timeout=3)
        assert response.status_code == 400
    assert client.calls == []


def test_server_refuses_public_binding(capsys):
    with pytest.raises(SystemExit) as error:
        server_module.main(
            [
                "--api-url",
                "https://example.execute-api.us-east-1.amazonaws.com/dev",
                "--host",
                "0.0.0.0",
            ]
        )
    assert error.value.code == 2
    assert "must listen on localhost only" in capsys.readouterr().err


def test_paper_catalog_library_and_reader_routes(live_proxy):
    base, client = live_proxy
    catalog = requests.get(f"{base}/api/papers", timeout=3).json()
    assert catalog["default"] == "sample.pdf"
    assert [paper["name"] for paper in catalog["papers"]] == ["sample.pdf"]
    assert "path" not in catalog["papers"][0]
    assert requests.get(f"{base}/papers/sample.pdf", timeout=3).content == b"%PDF-sample"
    assert requests.get(f"{base}/papers/unknown.pdf", timeout=3).status_code == 404

    for paper in ("../client.py", [], None):
        unknown = requests.post(f"{base}/api/sample-document", json={"paper": paper}, timeout=3)
        assert unknown.status_code == 400
    chosen = requests.post(f"{base}/api/sample-document", json={"paper": "sample.pdf"}, timeout=3)
    assert chosen.status_code == 201
    assert chosen.json()["pdf_url"] == f"/api/documents/{DOCUMENT_ID}/pdf"
    assert isinstance(chosen.json()["upload_ms"], int)

    library = requests.get(f"{base}/api/library", timeout=3).json()["documents"]
    assert [(entry["document_id"], entry["paper"]) for entry in library] == [(DOCUMENT_ID, "sample.pdf")]
    reader = requests.get(f"{base}/api/documents/{DOCUMENT_ID}/pdf", timeout=3)
    assert reader.headers["Content-Type"] == "application/pdf"
    assert reader.content == b"%PDF-sample"

    # A custom upload replaces the entry, and its bytes are cached for the reader.
    requests.post(
        f"{base}/api/documents", files={"file": ("mine.pdf", b"%PDF-mine", "application/pdf")}, timeout=3
    )
    library = requests.get(f"{base}/api/library", timeout=3).json()["documents"]
    assert len(library) == 1 and library[0]["paper"] is None and library[0]["filename"] == "mine.pdf"
    assert requests.get(f"{base}/api/documents/{DOCUMENT_ID}/pdf", timeout=3).content == b"%PDF-mine"

    cross_site = requests.delete(
        f"{base}/api/library/{DOCUMENT_ID}", headers={"Origin": "https://unrelated.example"}, timeout=3
    )
    assert cross_site.status_code == 403
    assert requests.delete(f"{base}/api/library/{DOCUMENT_ID}", timeout=3).json() == {"removed": True}
    assert requests.delete(f"{base}/api/library/{DOCUMENT_ID}", timeout=3).status_code == 404
    assert requests.get(f"{base}/api/library", timeout=3).json()["documents"] == []

    registered = requests.post(f"{base}/api/library", json={"document_id": DOCUMENT_ID}, timeout=3)
    assert registered.status_code == 200
    assert registered.json()["document"]["status"] == "READY"
    assert registered.json()["entry"]["filename"] == "sample.pdf"
    # The cached upload's own bytes win over the bundled paper with the same filename.
    assert registered.json()["entry"]["paper"] is None
    assert requests.get(f"{base}/api/documents/{DOCUMENT_ID}/pdf", timeout=3).content == b"%PDF-mine"
    assert client.calls[-1][:2] == ("GET", f"/documents/{DOCUMENT_ID}")
    assert requests.post(f"{base}/api/library", json={"document_id": "bad"}, timeout=3).status_code == 400
