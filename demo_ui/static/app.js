"use strict";

const byId = (id) => document.getElementById(id);
const elements = {
  connection: byId("connection"), connectionText: byId("connection-text"),
  sampleButton: byId("sample-button"), uploadForm: byId("upload-form"),
  uploadButton: byId("upload-button"), uploadError: byId("upload-error"),
  pdfInput: byId("pdf-input"), dropZone: byId("drop-zone"),
  dropTitle: byId("drop-title"), dropSubtitle: byId("drop-subtitle"),
  resumeForm: byId("resume-form"), existingId: byId("existing-id"), existingSample: byId("existing-sample"),
  documentEmpty: byId("document-empty"), documentDetail: byId("document-detail"),
  documentChip: byId("document-chip"), documentName: byId("document-name"),
  documentMessage: byId("document-message"), documentCount: byId("document-count"),
  documentMethod: byId("document-method"), documentId: byId("document-id"),
  documentError: byId("document-error"), progressTrack: byId("progress-fill").parentElement,
  progressFill: byId("progress-fill"), questionForm: byId("question-form"),
  questionInput: byId("question-input"), questionHint: byId("question-hint"),
  questionLength: byId("question-length"), askButton: byId("ask-button"),
  answerError: byId("answer-error"), answerChip: byId("answer-chip"),
  answerEmpty: byId("answer-empty"), answerLoading: byId("answer-loading"),
  answerLoadingLabel: byId("answer-loading-label"), answerResult: byId("answer-result"),
  answerText: byId("answer-text"), answerModel: byId("answer-model"),
  copyAnswer: byId("copy-answer"), sourceCount: byId("source-count"),
  sourcesEmpty: byId("sources-empty"), sourcesList: byId("sources-list"),
  suggestions: [...document.querySelectorAll(".suggestion")],
  stages: [...document.querySelectorAll(".stage")],
};

const MAX_DEMO_FILE_BYTES = 10 * 1024 * 1024;
const LAST_DOCUMENT_KEY = "ucs531-rag-last-document";
const STAGE_ORDER = ["upload", "extract", "index", "retrieve", "answer"];
const state = {
  document: null,
  selectedFile: null,
  pdfUrl: null,
  uploadBusy: false,
  answerBusy: false,
  documentPoll: null,
  answerPoll: null,
  documentRequestVersion: 0,
  documentVersion: 0,
  answerVersion: 0,
  answerRaw: "",
};

function visible(element, show) { element.hidden = !show; }
function text(element, value) { element.textContent = value; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { cache: "no-store", ...options });
  } catch {
    throw new Error("The demo server is unreachable. Check the local demo server at 127.0.0.1:8080.");
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (HTTP ${response.status}).`);
  }
  return data;
}

function postJson(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function setConnection(isOnline, message) {
  elements.connection.classList.toggle("is-online", isOnline);
  elements.connection.classList.toggle("is-offline", !isOnline);
  text(elements.connectionText, message);
}

function setStage(stage) {
  const currentIndex = stage === "done" ? STAGE_ORDER.length : STAGE_ORDER.indexOf(stage);
  elements.stages.forEach((element, index) => {
    element.classList.toggle("is-complete", index < currentIndex);
    element.classList.toggle("is-current", index === currentIndex);
  });
}

function setChip(element, label, kind = "normal") {
  text(element, label);
  element.classList.toggle("is-active", kind === "active");
  element.classList.toggle("is-error", kind === "error");
}

function showError(element, message) { text(element, message); visible(element, true); }
function clearError(element) { text(element, ""); visible(element, false); }

function setUploadBusy(busy) {
  state.uploadBusy = busy;
  elements.sampleButton.disabled = busy;
  elements.pdfInput.disabled = busy;
  elements.uploadButton.disabled = busy || !state.selectedFile;
  text(elements.uploadButton, busy ? "Uploading paper…" : "Index selected PDF →");
  if (busy) setChip(elements.documentChip, "Uploading", "active");
}

function setQuestionEnabled(enabled) {
  elements.questionInput.disabled = !enabled;
  elements.suggestions.forEach((button) => { button.disabled = !enabled; });
  text(elements.questionHint, enabled ? "The answer will be grounded in this paper only." : "Choose a paper first to unlock questions.");
  updateQuestionButton();
}

function updateQuestionButton() {
  const length = elements.questionInput.value.length;
  text(elements.questionLength, `${length} / 2000`);
  elements.askButton.disabled = state.answerBusy || state.document?.status !== "READY" || !elements.questionInput.value.trim();
}

function resetAnswer() {
  state.answerVersion += 1;
  clearTimeout(state.answerPoll);
  state.answerRaw = "";
  state.answerBusy = false;
  visible(elements.answerEmpty, true);
  visible(elements.answerLoading, false);
  visible(elements.answerResult, false);
  visible(elements.sourcesEmpty, true);
  visible(elements.sourcesList, false);
  elements.sourcesList.replaceChildren();
  text(elements.sourceCount, "0");
  setChip(elements.answerChip, "Not started");
  clearError(elements.answerError);
  updateQuestionButton();
}

function usePdfUrl(url) {
  if (state.pdfUrl?.startsWith("blob:")) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = url;
}

function useSamplePdf() { usePdfUrl("/sample.pdf"); }

function selectFile(file) {
  clearError(elements.uploadError);
  if (!file) {
    state.selectedFile = null;
    text(elements.dropTitle, "Choose a PDF or drop it here");
    text(elements.dropSubtitle, "The file stays private in your AWS account.");
  } else if (!file.name.toLowerCase().endsWith(".pdf")) {
    state.selectedFile = null;
    showError(elements.uploadError, "Choose a .pdf file to continue.");
  } else if (file.size > MAX_DEMO_FILE_BYTES) {
    state.selectedFile = null;
    showError(elements.uploadError, "This account's text-PDF fallback accepts files under 10 MB. Choose a smaller text-based PDF.");
  } else if (file.size === 0) {
    state.selectedFile = null;
    showError(elements.uploadError, "This PDF is empty. Choose a file with readable pages.");
  } else {
    state.selectedFile = file;
    text(elements.dropTitle, file.name);
    text(elements.dropSubtitle, `${formatBytes(file.size)} · ready to upload`);
  }
  elements.uploadButton.disabled = state.uploadBusy || !state.selectedFile;
}

function rememberDocument(id, sample) {
  try { localStorage.setItem(LAST_DOCUMENT_KEY, JSON.stringify({ id, sample })); } catch { /* Private browsing may disable storage. */ }
}

function restoreDocument() {
  try {
    const data = JSON.parse(localStorage.getItem(LAST_DOCUMENT_KEY) || "null");
    if (data && /^[0-9a-f]{32}$/i.test(data.id)) return data;
  } catch { /* Ignore stale local storage. */ }
  return null;
}

function startDocument(document, displayName) {
  state.documentVersion += 1;
  clearTimeout(state.documentPoll);
  state.document = { ...document, filename: document.filename || displayName || "Research paper" };
  resetAnswer();
  visible(elements.documentEmpty, false);
  visible(elements.documentDetail, true);
  renderDocument();
  pollDocument(state.documentVersion);
}

function renderDocument() {
  const document = state.document;
  if (!document) return;
  const status = String(document.status || "AWAITING_UPLOAD").toUpperCase();
  document.status = status;
  const total = Number(document.total_chunks || 0);
  const completed = Number(document.completed_chunks || 0);
  const method = document.extraction_method === "pypdf" ? "PDF text layer · pypdf" : document.extraction_method === "textract" ? "Amazon Textract" : "Pending";
  const progress = status === "READY" ? 100 : status === "EMBEDDING" && total > 0 ? Math.min(96, Math.round((completed / total) * 100)) : 0;
  text(elements.documentName, document.filename || "Research paper");
  text(elements.documentId, document.document_id || "Pending");
  text(elements.documentMethod, method);
  text(elements.documentCount, total ? `${completed} / ${total} chunks` : "Waiting for chunks");
  elements.progressTrack.classList.toggle("is-indeterminate", (status === "EXTRACTING" || status === "AWAITING_UPLOAD") && progress === 0);
  elements.progressTrack.setAttribute("aria-valuenow", String(progress));
  elements.progressFill.style.transform = `scaleX(${progress ? progress / 100 : status === "EXTRACTING" || status === "AWAITING_UPLOAD" ? 0.36 : 0})`;
  clearError(elements.documentError);
  if (status === "READY") {
    setChip(elements.documentChip, "Ready", "active");
    text(elements.documentMessage, "Indexed and ready for questions");
    setQuestionEnabled(true);
    setStage("retrieve");
  } else if (status === "FAILED") {
    setChip(elements.documentChip, "Failed", "error");
    text(elements.documentMessage, "Indexing stopped");
    showError(elements.documentError, document.error_message || "Processing failed. Try a text-based PDF or check the server logs.");
    setQuestionEnabled(false);
    setStage(total ? "index" : "extract");
  } else if (status === "EMBEDDING") {
    setChip(elements.documentChip, "Indexing", "active");
    text(elements.documentMessage, "Titan is embedding page passages");
    setQuestionEnabled(false);
    setStage("index");
  } else if (status === "EXTRACTING") {
    setChip(elements.documentChip, "Extracting", "active");
    text(elements.documentMessage, "Reading PDF pages");
    setQuestionEnabled(false);
    setStage("extract");
  } else {
    setChip(elements.documentChip, "Received", "active");
    text(elements.documentMessage, "Waiting for upload event");
    setQuestionEnabled(false);
    setStage("upload");
  }
}

async function pollDocument(version) {
  if (!state.document || version !== state.documentVersion) return;
  try {
    const data = await api(`/api/documents/${encodeURIComponent(state.document.document_id)}`);
    if (version !== state.documentVersion) return;
    state.document = { ...state.document, ...(data.document || data) };
    renderDocument();
    if (state.document.status === "READY" || state.document.status === "FAILED") return;
  } catch (error) {
    if (version !== state.documentVersion) return;
    showError(elements.documentError, `Status check failed: ${errorMessage(error)} Retrying…`);
  }
  state.documentPoll = setTimeout(() => pollDocument(version), 2200);
}

async function createDocument(sample) {
  if (state.uploadBusy) return;
  const file = state.selectedFile;
  if (!sample && !file) return;
  const requestVersion = ++state.documentRequestVersion;
  state.documentVersion += 1;
  clearTimeout(state.documentPoll);
  state.document = null;
  clearError(elements.uploadError);
  resetAnswer();
  setUploadBusy(true);
  visible(elements.documentEmpty, false);
  visible(elements.documentDetail, true);
  text(elements.documentName, sample ? "Attention Is All You Need.pdf" : file.name);
  text(elements.documentMessage, "Sending PDF to private S3");
  text(elements.documentCount, "Waiting for chunks");
  text(elements.documentMethod, "Pending");
  text(elements.documentId, "Registering…");
  elements.progressTrack.classList.add("is-indeterminate");
  elements.progressTrack.setAttribute("aria-valuenow", "0");
  elements.progressFill.style.transform = "scaleX(.36)";
  setStage("upload");
  setQuestionEnabled(false);
  try {
    let data;
    if (sample) {
      data = await api("/api/sample-document", { method: "POST" });
      await useSamplePdf();
    } else {
      const formData = new FormData();
      formData.append("file", file, file.name);
      data = await api("/api/documents", { method: "POST", body: formData });
      usePdfUrl(URL.createObjectURL(file));
    }
    if (requestVersion !== state.documentRequestVersion) return;
    const document = data.document || data;
    if (!document.document_id) throw new Error("The server did not return a document ID.");
    rememberDocument(document.document_id, sample);
    startDocument(document, sample ? "Attention Is All You Need.pdf" : file.name);
  } catch (error) {
    if (requestVersion !== state.documentRequestVersion) return;
    visible(elements.documentDetail, false);
    visible(elements.documentEmpty, true);
    setChip(elements.documentChip, "Waiting");
    showError(elements.uploadError, errorMessage(error));
  } finally {
    setUploadBusy(false);
  }
}

async function loadExisting(id, { sample = false, silent = false } = {}) {
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    if (!silent) showError(elements.uploadError, "Enter a 32-character document ID from a previous upload.");
    return;
  }
  if (state.uploadBusy) {
    if (!silent) showError(elements.uploadError, "Wait for the current upload to finish before opening another paper.");
    return;
  }
  const requestVersion = ++state.documentRequestVersion;
  clearError(elements.uploadError);
  try {
    const data = await api(`/api/documents/${encodeURIComponent(id)}`);
    if (requestVersion !== state.documentRequestVersion) return;
    const document = data.document || data;
    if (sample) await useSamplePdf(); else usePdfUrl(null);
    rememberDocument(id, sample);
    startDocument(document, document.filename || "Previously indexed paper");
  } catch (error) {
    if (requestVersion !== state.documentRequestVersion) return;
    showError(elements.uploadError, `${silent ? "Could not reopen the last paper" : "Could not open document"}: ${errorMessage(error)}`);
  }
}

function normalizeSources(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["sources", "top_chunks", "chunks", "results", "matches"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function renderSources(sources) {
  elements.sourcesList.replaceChildren();
  text(elements.sourceCount, String(sources.length));
  visible(elements.sourcesEmpty, sources.length === 0);
  visible(elements.sourcesList, sources.length > 0);
  sources.forEach((source, index) => {
    const sourceId = source.source_id || `S${index + 1}`;
    const pages = (Array.isArray(source.pages) ? source.pages : [source.page]).filter((page) => Number.isFinite(Number(page)) && Number(page) > 0);
    const details = document.createElement("details");
    details.className = "source-card";
    details.id = `source-${sourceId}`;
    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "source-name";
    const strong = document.createElement("strong");
    strong.className = "source-id";
    strong.textContent = `Source ${sourceId}`;
    const meta = document.createElement("span");
    meta.className = "source-meta";
    meta.textContent = `${source.filename || state.document?.filename || "Paper"} · ${pages.length ? `page ${pages.join(", ")}` : "page unavailable"}`;
    name.append(strong, meta);
    summary.append(name);
    const body = document.createElement("div");
    body.className = "source-body";
    const excerpt = document.createElement("p");
    excerpt.textContent = source.excerpt || source.text || "No passage text was returned for this source.";
    body.append(excerpt);
    if (state.pdfUrl && pages.length) {
      const link = document.createElement("a");
      link.href = `${state.pdfUrl}#page=${pages[0]}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Open original PDF at page ${pages[0]} ↗`;
      body.append(link);
    }
    details.append(summary, body);
    elements.sourcesList.append(details);
  });
}

function renderAnswer(answer) {
  elements.answerText.replaceChildren();
  const citationPattern = /\[(S\d+)\]/g;
  let cursor = 0;
  for (const match of answer.matchAll(citationPattern)) {
    if (match.index > cursor) elements.answerText.append(document.createTextNode(answer.slice(cursor, match.index)));
    const reference = document.createElement("a");
    reference.href = `#source-${match[1]}`;
    reference.textContent = match[0];
    reference.setAttribute("aria-label", `Jump to source ${match[1]}`);
    reference.addEventListener("click", () => {
      const details = byId(`source-${match[1]}`);
      if (details) details.open = true;
    });
    elements.answerText.append(reference);
    cursor = match.index + match[0].length;
  }
  if (cursor < answer.length) elements.answerText.append(document.createTextNode(answer.slice(cursor)));
}

async function pollAnswer(jobId, version) {
  if (version !== state.answerVersion) return;
  try {
    const data = await api(`/api/answers/${encodeURIComponent(jobId)}`);
    if (version !== state.answerVersion) return;
    const result = data.result || data;
    const status = String(data.status || result.status || "PENDING").toUpperCase();
    if (result.answer && ["COMPLETED", "SUCCEEDED", "READY", "DONE"].includes(status)) {
      state.answerRaw = result.answer;
      renderSources(normalizeSources(result));
      renderAnswer(result.answer);
      text(elements.answerModel, result.model_id || "Amazon Nova 2 Lite");
      visible(elements.answerEmpty, false);
      visible(elements.answerLoading, false);
      visible(elements.answerResult, true);
      setChip(elements.answerChip, "Answered", "active");
      setStage("done");
      state.answerBusy = false;
      updateQuestionButton();
      return;
    }
    if (status === "FAILED") {
      throw new Error(result.error_message || data.error_message || "The answer job failed. Try a different question.");
    }
    setChip(elements.answerChip, ["RUNNING", "GENERATING"].includes(status) ? "Generating" : "Queued", "active");
  } catch (error) {
    if (version !== state.answerVersion) return;
    showError(elements.answerError, errorMessage(error));
    visible(elements.answerLoading, false);
    visible(elements.answerEmpty, true);
    setChip(elements.answerChip, "Failed", "error");
    state.answerBusy = false;
    updateQuestionButton();
    return;
  }
  state.answerPoll = setTimeout(() => pollAnswer(jobId, version), 2200);
}

async function askQuestion(question) {
  if (state.answerBusy || state.document?.status !== "READY") return;
  if (!question.trim()) { showError(elements.answerError, "Type a question about this paper first."); return; }
  resetAnswer();
  state.answerBusy = true;
  updateQuestionButton();
  const version = state.answerVersion;
  clearError(elements.answerError);
  visible(elements.answerEmpty, false);
  visible(elements.answerLoading, true);
  text(elements.answerLoadingLabel, "Finding relevant passages…");
  setChip(elements.answerChip, "Retrieving", "active");
  setStage("retrieve");
  try {
    const documentIds = [state.document.document_id];
    const retrieved = await postJson("/api/query", { question, document_ids: documentIds, top_k: 5 });
    if (version !== state.answerVersion) return;
    renderSources(normalizeSources(retrieved));
    text(elements.answerLoadingLabel, "Nova 2 Lite is composing an answer from those passages…");
    setChip(elements.answerChip, "Generating", "active");
    setStage("answer");
    const queued = await postJson("/api/answers", { question, document_ids: documentIds });
    if (version !== state.answerVersion) return;
    if (!queued.job_id) throw new Error("The server did not return an answer job ID.");
    pollAnswer(queued.job_id, version);
  } catch (error) {
    if (version !== state.answerVersion) return;
    showError(elements.answerError, errorMessage(error));
    visible(elements.answerLoading, false);
    visible(elements.answerEmpty, true);
    setChip(elements.answerChip, "Failed", "error");
    state.answerBusy = false;
    updateQuestionButton();
  }
}

elements.pdfInput.addEventListener("change", () => selectFile(elements.pdfInput.files?.[0] || null));
elements.dropZone.addEventListener("dragover", (event) => { event.preventDefault(); elements.dropZone.classList.add("is-dragging"); });
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
elements.dropZone.addEventListener("drop", (event) => { event.preventDefault(); elements.dropZone.classList.remove("is-dragging"); selectFile(event.dataTransfer?.files?.[0] || null); });
elements.uploadForm.addEventListener("submit", (event) => { event.preventDefault(); createDocument(false); });
elements.sampleButton.addEventListener("click", () => createDocument(true));
elements.resumeForm.addEventListener("submit", (event) => { event.preventDefault(); loadExisting(elements.existingId.value.trim(), { sample: elements.existingSample.checked }); });
elements.questionInput.addEventListener("input", updateQuestionButton);
elements.questionForm.addEventListener("submit", (event) => { event.preventDefault(); askQuestion(elements.questionInput.value.trim()); });
elements.suggestions.forEach((button) => button.addEventListener("click", () => { elements.questionInput.value = button.dataset.question; updateQuestionButton(); elements.questionInput.focus(); }));
elements.copyAnswer.addEventListener("click", async () => { try { await navigator.clipboard.writeText(state.answerRaw); text(elements.copyAnswer, "Copied"); setTimeout(() => text(elements.copyAnswer, "Copy answer"), 1800); } catch { text(elements.copyAnswer, "Copy unavailable"); } });

async function initialize() {
  setQuestionEnabled(false);
  try {
    const health = await api("/api/health");
    if (health.ok === false) throw new Error(health.error || "AWS is unavailable.");
    setConnection(true, "AWS SESSION READY");
    elements.connection.title = `AWS credentials available in ${health.region || "us-east-1"}`;
    const saved = restoreDocument();
    if (saved && state.documentRequestVersion === 0) await loadExisting(saved.id, { sample: saved.sample, silent: true });
  } catch (error) {
    setConnection(false, "AWS SESSION UNAVAILABLE");
    showError(elements.uploadError, errorMessage(error));
  }
}

initialize();
