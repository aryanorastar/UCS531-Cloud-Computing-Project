/* Folio v2. Every visual state comes from the local demo server, which signs requests to the
   deployed AWS API. Nothing here holds AWS credentials or animates progress the API has not reported. */

import * as pdfjsLib from "/static/vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, value);
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function iconSvg(name, cls = "node-icon") {
  const wrap = svg("svg", { viewBox: "0 0 16 16", class: cls, "aria-hidden": "true" });
  wrap.innerHTML = ICONS[name] || ""; // static, trusted markup defined in this file
  return wrap;
}

const fmtMs = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
const fmtBytes = (bytes) => (bytes == null ? "" : bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const stripPdf = (name) => String(name || "Research paper").replace(/\.pdf$/i, "");
const isId = (value) => /^[0-9a-f]{32}$/.test(value || "");
const clock = () => new Date().toLocaleTimeString([], { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0");
const shortClock = () => new Date().toLocaleTimeString([], { hour12: false });
const store = {
  get(key, fallback = null) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be full or disabled */ } },
};

// ── Content ───────────────────────────────────────────────────────────────────
const QUESTIONS = {
  "Attention Is All You Need.pdf": [
    "How does self-attention work in the encoder and decoder?",
    "Why does the Transformer use multi-head attention?",
    "What BLEU score did the big Transformer reach on WMT 2014 English-to-German?",
    "Why are positional encodings needed?",
  ],
  "BERT Pre-training of Deep Bidirectional Transformers for Language Understanding.pdf": [
    "What are BERT's two pre-training tasks?",
    "How does masked language modelling avoid seeing the target word?",
    "How big are BERT-Base and BERT-Large?",
  ],
  "Deep Residual Learning for Image Recognition.pdf": [
    "What degradation problem do residual connections solve?",
    "What is a bottleneck building block?",
    "How deep were the networks evaluated on ImageNet?",
  ],
  "Generative Adversarial Networks.pdf": [
    "How do the generator and discriminator compete?",
    "What is the minimax value function?",
    "What disadvantages of GANs do the authors list?",
  ],
  "A Survey of Large Language Models.pdf": [
    "What are emergent abilities of large language models?",
    "How does instruction tuning differ from pre-training?",
    "How is RLHF used to align language models?",
  ],
};
const DEFAULT_QUESTIONS = ["What is the main contribution of this paper?", "What method does the paper propose?", "What limitations do the authors mention?"];
const PROBE_QUESTION = "Who won the 2022 FIFA World Cup?";

const ICONS = {
  browser: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M1.5 5.6h13"/><circle class="solid" cx="3.7" cy="4.05" r=".65"/><circle class="solid" cx="5.6" cy="4.05" r=".65"/>',
  key: '<circle cx="5" cy="8" r="2.9"/><path d="M7.9 8h6.6M12.1 8v2.5M14.5 8v1.9"/>',
  gateway: '<path d="M8 1.4l5.7 3.3v6.6L8 14.6l-5.7-3.3V4.7z"/><path d="M5.1 8h5.8M8.7 5.8L10.9 8l-2.2 2.2"/>',
  lambda: '<path d="M4.2 2.4h2.1l5.6 11.2h-2.1"/><path d="M8.2 7.5l-3.9 6.1"/>',
  bucket: '<ellipse cx="8" cy="4" rx="5.6" ry="1.9"/><path d="M2.4 4l1.3 8.4c.2 1.1 2.1 1.9 4.3 1.9s4.1-.8 4.3-1.9L13.6 4"/>',
  doc: '<path d="M3.8 1.5h5.7l2.9 3v10H3.8z"/><path d="M9.5 1.5v3h2.9M5.9 8.1h4.4M5.9 10.5h4.4M5.9 12.9h2.4"/>',
  database: '<ellipse cx="8" cy="3.6" rx="5.5" ry="2.1"/><path d="M2.5 3.6v8.8c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V3.6M2.5 8c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1"/>',
  sparkle: '<path d="M7.6 1.6l1.5 4.1 4.1 1.5-4.1 1.5-1.5 4.1-1.5-4.1-4.1-1.5 4.1-1.5z"/><path d="M12.7 10.9l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/>',
  target: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.1"/><circle class="solid" cx="8" cy="8" r="1.1"/>',
  queue: '<rect x="1.6" y="4.4" width="3.1" height="7.2" rx="1"/><rect x="6.45" y="4.4" width="3.1" height="7.2" rx="1"/><rect x="11.3" y="4.4" width="3.1" height="7.2" rx="1"/>',
  book: '<path d="M2.5 3c1.8-.7 3.7-.7 5.5.5 1.8-1.2 3.7-1.2 5.5-.5v10c-1.8-.7-3.7-.7-5.5.5-1.8-1.2-3.7-1.2-5.5-.5z"/><path d="M8 3.5v10"/>',
  ask: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  bolt: '<path d="M9 1.5L3.5 9h4L7 14.5 12.5 7h-4z"/>',
  moon: '<path d="M12.8 10.2A5.5 5.5 0 015.8 3.2 5.5 5.5 0 1012.8 10.2z"/>',
  terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6l2 2-2 2M8 10.5h3.5"/>',
  layout: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M1.5 6.5h13M6 6.5v7"/>',
  play: '<path d="M4.5 2.8l8.5 5.2-8.5 5.2z"/>',
  copy: '<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/>',
  refresh: '<path d="M13 8a5 5 0 11-1.5-3.6M13 2.5v2.7h-2.7"/>',
};

// Geometry of the live architecture (viewBox 1440 × 292).
const W = 130, H = 52, STEP = 152, X0 = 427, Y1 = 92, Y2 = 190;
const laneX = (i) => X0 + i * STEP;
const NODES = [
  { id: "browser", kind: "client", icon: "browser", x: 96, y: Y1, w: 148, title: "Browser", sub: "this page" },
  { id: "signer", kind: "client", icon: "key", x: 96, y: Y2, w: 148, title: "Local signer", sub: "Python · SigV4" },
  { id: "apigw", kind: "network", icon: "gateway", x: 278, y: 141, w: 124, h: 180, title: "API Gateway", sub: "REST · IAM auth" },
  { id: "upload", kind: "compute", icon: "lambda", x: laneX(0), y: Y1, title: "λ upload", sub: "presign PUT" },
  { id: "s3", kind: "storage", icon: "bucket", x: laneX(1), y: Y1, title: "Amazon S3", sub: "private · SSE" },
  { id: "process", kind: "compute", icon: "lambda", x: laneX(2), y: Y1, title: "λ process", sub: "S3 event" },
  { id: "extract", kind: "ai", icon: "doc", x: laneX(3), y: Y1, title: "Extract", sub: "Textract→pypdf" },
  { id: "chunks", kind: "database", icon: "database", x: laneX(4), y: Y1, title: "DynamoDB", sub: "chunks table" },
  { id: "embed", kind: "compute", icon: "lambda", x: laneX(5), y: Y1, title: "λ embed", sub: "Streams" },
  { id: "titan", kind: "ai", icon: "sparkle", x: laneX(6), y: Y1, title: "Titan V2", sub: "256-d vectors" },
  { id: "query", kind: "compute", icon: "lambda", x: laneX(0), y: Y2, title: "λ query", sub: "POST /query" },
  { id: "qtitan", kind: "ai", icon: "sparkle", x: laneX(1), y: Y2, title: "Titan V2", sub: "embed question" },
  { id: "rank", kind: "database", icon: "target", x: laneX(2), y: Y2, title: "Cosine rank", sub: "exact top-k" },
  { id: "answer", kind: "compute", icon: "lambda", x: laneX(3), y: Y2, title: "λ answer", sub: "202 + job id" },
  { id: "sqs", kind: "integration", icon: "queue", x: laneX(4), y: Y2, title: "Amazon SQS", sub: "answer queue" },
  { id: "worker", kind: "compute", icon: "lambda", x: laneX(5), y: Y2, title: "λ worker", sub: "prompt + cite" },
  { id: "nova", kind: "ai", icon: "sparkle", x: laneX(6), y: Y2, title: "Nova 2 Lite", sub: "Converse" },
];
const nodeById = (id) => NODES.find((item) => item.id === id);
const nodeW = (n) => n.w || W;
const nodeH = (n) => n.h || H;

const EDGES = [
  ["br-sg", "browser", "signer", "v"], ["sg-gw", "signer", "apigw", Y2],
  ["gw-up", "apigw", "upload", Y1], ["up-s3", "upload", "s3", Y1], ["s3-pr", "s3", "process", Y1], ["pr-ex", "process", "extract", Y1],
  ["ex-ch", "extract", "chunks", Y1], ["ch-em", "chunks", "embed", Y1], ["em-ti", "embed", "titan", Y1],
  ["gw-q", "apigw", "query", Y2], ["q-qt", "query", "qtitan", Y2], ["qt-rk", "qtitan", "rank", Y2], ["rk-an", "rank", "answer", Y2],
  ["an-sq", "answer", "sqs", Y2], ["sq-wk", "sqs", "worker", Y2], ["wk-nv", "worker", "nova", Y2],
];
const INGEST_STEPS = [
  { nodes: ["browser", "signer", "apigw", "upload"], edges: ["br-sg", "sg-gw", "gw-up"] },
  { nodes: ["s3"], edges: ["arc", "up-s3"] },
  { nodes: ["process"], edges: ["s3-pr"] },
  { nodes: ["extract"], edges: ["pr-ex"] },
  { nodes: ["chunks", "embed", "titan"], edges: ["ex-ch", "ch-em", "em-ti"] },
];
const ASK_STEPS = [
  { nodes: ["browser", "signer", "apigw", "query", "qtitan", "rank"], edges: ["br-sg", "sg-gw", "gw-q", "q-qt", "qt-rk"] },
  { nodes: ["answer", "sqs"], edges: ["rk-an", "an-sq"] },
  { nodes: ["worker", "nova"], edges: ["sq-wk", "wk-nv"] },
];

const NODE_INFO = {
  browser: { kind: "Client · demo_ui", title: "This page", body: "Plain HTML, CSS and JavaScript served from 127.0.0.1. It never talks to AWS directly and holds no credentials; PDFs are drawn locally with PDF.js.", facts: [["Talks to", "127.0.0.1 only"], ["Renders", "PDF.js, vendored"], ["Writes", "same-origin checked"]] },
  signer: { kind: "Client · demo_ui/server.py", title: "Local signing server", body: "A Python standard-library server. RagClient signs every API call with AWS SigV4 using your AWS login, and streams PDF bytes straight to S3 with a presigned URL.", facts: [["Signing", "SigV4 · execute-api"], ["Bind", "localhost only"], ["Upload", "presigned S3 PUT"]] },
  apigw: { kind: "Networking", title: "Amazon API Gateway (REST)", body: "Every route requires IAM authorisation, and a resource policy denies callers from any other AWS account. Stage-wide throttling protects the Lambdas and the bill.", facts: [["Auth", "AWS_IAM"], ["Throttle", "5 rps · burst 10"], ["Stage", "dev · REGIONAL"], ["Routes", "/upload-url /documents /query /answer"]] },
  upload: { kind: "Compute · get_presigned_url", title: "Register the document", body: "Validates the filename and size, records the document as AWAITING_UPLOAD in DynamoDB and returns a 15-minute presigned S3 PUT, so the PDF bytes never pass through the API.", facts: [["Runtime", "Python 3.12 · 512 MB"], ["Timeout", "20 s"], ["Max PDF", "25 MiB"], ["URL lifetime", "900 s"]] },
  s3: { kind: "Storage", title: "Amazon S3 · private document bucket", body: "Encrypted, versioned and closed to the public, with a TLS-only bucket policy. The ObjectCreated event on the exact object version starts processing.", facts: [["Encryption", "SSE-S3 (AES-256)"], ["Versioning", "enabled · 30-day expiry"], ["Public access", "fully blocked"], ["Key", "uploads/{owner}/{id}/document.pdf"]] },
  process: { kind: "Compute · process_document_batch", title: "Verify and start extraction", body: "Checks the stored version's size and %PDF header, then starts asynchronous Textract with an idempotent token. If the account returns SubscriptionRequiredException it reads the existing text layer with pypdf instead.", facts: [["Timeout", "300 s · 1024 MB"], ["Retries", "2 async + dead-letter queue"], ["Fallback caps", "10 MiB · 200 pages · 1M chars"]] },
  extract: { kind: "AI / ML · Textract + fallback", title: "Text extraction", body: "Textract (async, SNS callback) is the primary path. This account's Free plan rejects it, so the text layer is parsed with pypdf. Text is split into overlapping chunks that keep their page numbers. Scanned pages would need OCR.", facts: [["Primary", "Textract StartDocumentTextDetection"], ["Callback", "SNS → λ textract-result"], ["Fallback", "pypdf text layer"], ["Chunks", "1,500 chars · 200 overlap"]] },
  chunks: { kind: "Database", title: "Amazon DynamoDB", body: "Three on-demand tables: documents, chunks and answer jobs. Chunks get deterministic IDs and conditional writes, so a duplicate event can never overwrite indexed vectors. The chunks table streams new items.", facts: [["Billing", "PAY_PER_REQUEST"], ["Stream", "NEW_IMAGE → λ embed"], ["Protection", "SSE + point-in-time recovery"], ["Jobs TTL", "24 h"]] },
  embed: { kind: "Compute · generate_embeddings", title: "Embed each chunk", body: "DynamoDB Streams invokes this once per new chunk. It calls Titan, then stores the vector and increments the document's progress in one transaction. When the count is complete the document becomes READY.", facts: [["Batch size", "1 · INSERT filter"], ["Retries", "5 · bisect · DLQ"], ["Atomicity", "TransactWriteItems"]] },
  titan: { kind: "AI / ML · Bedrock", title: "Amazon Titan Text Embeddings V2", body: "Turns each chunk into a normalised 256-dimension vector. The same model and size are used for questions, which is why their cosine similarity is meaningful.", facts: [["Model", "amazon.titan-embed-text-v2:0"], ["Dimensions", "256 · normalised"]] },
  query: { kind: "Compute · handle_query", title: "Synchronous retrieval", body: "Embeds the question and ranks every chunk of the selected document. It must finish inside API Gateway's 29-second limit, so it runs with a 28-second timeout.", facts: [["Timeout", "28 s · 1024 MB"], ["Scope", "signed owner + document"], ["Limit", "2,500 chunks per search"], ["top_k", "1–10"]] },
  qtitan: { kind: "AI / ML · Bedrock", title: "Titan V2 · question vector", body: "The question is embedded with the same model and dimensions as the chunks, with a short read timeout because a person is waiting.", facts: [["Read timeout", "12 s · 1 attempt"], ["Output", "256-d unit vector"]] },
  rank: { kind: "Search", title: "Exact cosine top-k", body: "A brute-force cosine comparison over the document's stored vectors, done in Lambda. No vector database: simple and auditable for a small corpus. Add an index only when measurements show this is the bottleneck.", facts: [["Method", "cosine on unit vectors"], ["Cost", "O(chunks × 256)"], ["Returns", "text, pages, score"]] },
  answer: { kind: "Compute · generate_answer (API)", title: "Queue the answer job", body: "Generation can outlast an API request, so this writes a QUEUED job to DynamoDB, sends its ID to SQS and immediately returns HTTP 202. The browser then polls GET /answers/{job_id}.", facts: [["Response", "202 Accepted + job_id"], ["Job expiry", "24 h (TTL)"], ["Poll", "GET /answers/{job_id}"]] },
  sqs: { kind: "Messaging", title: "Amazon SQS · answer queue", body: "Decouples slow model calls from the request. A message is retried up to three times, then moves to a dead-letter queue watched by a CloudWatch alarm.", facts: [["Visibility", "1,800 s"], ["maxReceiveCount", "3 → answer-failures DLQ"], ["Alarm", "DLQ messages > 0"]] },
  worker: { kind: "Compute · generate_answer (worker)", title: "Grounded generation worker", body: "Leases the job, retrieves trusted passages from DynamoDB itself (it never trusts text sent by a client), builds an evidence-only prompt and stores the cited answer with source pages.", facts: [["Timeout", "300 s · 1024 MB"], ["Lease", "330 s"], ["Prompt", "cite [S1]…, abstain without evidence"]] },
  nova: { kind: "AI / ML · Bedrock", title: "Amazon Nova 2 Lite", body: "Called through Bedrock's Converse API using the US cross-region inference profile. It sees only the retrieved excerpts and is told to treat them as untrusted data.", facts: [["Model", "us.amazon.nova-2-lite-v1:0"], ["API", "Converse"], ["Max output", "4,096 tokens"]] },
};

// ── State ─────────────────────────────────────────────────────────────────────
const KEYS = { theme: "folio.theme", current: "folio.current", turns: "folio.turns.", arch: "folio.arch", console: "folio.console", cover: "folio.cover.v1:" };
const state = {
  health: null, papers: [], library: [], docs: new Map(), current: null, uploading: null, turns: new Map(),
  asking: false, pollTimer: null, selectedNode: null, packetKey: "", events: 0,
};
const els = Object.fromEntries([
  "app", "intro", "intro-lines", "intro-facts", "intro-enter", "live-pill", "live-text", "meta-region", "meta-api", "topology",
  "topology-svg", "compact-strip", "narration", "narration-text", "narration-time", "node-card", "paper-list", "upload-list",
  "uploads-title", "library-hint", "dropzone", "pdf-input", "drop-title", "drop-subtitle", "library-error", "open-form", "open-id",
  "reader-title", "reader-sub", "doc-chip", "reindex", "ingest", "chunkmap", "chunkmap-title", "stat-chunks", "stat-method",
  "stat-upload", "stat-indexed", "stat-id", "doc-error", "viewer", "pages", "viewer-bar", "viewer-page", "viewer-pages",
  "reader-empty", "reader-empty-text", "thread", "thread-empty", "composer", "suggestions", "question", "send", "question-count",
  "console", "console-bar", "console-log", "console-last", "console-count", "console-stats", "palette", "palette-input",
  "palette-list", "toasts", "cite-pop",
].map((id) => [id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), $(id)]));

// ── Event stream, narration, toasts ───────────────────────────────────────────
function logEvent(kind, message, ms) {
  state.events += 1;
  const labels = { http: "HTTP", state: "STATE", ok: "OK", error: "ERROR" };
  els.consoleLog.append(h("li", {},
    h("span", { class: "log-time", text: clock() }),
    h("span", { class: `log-kind k-${kind}`, text: labels[kind] || kind }),
    h("span", { class: "log-msg", text: message, title: message }),
    h("span", { class: "log-ms", text: ms == null ? "" : fmtMs(ms) })));
  while (els.consoleLog.childElementCount > 300) els.consoleLog.firstElementChild.remove();
  els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
  els.consoleLast.textContent = `${labels[kind] || kind}  ${message}${ms == null ? "" : `  · ${fmtMs(ms)}`}`;
  els.consoleCount.textContent = `${state.events} event${state.events === 1 ? "" : "s"}`;
  els.console.classList.add("has-activity");
}

let narrationTimer = null;
let narrationKey = "";
function narrate(parts, tone = "active", key = "") {
  clearInterval(narrationTimer);
  // Repeated progress updates (same key) replace the text at once instead of retyping it.
  const instant = key && key === narrationKey;
  narrationKey = key;
  const segments = parts.filter((part) => part !== "").map((part) => (typeof part === "string" ? { text: part, bold: false } : { text: part.b, bold: true }));
  const total = segments.reduce((sum, seg) => sum + seg.text.length, 0);
  els.narration.className = `narration is-${tone}`;
  els.narrationTime.textContent = shortClock();
  const target = els.narrationText;
  const paint = (count) => {
    target.replaceChildren();
    let left = count;
    for (const seg of segments) {
      if (left <= 0) break;
      const piece = seg.text.slice(0, left);
      left -= piece.length;
      target.append(seg.bold ? h("b", { text: piece }) : document.createTextNode(piece));
    }
    target.classList.toggle("caret", count < total);
  };
  target.title = segments.map((seg) => seg.text).join("");
  if (!instant) $("sr-live").textContent = target.title; // screen readers hear each event once, not every typed frame
  if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { paint(total); return; }
  let shown = 0;
  const stepSize = Math.max(1, Math.ceil(total / 70));
  narrationTimer = setInterval(() => {
    shown = Math.min(total, shown + stepSize);
    paint(shown);
    if (shown >= total) clearInterval(narrationTimer);
  }, 16);
}

function toast(title, body, tone = "") {
  const node = h("div", { class: `toast${tone ? ` is-${tone}` : ""}`, role: "status" }, h("i"), h("b", { text: title }), h("span", { text: body }));
  els.toasts.append(node);
  setTimeout(() => { node.classList.add("is-leaving"); setTimeout(() => node.remove(), 320); }, 4600);
}

async function api(path, options = {}, { quiet = false } = {}) {
  const method = options.method || "GET";
  const started = performance.now();
  let response;
  try {
    response = await fetch(path, { cache: "no-store", ...options });
  } catch {
    logEvent("error", `${method} ${path} · local demo server unreachable`);
    throw new Error("The local demo server is unreachable. Is `python -m demo_ui.server` still running?");
  }
  const ms = performance.now() - started;
  let data = {};
  try { data = await response.json(); } catch { /* non-JSON error bodies are reported by status */ }
  if (!response.ok) {
    logEvent("error", `${method} ${path} → ${response.status} ${data.error || ""}`.trim(), ms);
    throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  }
  if (!quiet) logEvent("http", `${method} ${path} → ${response.status}`, ms);
  return { data, ms };
}
const postJson = (path, body, opts) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts);

// ── Live architecture ─────────────────────────────────────────────────────────
const refs = { nodes: {}, edges: {}, chips: {}, packets: null, laneIngest: null, laneAsk: null };

function edgeGeometry(from, to, y) {
  if (y === "v") {
    const x = from.x;
    const y1 = from.y + nodeH(from) / 2;
    const y2 = to.y - nodeH(to) / 2;
    return { d: `M ${x} ${y1} L ${x} ${y2 - 5}`, arrow: `${x},${y2} ${x - 3.5},${y2 - 6} ${x + 3.5},${y2 - 6}` };
  }
  const x1 = from.x + nodeW(from) / 2;
  const x2 = to.x - nodeW(to) / 2;
  return { d: `M ${x1} ${y} L ${x2 - 5} ${y}`, arrow: `${x2},${y} ${x2 - 6},${y - 3.5} ${x2 - 6},${y + 3.5}` };
}

function buildTopology() {
  const root = els.topologySvg;
  root.replaceChildren();
  const defs = svg("defs", {}, svg("filter", { id: "glow", x: "-30%", y: "-60%", width: "160%", height: "220%" },
    svg("feDropShadow", { dx: 0, dy: 0, stdDeviation: 4, "flood-opacity": 0.55, style: "flood-color: var(--accent)" })));
  root.append(defs,
    svg("rect", { class: "group-box", x: 8, y: 24, width: 176, height: 226, rx: 16 }),
    svg("text", { class: "group-label", x: 22, y: 242 }, "Your Mac · 127.0.0.1"),
    svg("rect", { class: "group-box aws", x: 200, y: 24, width: 1232, height: 226, rx: 16 }),
    svg("text", { class: "group-label aws", x: 216, y: 242 }, "AWS Cloud · us-east-1 · stack rag-pdf"),
    svg("line", { class: "lane-rule", x1: 360, y1: 141, x2: 1418, y2: 141 }),
    svg("text", { x: 1418, y: 44, "text-anchor": "end" }, svg("tspan", { class: "lane-label" }, "Ingest  "), (refs.laneIngest = svg("tspan", { class: "lane-state" }, "idle"))),
    svg("text", { x: 1418, y: 158, "text-anchor": "end" }, svg("tspan", { class: "lane-label" }, "Ask  "), (refs.laneAsk = svg("tspan", { class: "lane-state" }, "idle"))));
  const legend = svg("g", { class: "legend-svg" });
  let lx = 1418;
  for (const [kind, label] of [["ai", "AI / ML"], ["integration", "Messaging"], ["database", "Database"], ["storage", "Storage"], ["compute", "Compute"], ["network", "Networking"], ["client", "Client"]]) {
    const width = label.length * 5.6 + 22;
    lx -= width;
    legend.append(svg("g", { "data-kind": kind }, svg("rect", { x: lx, y: 235, width: 8, height: 8, rx: 2 }), svg("text", { x: lx + 13, y: 242.5 }, label)));
  }
  root.append(legend);

  const edgeLayer = svg("g");
  const arcPath = `M 150 ${Y2 - H / 2} C 196 -18, ${laneX(1) - 40} -18, ${laneX(1)} ${Y1 - H / 2 - 6}`;
  refs.edges.arc = { g: svg("g", { class: "edge-g is-dashed" },
    svg("path", { class: "edge", d: arcPath }),
    svg("polygon", { class: "edge-arrow", points: `${laneX(1)},${Y1 - H / 2} ${laneX(1) - 4.5},${Y1 - H / 2 - 7} ${laneX(1) + 4.5},${Y1 - H / 2 - 7}` }),
    svg("path", { id: "arc-path", d: arcPath, fill: "none", stroke: "none" }),
    svg("text", { class: "edge-label", dy: -5 }, svg("textPath", { href: "#arc-path", startOffset: "62%", "text-anchor": "middle" }, "presigned PUT · bytes go straight to S3"))), d: arcPath };
  edgeLayer.append(refs.edges.arc.g);
  for (const [id, fromId, toId, y] of EDGES) {
    const geo = edgeGeometry(nodeById(fromId), nodeById(toId), y);
    const g = svg("g", { class: "edge-g" }, svg("path", { class: "edge", d: geo.d }), svg("polygon", { class: "edge-arrow", points: geo.arrow }));
    refs.edges[id] = { g, d: geo.d };
    edgeLayer.append(g);
  }
  refs.packets = svg("g");

  const nodeLayer = svg("g");
  for (const item of NODES) {
    const w = nodeW(item);
    const hgt = nodeH(item);
    const bx = item.x - w / 2;
    const by = item.y - hgt / 2;
    const tall = hgt > H;
    const tileY = tall ? by + 12 : item.y - 13;
    const titleY = tall ? by + 24 : item.y - 2;
    const icon = iconSvg(item.icon);
    icon.setAttribute("x", bx + 13); icon.setAttribute("y", tileY + 5); icon.setAttribute("width", 16); icon.setAttribute("height", 16);
    const sub = svg("text", { class: "node-sub", x: bx + 41, y: titleY + 14 }, item.sub);
    const g = svg("g", { class: "node", "data-kind": item.kind, tabindex: 0, role: "button", "aria-label": `${item.title}: details` },
      svg("rect", { class: "node-halo", x: bx, y: by, width: w, height: hgt, rx: 12 }),
      svg("rect", { class: "node-box", x: bx, y: by, width: w, height: hgt, rx: 12 }),
      svg("rect", { class: "node-tile", x: bx + 8, y: tileY, width: 26, height: 26, rx: 7 }),
      icon,
      svg("text", { class: "node-title", x: bx + 41, y: titleY }, item.title),
      sub,
      svg("circle", { class: "node-dot", cx: bx + w - 10, cy: by + 10, r: 3 }));
    if (tall) {
      ["IAM on every route", "same account only", "5 rps · burst 10"].forEach((line, index) =>
        g.append(svg("text", { class: "node-sub", x: bx + 12, y: by + 82 + index * 19 }, line)));
    }
    if (item.id === "extract") {
      g.append(svg("g", { class: "node-gate" }, svg("rect", { x: item.x - 46, y: by - 17, width: 92, height: 13, rx: 6.5 }),
        svg("text", { x: item.x, y: by - 7.5, "text-anchor": "middle" }, "TEXTRACT GATED")));
    }
    g.addEventListener("click", (event) => { event.stopPropagation(); openNodeCard(item.id); });
    g.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNodeCard(item.id); } });
    refs.nodes[item.id] = { g, sub, item };
    nodeLayer.append(g);
  }
  root.append(edgeLayer, refs.packets, nodeLayer);

  const order = ["browser", "signer", "apigw", "upload", "s3", "process", "extract", "chunks", "embed", "titan", "|", "query", "qtitan", "rank", "answer", "sqs", "worker", "nova"];
  els.compactStrip.replaceChildren(...order.map((id) => {
    if (id === "|") return h("li", { class: "sep", "aria-hidden": "true", text: "·" });
    const item = nodeById(id);
    const open = (event) => { event.stopPropagation(); openNodeCard(id); };
    const chip = h("li", { "data-kind": item.kind, title: item.title, tabindex: 0, role: "button", "aria-label": `${item.title}: details`, onclick: open,
      onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(event); } } }, iconSvg(item.icon), h("span", { text: item.title }));
    refs.chips[id] = chip;
    return chip;
  }));
}

function stepStates(steps, index, { error = false, allActiveUpTo = null } = {}) {
  const result = { nodes: new Map(), edges: new Map() };
  steps.forEach((step, i) => {
    let status = null;
    if (allActiveUpTo != null) status = i <= allActiveUpTo ? "active" : null;
    else if (i < index) status = "done";
    else if (i === index) status = error ? "error" : "active";
    if (!status) return;
    step.nodes.forEach((id) => result.nodes.set(id, status));
    step.edges.forEach((id) => result.edges.set(id, status));
  });
  return result;
}

function ingestVisual() {
  if (state.uploading) return { ...stepStates(INGEST_STEPS, 0, { allActiveUpTo: 1 }), label: "uploading", tone: "active" };
  const doc = currentDoc();
  if (!doc) return { nodes: new Map(), edges: new Map(), label: "idle", tone: "" };
  const total = Number(doc.total_chunks || 0);
  const done = Number(doc.completed_chunks || 0);
  switch (doc.status) {
    case "READY": return { ...stepStates(INGEST_STEPS, INGEST_STEPS.length), label: `ready · ${total}/${total} chunks`, tone: "done" };
    case "FAILED": return { ...stepStates(INGEST_STEPS, total ? 4 : 3, { error: true }), label: "failed", tone: "error" };
    case "EMBEDDING": return { ...stepStates(INGEST_STEPS, 4), label: `embedding · ${done}/${total}`, tone: "active" };
    case "EXTRACTING": return { ...stepStates(INGEST_STEPS, 3), label: "extracting text", tone: "active" };
    case "AWAITING_UPLOAD": return { ...stepStates(INGEST_STEPS, 2), label: "waiting for S3 event", tone: "active" };
    default: return { nodes: new Map(), edges: new Map(), label: "checking…", tone: "" };
  }
}

function lastTurn() { const turns = state.turns.get(state.current) || []; return turns[turns.length - 1]; }

function askVisual() {
  const turn = lastTurn();
  if (!turn) return { nodes: new Map(), edges: new Map(), label: "idle", tone: "" };
  if (turn.phase === "error") return { ...stepStates(ASK_STEPS, turn.failedAt ?? 0, { error: true }), label: "failed", tone: "error" };
  if (turn.answer) return { ...stepStates(ASK_STEPS, ASK_STEPS.length), label: `answered · ${fmtMs(turn.timings?.total)}`, tone: "done" };
  const index = { retrieve: 0, queued: 1, generating: 2 }[turn.phase] ?? 0;
  return { ...stepStates(ASK_STEPS, index), label: ["retrieving passages", "queued in SQS", "Nova is writing"][index], tone: "active" };
}

function liveSub(id) {
  const doc = state.uploading ? null : currentDoc();
  const entry = state.uploading ? null : currentEntry();
  const turn = lastTurn();
  const total = Number(doc?.total_chunks || 0);
  switch (id) {
    case "s3": return state.uploading ? `PUT ${fmtBytes(state.uploading.size)}` : entry?.size_bytes ? `${fmtBytes(entry.size_bytes)} stored` : null;
    case "upload": return entry?.upload_ms ? `upload ${fmtMs(entry.upload_ms)}` : null;
    case "extract": return doc?.extraction_method === "pypdf" ? `pypdf · ${entry?.pages ?? "?"} pp` : doc?.extraction_method === "textract" ? "Textract OCR" : null;
    case "chunks": return total ? `${total} chunks` : null;
    case "embed": return doc?.status === "EMBEDDING" ? `${doc.completed_chunks}/${total} done` : doc?.status === "READY" ? `${total}/${total} ✓` : null;
    case "titan": return doc?.status === "READY" ? "vectors ready" : null;
    case "query": return turn?.timings?.retrieve ? fmtMs(turn.timings.retrieve) : null;
    case "rank": return turn?.ranked?.length && total ? `top ${turn.ranked.length} of ${total}` : null;
    case "sqs": return turn && !turn.answer && turn.phase === "queued" ? "job waiting" : turn?.jobId ? `job ${turn.jobId.slice(0, 6)}` : null;
    case "nova": return turn?.timings?.generate ? `wrote in ${fmtMs(turn.timings.generate)}` : null;
    default: return null;
  }
}

function renderTopology() {
  const ingest = ingestVisual();
  const ask = askVisual();
  const rank = { done: 1, active: 2, error: 3 };
  const merge = (a, b) => ((rank[a] || 0) >= (rank[b] || 0) ? a : b);
  for (const [id, ref] of Object.entries(refs.nodes)) {
    const status = merge(ingest.nodes.get(id), ask.nodes.get(id));
    for (const target of [ref.g, refs.chips[id]]) {
      if (!target) continue;
      target.classList.toggle("is-active", status === "active");
      target.classList.toggle("is-done", status === "done");
      target.classList.toggle("is-error", status === "error");
    }
    ref.g.classList.toggle("is-selected", state.selectedNode === id);
    ref.sub.textContent = liveSub(id) || ref.item.sub;
  }
  refs.nodes.extract.g.classList.toggle("is-gated", !state.uploading && currentDoc()?.extraction_method === "pypdf");
  const activeEdges = [];
  for (const [id, ref] of Object.entries(refs.edges)) {
    const status = merge(ingest.edges.get(id), ask.edges.get(id));
    ref.g.classList.toggle("is-active", status === "active");
    ref.g.classList.toggle("is-done", status === "done");
    ref.g.classList.toggle("is-error", status === "error");
    if (status === "active") activeEdges.push(id);
  }
  const key = activeEdges.join(",");
  if (key !== state.packetKey) {
    state.packetKey = key;
    refs.packets.replaceChildren(...activeEdges.flatMap((id) => {
      const long = id === "arc";
      const count = long ? 3 : 2;
      const dur = long ? 1.8 : 1.0;
      return Array.from({ length: count }, (_, k) => svg("circle", { class: "packet", r: 2.8 },
        svg("animateMotion", { dur: `${dur}s`, begin: `-${((k * dur) / count).toFixed(2)}s`, repeatCount: "indefinite", path: refs.edges[id].d })));
    }));
  }
  const setLane = (target, visual) => { target.textContent = visual.label; target.setAttribute("class", `lane-state ${visual.tone ? `is-${visual.tone}` : ""}`); };
  setLane(refs.laneIngest, ingest);
  setLane(refs.laneAsk, ask);
  if (state.selectedNode) fillNodeLive(state.selectedNode);
}

function openNodeCard(id) {
  const info = NODE_INFO[id];
  if (!info) return;
  if (state.selectedNode === id && !els.nodeCard.hidden) { closeNodeCard(); return; }
  state.selectedNode = id;
  const item = nodeById(id);
  els.nodeCard.dataset.kind = item.kind;
  $("node-card-icon").replaceChildren(iconSvg(item.icon));
  $("node-card-kind").textContent = info.kind;
  $("node-card-title").textContent = info.title;
  $("node-card-body").textContent = info.body;
  $("node-card-facts").replaceChildren(...info.facts.flatMap(([key, value]) => [h("dt", { text: key }), h("dd", { text: value })]));
  fillNodeLive(id);
  els.nodeCard.hidden = false;
  const anchor = els.topology.dataset.mode === "compact" ? refs.chips[id] : refs.nodes[id].g;
  const box = anchor.getBoundingClientRect();
  const host = els.topology.getBoundingClientRect();
  const width = els.nodeCard.offsetWidth;
  els.nodeCard.style.left = `${Math.min(Math.max(8, box.left - host.left + box.width / 2 - width / 2), host.width - width - 8)}px`;
  els.nodeCard.style.top = `${box.bottom - host.top + 10}px`;
  renderTopology();
}
function fillNodeLive(id) { const live = liveSub(id); $("node-card-live").textContent = live ? `Now: ${live}` : ""; }
function closeNodeCard() { if (els.nodeCard.hidden) return; els.nodeCard.hidden = true; state.selectedNode = null; renderTopology(); }

function setArchMode(mode) {
  const valid = ["full", "compact", "hidden"].includes(mode) ? mode : "full";
  els.app.dataset.arch = valid === "hidden" ? "hidden" : "shown";
  if (valid !== "hidden") els.topology.dataset.mode = valid;
  document.querySelectorAll(".seg button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === valid)));
  $("topology-toggle").setAttribute("aria-pressed", String(valid !== "hidden"));
  closeNodeCard();
  store.set(KEYS.arch, valid);
  requestAnimationFrame(() => layoutPages());
}
function cycleArch() {
  const current = els.app.dataset.arch === "hidden" ? "hidden" : els.topology.dataset.mode;
  setArchMode({ full: "compact", compact: "hidden", hidden: "full" }[current] || "full");
}

// ── PDF rendering (PDF.js) ────────────────────────────────────────────────────
// One shared worker for every document; without it PDF.js starts a new Web Worker per getDocument().
const pdfWorker = new pdfjsLib.PDFWorker();
const pdfCache = new Map(); // url -> Promise<PDFDocumentProxy>, most recent last
const KEEP_DOCS = 3;
function loadPdf(url) {
  if (pdfCache.has(url)) {
    const cached = pdfCache.get(url);
    pdfCache.delete(url); pdfCache.set(url, cached); // mark as most recently used
    return cached;
  }
  const promise = pdfjsLib.getDocument({ url, worker: pdfWorker, isEvalSupported: false }).promise
    .catch((error) => { pdfCache.delete(url); throw error; });
  pdfCache.set(url, promise);
  for (const [oldUrl, oldPromise] of pdfCache) {
    if (pdfCache.size <= KEEP_DOCS) break;
    if (oldUrl === url || oldUrl === viewer.url) continue;
    pdfCache.delete(oldUrl);
    oldPromise.then((doc) => doc.destroy()).catch(() => {});
  }
  return promise;
}

const viewer = { url: null, doc: null, token: 0, jump: 0, zoom: 1, aspect: 1.294, observer: null, keeper: null, hl: [], pending: null };

function pageWidth() {
  const avail = Math.max(240, els.pages.clientWidth - 40);
  return Math.round(Math.min(avail, 900) * viewer.zoom);
}

function scrollPages(top, smooth) {
  // Programmatic jumps scroll instantly so a long jump does not render every page it passes.
  els.pages.style.scrollBehavior = smooth ? "smooth" : "auto";
  els.pages.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
}

async function openViewer(url) {
  if (!url) {
    viewer.url = null; viewer.doc = null; viewer.token += 1; viewer.pending = null;
    viewer.observer?.disconnect(); viewer.keeper?.disconnect();
    els.pages.replaceChildren(); els.viewerBar.hidden = true; els.readerEmpty.hidden = false;
    return null;
  }
  if (viewer.url === url && viewer.doc) return viewer.doc;
  if (viewer.url === url && viewer.pending) return viewer.pending;
  const token = ++viewer.token;
  viewer.url = url; viewer.doc = null; viewer.hl = [];
  viewer.observer?.disconnect(); viewer.keeper?.disconnect();
  els.readerEmpty.hidden = true;
  els.pages.replaceChildren(h("div", { class: "page is-loading", style: `width:${pageWidth()}px;height:${Math.round(pageWidth() * 1.29)}px` }));
  const fail = () => {
    if (token !== viewer.token) return null;
    els.pages.replaceChildren(); els.viewerBar.hidden = true; els.readerEmpty.hidden = false;
    els.readerEmptyText.textContent = "This PDF could not be rendered here. Answers and page citations still work.";
    return null;
  };
  viewer.pending = (async () => {
    let doc, base;
    try {
      doc = await loadPdf(url);
      if (token !== viewer.token) return null;
      if (!doc.numPages) return fail();
      base = (await doc.getPage(1)).getViewport({ scale: 1 });
    } catch { return fail(); }
    if (token !== viewer.token) return null;
    viewer.doc = doc; viewer.aspect = base.height / base.width;
    viewer.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
    }, { root: els.pages, rootMargin: "700px 0px" });
    // Pages far outside the view give their canvas back, so a 144-page paper does not hold every bitmap.
    viewer.keeper = new IntersectionObserver((entries) => {
      for (const entry of entries) if (!entry.isIntersecting) freePage(entry.target);
    }, { root: els.pages, rootMargin: "2600px 0px" });
    const nodes = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      nodes.push(h("div", { class: "page is-loading", "data-page": n }, h("canvas"), h("div", { class: "hl-layer" }), h("span", { class: "page-num", text: `p. ${n}` })));
    }
    els.pages.replaceChildren(...nodes);
    nodes.forEach((page) => { viewer.observer.observe(page); viewer.keeper.observe(page); });
    scrollPages(0, false);
    els.viewerPages.textContent = doc.numPages;
    els.viewerPage.textContent = "1";
    els.viewerBar.hidden = false;
    layoutPages();
    return doc;
  })().finally(() => { if (token === viewer.token) viewer.pending = null; });
  return viewer.pending;
}

function freePage(page) {
  if (!page.dataset.rendered) return;
  // Observer entries arrive late; re-check the real distance so a page now on screen is never blanked.
  const view = els.pages.getBoundingClientRect();
  const box = page.getBoundingClientRect();
  if (box.bottom > view.top - 2400 && box.top < view.bottom + 2400) return;
  page.querySelector("canvas").replaceWith(document.createElement("canvas"));
  page.dataset.rendered = "";
  page.classList.add("is-loading");
}

function layoutPages() {
  if (!viewer.doc) return;
  const width = pageWidth();
  for (const page of els.pages.querySelectorAll(".page[data-page]")) {
    if (page.dataset.width !== String(width)) {
      const ratio = Number(page.dataset.ratio) || viewer.aspect;
      page.style.width = `${width}px`;
      page.style.height = `${Math.round(width * ratio)}px`;
      page.dataset.rendered = "";
      page.dataset.width = String(width);
    }
  }
  const top = els.pages.scrollTop;
  const bottom = top + els.pages.clientHeight;
  for (const page of els.pages.querySelectorAll(".page[data-page]")) {
    if (page.offsetTop < bottom + 700 && page.offsetTop + page.offsetHeight > top - 700) renderPage(Number(page.dataset.page));
  }
}

// Render queue: at most two pages at once, the page a citation targets goes first.
const renderJobs = new Map();
const renderQueue = [];
let renderActive = 0;
function renderPage(n, { priority = false } = {}) {
  const page = els.pages.querySelector(`.page[data-page="${n}"]`);
  if (!page || !viewer.doc || !page.dataset.width) return Promise.resolve();
  const width = Number(page.dataset.width);
  if (page.dataset.rendered === String(width)) return Promise.resolve();
  const key = `${viewer.token}#${n}@${width}`;
  if (renderJobs.has(key)) {
    if (priority) { const i = renderQueue.findIndex((job) => job.key === key); if (i > 0) renderQueue.unshift(...renderQueue.splice(i, 1)); }
    return renderJobs.get(key).promise;
  }
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const job = { key, n, page, width, token: viewer.token, doc: viewer.doc, resolve, promise };
  renderJobs.set(key, job);
  if (priority) renderQueue.unshift(job); else renderQueue.push(job);
  pumpRenders();
  return promise;
}

function pumpRenders() {
  while (renderActive < 2 && renderQueue.length) {
    const job = renderQueue.shift();
    renderActive += 1;
    runRender(job).catch(() => { /* a failed page keeps its placeholder */ }).finally(() => {
      renderActive -= 1;
      renderJobs.delete(job.key);
      job.resolve();
      pumpRenders();
    });
  }
}

async function runRender({ n, page, width, token, doc }) {
  if (token !== viewer.token || !page.isConnected || page.dataset.width !== String(width)) return;
  const pdfPage = await doc.getPage(n);
  if (token !== viewer.token || !page.isConnected) return;
  const base = pdfPage.getViewport({ scale: 1 });
  const ratio = base.height / base.width;
  page.dataset.ratio = String(ratio);
  page.style.height = `${Math.round(width * ratio)}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = pdfPage.getViewport({ scale: (width / base.width) * dpr });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  if (token !== viewer.token || !page.isConnected || page.dataset.width !== String(width)) return;
  page.querySelector("canvas").replaceWith(canvas);
  page.classList.remove("is-loading");
  page.dataset.rendered = String(width);
}

function renderVisible() {
  if (!viewer.doc) return;
  const top = els.pages.scrollTop - 300;
  const bottom = els.pages.scrollTop + els.pages.clientHeight + 300;
  for (const page of els.pages.querySelectorAll(".page[data-page]")) {
    if (page.offsetTop > bottom) break;
    if (page.offsetTop + page.offsetHeight >= top && !page.dataset.rendered) renderPage(Number(page.dataset.page));
  }
}

function updateCurrentPage() {
  if (!viewer.doc) return;
  renderVisible();
  const mark = els.pages.scrollTop + els.pages.clientHeight * 0.3;
  let current = 1;
  for (const page of els.pages.querySelectorAll(".page[data-page]")) {
    if (page.offsetTop <= mark) current = Number(page.dataset.page); else break;
  }
  els.viewerPage.textContent = String(current);
}

const norm = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Returns the cited lines as fractions of the page size, so highlights stay put through zoom and resize.
async function findPassage(pdfPage, excerpt) {
  const base = pdfPage.getViewport({ scale: 1 });
  const content = await pdfPage.getTextContent();
  let joined = "";
  const spans = [];
  content.items.forEach((item, index) => {
    const text = norm(item.str || "");
    if (!text) return;
    const start = joined ? joined.length + 1 : 0;
    joined += (joined ? " " : "") + text;
    spans.push([start, joined.length, index]);
  });
  const words = norm(excerpt).split(" ").filter(Boolean);
  if (!words.length || !joined) return [];
  let start = -1;
  let consumed = 0;
  outer: for (const size of [10, 7, 5, 4]) {
    for (const offset of [1, 3, 8, 14, 22]) {
      if (words.length < offset + size) continue;
      const at = joined.indexOf(words.slice(offset, offset + size).join(" "));
      if (at >= 0) { start = at; consumed = words.slice(0, offset).join(" ").length + 1; break outer; }
    }
  }
  if (start < 0) return [];
  const from = Math.max(0, start - consumed);
  const to = Math.min(joined.length, from + norm(excerpt).length);
  const rects = [];
  for (const [s, e, index] of spans) {
    if (e < from || s > to) continue;
    const item = content.items[index];
    const [a, b, c, d, tx, ty] = item.transform;
    const fontH = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    const r = base.convertToViewportRectangle([tx, ty - fontH * 0.22, tx + (item.width || 0), ty + fontH * 0.92]);
    rects.push({ left: Math.min(r[0], r[2]), top: Math.min(r[1], r[3]), width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]) });
  }
  rects.sort((p, q) => p.top - q.top || p.left - q.left);
  const lines = [];
  for (const rect of rects) {
    const line = lines.find((l) => Math.abs(l.top - rect.top) < rect.height * 0.5 && rect.left - (l.left + l.width) < 14);
    if (line) {
      const right = Math.max(line.left + line.width, rect.left + rect.width);
      line.left = Math.min(line.left, rect.left); line.width = right - line.left;
      line.height = Math.max(line.height, rect.height);
    } else lines.push({ ...rect });
  }
  return lines.filter((l) => l.width > 1).map((l) => ({
    left: (l.left - 1.5) / base.width, top: l.top / base.height, width: (l.width + 3) / base.width, height: l.height / base.height,
  }));
}

function clearHighlights() {
  for (const node of viewer.hl) node.remove();
  viewer.hl = [];
  els.pages.querySelectorAll(".page.is-target").forEach((page) => page.classList.remove("is-target"));
}

function jumpPill(label) {
  els.viewer.querySelector(".jump-pill")?.remove();
  const pill = h("div", { class: "jump-pill", text: label });
  els.viewer.append(pill);
  setTimeout(() => pill.remove(), 1700);
}

const pct = (v) => `${(v * 100).toFixed(3)}%`;

async function goToPage(n, { excerpt = null, label = null } = {}) {
  if (!n) return false;
  const entry = currentEntry();
  if (!entry?.pdf_url) return false;
  const jump = ++viewer.jump; // a newer jump cancels this one after every await
  try {
    const doc = await openViewer(entry.pdf_url);
    if (!doc || jump !== viewer.jump || doc !== viewer.doc) return false;
    const pageNum = Math.min(Math.max(1, n), doc.numPages);
    const page = els.pages.querySelector(`.page[data-page="${pageNum}"]`);
    if (!page) return false;
    clearHighlights();
    scrollPages(page.offsetTop - 14, false);
    await renderPage(pageNum, { priority: true });
    if (jump !== viewer.jump || doc !== viewer.doc || !page.isConnected) return false;
    page.classList.add("is-target");
    setTimeout(() => page.classList.remove("is-target"), 1800);
    jumpPill(label ? `${label} · page ${pageNum}` : `Page ${pageNum}`);
    logEvent("state", `reader → page ${pageNum}${label ? ` (${label})` : ""}`);
    if (!excerpt) return true;
    const lines = await findPassage(await doc.getPage(pageNum), excerpt);
    if (jump !== viewer.jump || doc !== viewer.doc || !page.isConnected || !lines.length) return true;
    const layer = page.querySelector(".hl-layer");
    lines.forEach((line, i) => {
      const node = h("div", { class: "hl", style: `left:${pct(line.left)};top:${pct(line.top)};width:${pct(line.width)};height:${pct(line.height)};animation-delay:${i * 40}ms` });
      layer.append(node);
      viewer.hl.push(node);
    });
    if (label) {
      const tag = h("div", { class: "hl-tag", style: `left:max(36px, calc(${pct(lines[0].left)} - 6px));top:${pct(lines[0].top)}`, text: label });
      layer.append(tag);
      viewer.hl.push(tag);
    }
    scrollPages(page.offsetTop + Math.max(0, lines[0].top * page.offsetHeight - 90), true);
    return true;
  } catch {
    return false; // a page that fails to parse must not break the answer flow
  }
}

// Covers: rendered once from page 1, kept in memory and (when storage allows) in localStorage.
const coverMem = new Map();
const coverQueued = new Set();
async function coverFor(url) {
  if (coverMem.has(url)) return coverMem.get(url);
  const cached = store.get(KEYS.cover + url);
  if (cached) { coverMem.set(url, cached); return cached; }
  const doc = await pdfjsLib.getDocument({ url, worker: pdfWorker, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 132 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const data = canvas.toDataURL("image/jpeg", 0.82);
    coverMem.set(url, data);
    store.set(KEYS.cover + url, data);
    return data;
  } finally {
    doc.destroy(); // the cover's document is not needed after its thumbnail exists
  }
}

function paintCovers(url, data) {
  document.querySelectorAll("img[data-cover]").forEach((img) => {
    if (img.dataset.cover !== url) return;
    img.src = data; img.hidden = false; img.parentElement?.querySelector(".cover-fallback")?.remove();
  });
}

const coverQueue = [];
let coverBusy = false;
function queueCover(url) {
  if (coverQueued.has(url)) return;
  coverQueued.add(url);
  coverQueue.push(url);
  if (coverBusy) return;
  coverBusy = true;
  (async () => {
    while (coverQueue.length) {
      const src = coverQueue.shift();
      try { paintCovers(src, await coverFor(src)); } catch { coverQueued.delete(src); /* fallback lines stay */ }
    }
    coverBusy = false;
  })();
}

// ── Library ───────────────────────────────────────────────────────────────────
const currentEntry = () => state.library.find((entry) => entry.document_id === state.current) || null;
const currentDoc = () => (state.current ? state.docs.get(state.current) || null : null);
const paperMeta = (name) => state.papers.find((paper) => paper.name === name) || null;
function entryForPaper(name) {
  const entries = state.library.filter((entry) => entry.paper === name);
  return entries.find((entry) => entry.document_id === state.current)
    || entries.find((entry) => state.docs.get(entry.document_id)?.status === "READY") || entries[0] || null;
}
function docStateLabel(doc) {
  if (!doc) return { text: "…", tone: "" };
  if (doc.status === "UNKNOWN") return { text: "Unavailable", tone: "error" };
  if (doc.status === "READY") return { text: "Ready", tone: "ready" };
  if (doc.status === "FAILED") return { text: "Failed", tone: "error" };
  if (doc.status === "EMBEDDING") return { text: `${doc.completed_chunks || 0}/${doc.total_chunks || 0}`, tone: "busy" };
  if (doc.status === "EXTRACTING") return { text: "Extracting", tone: "busy" };
  return { text: "Uploading", tone: "busy" };
}

function coverNode(url) {
  const img = h("img", { alt: "", hidden: true, "data-cover": url || null });
  const cover = h("span", { class: "cover" }, img, h("span", { class: "cover-fallback" }, h("span"), h("span"), h("span")));
  if (url) {
    const cached = coverMem.get(url) || store.get(KEYS.cover + url);
    if (cached) { coverMem.set(url, cached); img.src = cached; img.hidden = false; cover.querySelector(".cover-fallback").remove(); } else queueCover(url);
  }
  return cover;
}

function paperButton({ title, meta, entry, onClick, current, coverUrl }) {
  const doc = entry ? state.docs.get(entry.document_id) : null;
  const label = entry ? docStateLabel(doc) : { text: "Index", tone: "new" };
  const busy = label.tone === "busy";
  const progress = doc?.status === "EMBEDDING" && doc.total_chunks ? doc.completed_chunks / doc.total_chunks : doc?.status === "EXTRACTING" ? 0.06 : 0;
  return h("button", { class: `paper${current ? " is-current" : ""}`, type: "button", "data-key": entry?.document_id || title, onclick: onClick, disabled: Boolean(state.uploading) && !entry, "aria-current": current ? "true" : null },
    coverNode(coverUrl),
    h("span", { class: "paper-body" },
      h("span", { class: "paper-title", text: title }),
      h("span", { class: "paper-meta" }, h("span", { text: meta }), h("span", { class: `paper-state is-${label.tone}`, text: label.text })),
      busy ? h("span", { class: "paper-progress" }, h("span", { style: `transform: scaleX(${Math.max(progress, 0.04)})` })) : null));
}

function renderLibrary() {
  const focusedKey = document.activeElement?.closest?.(".paper")?.dataset.key;
  els.paperList.replaceChildren(...state.papers.map((paper) => {
    const entry = entryForPaper(paper.name);
    const doc = entry ? state.docs.get(entry.document_id) : null;
    const chunks = doc?.status === "READY" ? ` · ${doc.total_chunks} ch` : "";
    return h("li", {}, paperButton({
      title: paper.title, entry, current: entry && entry.document_id === state.current, coverUrl: paper.url,
      meta: `${paper.pages ?? "?"} pp${chunks}`,
      onClick: () => (entry && doc?.status !== "FAILED" ? selectDocument(entry.document_id) : indexPaper(paper.name)),
    }));
  }));
  const uploads = state.library.filter((entry) => !entry.paper || !paperMeta(entry.paper));
  els.uploadsTitle.hidden = els.uploadList.hidden = uploads.length === 0;
  els.uploadList.replaceChildren(...uploads.map((entry) => {
    const doc = state.docs.get(entry.document_id);
    const meta = [entry.pages ? `${entry.pages} pp` : null, doc?.status === "READY" ? `${doc.total_chunks} ch` : null].filter(Boolean).join(" · ") || entry.document_id.slice(0, 10);
    return h("li", {},
      paperButton({ title: stripPdf(entry.filename), meta, entry, current: entry.document_id === state.current, coverUrl: entry.pdf_url, onClick: () => selectDocument(entry.document_id) }),
      h("button", { class: "forget", type: "button", title: "Remove from this list (the AWS copy is kept)", "aria-label": `Remove ${stripPdf(entry.filename)} from the list`, onclick: () => forget(entry.document_id), text: "×" }));
  }));
  const visible = [...state.papers.map((paper) => entryForPaper(paper.name)), ...uploads].filter(Boolean);
  const ready = visible.filter((entry) => state.docs.get(entry.document_id)?.status === "READY").length;
  els.libraryHint.textContent = `${ready} of ${state.papers.length + uploads.length} indexed`;
  if (focusedKey) [...document.querySelectorAll(".paper")].find((button) => button.dataset.key === focusedKey)?.focus();
}

async function refreshLibrary() {
  const { data } = await api("/api/library", {}, { quiet: true });
  state.library = data.documents || [];
  renderLibrary();
}

function narrateTransition(id, before, after) {
  if (id !== state.current || !after) return;
  const total = Number(after.total_chunks || 0);
  const done = Number(after.completed_chunks || 0);
  if (after.status === "EXTRACTING" && before?.status !== "EXTRACTING") {
    narrate(["S3 raised an ObjectCreated event: ", { b: "λ process" }, " checked the %PDF header and started reading the text."]);
  } else if (after.status === "EMBEDDING" && before?.status !== "EMBEDDING") {
    narrate(after.extraction_method === "pypdf"
      ? ["Textract is gated on this account, so ", { b: "pypdf" }, " read the text layer: ", { b: `${total} chunks` }, " written to DynamoDB."]
      : [{ b: "Textract" }, " returned the text: ", { b: `${total} chunks` }, " written to DynamoDB."]);
  } else if (after.status === "EMBEDDING" && done !== Number(before?.completed_chunks || 0)) {
    narrate(["DynamoDB Streams → ", { b: "λ embed" }, " → Titan V2: ", { b: `${done} of ${total}` }, " chunks embedded so far."], "active", `embed:${id}`);
  } else if (after.status === "READY" && before && before.status !== "READY") {
    const seconds = after.updated_at && after.created_at ? after.updated_at - after.created_at : null;
    narrate(["Every chunk now has a 256-d vector. ", { b: seconds != null ? `Indexed in ${seconds} s` : "Indexed" }, ", ready for questions."], "ok");
    toast("Paper indexed", `${total} chunks${seconds != null ? ` in ${seconds} s` : ""} · ${after.extraction_method || "text"}`, "ok");
  } else if (after.status === "FAILED" && before?.status !== "FAILED") {
    narrate(["Processing stopped: ", { b: after.error_message || "the document failed" }, "."], "error");
    toast("Indexing failed", after.error_message || "Try a text-based PDF.", "error");
  }
}

async function fetchDoc(id, { quiet = true } = {}) {
  const { data } = await api(`/api/documents/${id}`, {}, { quiet });
  const before = state.docs.get(id);
  state.docs.set(id, data);
  const changed = !before || before.status !== data.status || before.completed_chunks !== data.completed_chunks;
  if (changed && before) {
    const progress = data.status === "EMBEDDING" ? ` ${data.completed_chunks}/${data.total_chunks}` : "";
    logEvent(data.status === "READY" ? "ok" : data.status === "FAILED" ? "error" : "state", `document ${id.slice(0, 8)} · ${data.status}${progress}`);
    narrateTransition(id, before, data);
  }
  return { data, changed };
}

async function hydrateStatuses() {
  for (const entry of state.library) {
    if (state.docs.has(entry.document_id)) continue;
    try { await fetchDoc(entry.document_id); } catch { state.docs.set(entry.document_id, { status: "UNKNOWN" }); }
    renderLibrary();
    if (!els.intro.hidden) updateIntroFacts();
    await sleep(160); // stays under the stage throttle of 5 requests per second
  }
}

async function startUpload(name, size, pages, request) {
  if (state.uploading) return;
  clearAlert(els.libraryError);
  state.uploading = { name, size };
  enterUploadingView(stripPdf(name), pages);
  narrate(["Signing ", { b: "POST /upload-url" }, " with SigV4. ", { b: "λ upload" }, " registers the paper and returns a 15-minute presigned S3 URL."]);
  try {
    const { data } = await request();
    logEvent("state", `registered ${data.document_id.slice(0, 8)} · S3 PUT complete in ${fmtMs(data.upload_ms)}`);
    narrate(["PDF streamed straight to ", { b: "S3" }, ` (${fmtBytes(size)} in ${fmtMs(data.upload_ms)}). The bytes never passed through API Gateway; waiting for the S3 event.`]);
    state.uploading = null;
    state.docs.set(data.document_id, data);
    await refreshLibrary();
    selectDocument(data.document_id);
  } catch (error) {
    state.uploading = null;
    showAlert(els.libraryError, error.message);
    narrate(["Upload failed: ", { b: error.message }], "error");
    selectDocument(state.current);
  }
}

function indexPaper(name) {
  const paper = paperMeta(name);
  return startUpload(name, paper?.size_bytes, paper?.pages, () => postJson("/api/sample-document", { paper: name }));
}

async function uploadFile(file) {
  clearAlert(els.libraryError);
  if (!file) return;
  if (!/\.pdf$/i.test(file.name)) return showAlert(els.libraryError, "Choose a .pdf file.");
  if (file.size === 0) return showAlert(els.libraryError, "That PDF is empty.");
  if (file.size > 10 * 1024 * 1024) return showAlert(els.libraryError, "The text-layer fallback accepts PDFs up to 10 MB.");
  if (state.uploading) return;
  els.dropzone.classList.add("is-busy");
  els.dropTitle.textContent = `Uploading ${file.name}`;
  els.dropSubtitle.textContent = `${fmtBytes(file.size)} → private S3`;
  const form = new FormData();
  form.append("file", file, file.name);
  await startUpload(file.name, file.size, null, () => api("/api/documents", { method: "POST", body: form }));
  els.dropzone.classList.remove("is-busy");
  els.dropTitle.textContent = "Upload a PDF";
  els.dropSubtitle.textContent = "Text-based paper · up to 10 MB";
  els.pdfInput.value = "";
}

async function openById(id) {
  clearAlert(els.libraryError);
  if (!isId(id)) return showAlert(els.libraryError, "Paste the 32-character document ID.");
  try {
    const { data } = await postJson("/api/library", { document_id: id });
    state.docs.set(id, data.document);
    await refreshLibrary();
    selectDocument(id);
    els.openId.value = "";
  } catch (error) { showAlert(els.libraryError, error.message); }
}

async function forget(id) {
  const pdfUrl = state.library.find((entry) => entry.document_id === id)?.pdf_url;
  if (pdfUrl && !state.papers.some((paper) => paper.url === pdfUrl)) { try { localStorage.removeItem(KEYS.cover + pdfUrl); } catch { /* ignore */ } coverMem.delete(pdfUrl); }
  try {
    await api(`/api/library/${id}`, { method: "DELETE" });
    if (state.current === id) state.current = null;
    await refreshLibrary();
    selectDocument(state.current || firstReady());
  } catch (error) { showAlert(els.libraryError, error.message); }
}
const firstReady = () => state.library.find((entry) => state.docs.get(entry.document_id)?.status === "READY")?.document_id || state.library[0]?.document_id || null;

// ── Reader, chunk map, polling ────────────────────────────────────────────────
function enterUploadingView(title, pages) {
  els.readerTitle.textContent = title;
  els.readerSub.textContent = `${pages ? `${pages} pages · ` : ""}registering with the API and streaming to S3`;
  setChip(els.docChip, "Uploading", "active");
  els.reindex.hidden = true;
  els.ingest.hidden = false;
  els.chunkmap.dataset.total = "";
  els.chunkmap.replaceChildren(...Array.from({ length: 36 }, () => h("span")));
  els.chunkmapTitle.textContent = "Chunk map · waiting for extraction";
  for (const stat of [els.statChunks, els.statMethod, els.statUpload, els.statIndexed]) stat.textContent = "—";
  els.statId.textContent = "registering…";
  setComposerEnabled(false);
  renderLibrary();
  renderTopology();
}

function selectDocument(id) {
  closeCitePop();
  if (!id) {
    state.current = null;
    openViewer(null);
    renderReader(); renderThread(); renderLibrary(); renderTopology();
    return;
  }
  const changed = state.current !== id;
  state.current = id;
  store.set(KEYS.current, id);
  if (!state.turns.has(id)) state.turns.set(id, loadTurns(id));
  renderReader();
  if (changed) {
    const entry = currentEntry();
    els.readerEmptyText.textContent = entry?.pdf_url ? "Loading the PDF…" : "No local copy of this PDF is on this machine, so the reader is off. Answers and page citations still work.";
    openViewer(entry?.pdf_url || null);
    renderThread();
    const doc = currentDoc();
    if (doc?.status === "READY" && !state.uploading) {
      narrate(["Opened ", { b: stripPdf(entry?.filename) }, `: ${doc.total_chunks} chunks indexed${entry?.pages ? ` from ${entry.pages} pages` : ""}. Ask it anything.`], "ok");
    }
  }
  renderSuggestions(); renderLibrary(); renderTopology();
  schedulePoll(0);
}

function renderChunkMap() {
  const doc = currentDoc();
  const total = Number(doc?.total_chunks || 0);
  if (!total) {
    if (els.chunkmap.dataset.total !== "0") { els.chunkmap.style.setProperty("--cols", "36"); els.chunkmap.replaceChildren(...Array.from({ length: 36 }, () => h("span"))); els.chunkmap.dataset.total = "0"; }
    els.chunkmapTitle.textContent = doc?.status === "FAILED" ? "Chunk map · no chunks" : "Chunk map · waiting for extraction";
    return;
  }
  const done = doc.status === "READY" ? total : Number(doc.completed_chunks || 0);
  const bin = Math.max(1, Math.ceil(total / 180));
  const cells = Math.ceil(total / bin);
  if (els.chunkmap.dataset.total !== String(total)) {
    els.chunkmap.style.setProperty("--cols", String(cells <= 90 ? cells : Math.ceil(cells / 2)));
    els.chunkmap.classList.toggle("is-dense", cells > 60);
    els.chunkmap.replaceChildren(...Array.from({ length: cells }, (_, i) => h("span", { "data-cell": i })));
    els.chunkmap.dataset.total = String(total);
    els.chunkmap.dataset.done = doc.status === "READY" ? String(cells) : "0";
  }
  const prevDone = Number(els.chunkmap.dataset.done || 0);
  const lit = Math.round((done / total) * cells);
  els.chunkmap.classList.toggle("is-embedding", doc.status === "EMBEDDING");
  const turn = lastTurn();
  const hits = new Map();
  const cited = new Set();
  if (turn?.ranked?.length && doc.status === "READY") {
    const scores = turn.ranked.map((c) => c.similarity_score);
    const low = Math.min(...scores), high = Math.max(...scores);
    for (const chunk of turn.ranked) {
      const cell = Math.floor(Number(chunk.chunk_index) / bin);
      hits.set(cell, Math.max(hits.get(cell) || 0, 0.35 + 0.65 * ((chunk.similarity_score - low) / ((high - low) || 1))));
    }
    const used = new Set(citedIds(turn));
    for (const source of turn.sources || []) if (used.has(source.source_id)) cited.add(Math.floor(Number(source.chunk_index) / bin));
  }
  [...els.chunkmap.children].forEach((cell, i) => {
    cell.classList.toggle("is-embedded", i < lit);
    if (i >= prevDone && i < lit) { cell.classList.remove("is-new"); void cell.offsetWidth; cell.classList.add("is-new"); }
    const hit = hits.get(i);
    cell.classList.toggle("is-hit", hit != null);
    cell.classList.toggle("is-cited", cited.has(i));
    if (hit != null) cell.style.setProperty("--alpha", hit.toFixed(2)); else cell.style.removeProperty("--alpha");
    const range = bin > 1 ? `chunks ${i * bin}–${i * bin + bin - 1}` : `chunk ${i}`;
    cell.title = hit != null ? `${range} · retrieved${cited.has(i) ? " · cited" : ""} · click to open` : range;
    cell.onclick = hit != null ? () => openChunkCell(i, bin) : null;
  });
  els.chunkmap.dataset.done = String(lit);
  els.chunkmapTitle.textContent = doc.status === "EMBEDDING" ? `Embedding · ${done} / ${total} chunks` : `Chunk map · ${total} chunks${bin > 1 ? ` (${bin} per cell)` : ""} · 256-d vectors`;
}

function openChunkCell(cell, bin) {
  const turn = lastTurn();
  if (!turn) return;
  const source = (turn.sources || []).find((s) => Math.floor(Number(s.chunk_index) / bin) === cell);
  const chunk = turn.ranked.find((c) => Math.floor(Number(c.chunk_index) / bin) === cell);
  goToPage(source?.pages?.[0] || chunk?.pages?.[0], { excerpt: source?.excerpt, label: source?.source_id || `chunk ${chunk?.chunk_index}` });
}

function renderReader() {
  const entry = currentEntry();
  const doc = currentDoc();
  const settled = ["READY", "FAILED"].includes(doc?.status);
  els.reindex.hidden = !(entry && paperMeta(entry.paper) && settled);
  els.reindex.disabled = Boolean(state.uploading) || state.asking;
  if (state.uploading) return;
  if (!state.current || !entry) {
    els.readerTitle.textContent = "No paper selected";
    els.readerSub.textContent = "Choose a paper from the library to begin.";
    setChip(els.docChip, "Idle");
    els.ingest.hidden = true;
    setComposerEnabled(false);
    return;
  }
  const status = doc?.status || "…";
  const total = Number(doc?.total_chunks || 0);
  const done = Number(doc?.completed_chunks || 0);
  const pages = entry.pages ?? paperMeta(entry.paper)?.pages;
  els.readerTitle.textContent = stripPdf(entry.filename);
  const messages = { READY: "Indexed · ask anything about it", EMBEDDING: "Titan is embedding each chunk", EXTRACTING: "Reading the PDF's pages", AWAITING_UPLOAD: "Waiting for the S3 upload event", FAILED: "Processing stopped" };
  els.readerSub.textContent = [pages ? `${pages} pages` : null, messages[status] || "Checking status…"].filter(Boolean).join(" · ");
  const chip = { READY: ["Ready", "ok"], FAILED: ["Failed", "error"], EMBEDDING: ["Indexing", "active"], EXTRACTING: ["Extracting", "active"], AWAITING_UPLOAD: ["Uploaded", "active"] }[status] || ["Checking", ""];
  setChip(els.docChip, chip[0], chip[1]);
  els.ingest.hidden = false;
  renderChunkMap();
  els.statChunks.textContent = total ? `${done} / ${total}` : "—";
  els.statMethod.textContent = doc?.extraction_method === "pypdf" ? "pypdf (Textract gated)" : doc?.extraction_method === "textract" ? "Amazon Textract" : "pending";
  els.statUpload.textContent = entry.upload_ms ? fmtMs(entry.upload_ms) : "—";
  if (doc?.created_at && doc?.updated_at) {
    const seconds = settled ? doc.updated_at - doc.created_at : Math.max(0, Math.round(Date.now() / 1000 - doc.created_at));
    els.statIndexed.textContent = status === "READY" ? `${seconds} s` : `${seconds} s…`;
  } else els.statIndexed.textContent = "—";
  els.statId.textContent = `${state.current.slice(0, 8)}…${state.current.slice(-4)}`;
  els.statId.title = `Copy ${state.current}`;
  if (status === "FAILED") showAlert(els.docError, doc.error_message || "Processing failed. Try a text-based PDF."); else clearAlert(els.docError);
  setComposerEnabled(status === "READY" && !state.asking);
}

function schedulePoll(delay = 1500) { clearTimeout(state.pollTimer); state.pollTimer = setTimeout(poll, delay); }

async function poll() {
  const watched = state.library.map((entry) => entry.document_id)
    .filter((id) => id === state.current || !["READY", "FAILED", "UNKNOWN"].includes(state.docs.get(id)?.status));
  let busy = false;
  for (const id of watched) {
    try {
      await fetchDoc(id);
      if (!["READY", "FAILED"].includes(state.docs.get(id)?.status)) busy = true;
    } catch (error) {
      if (id === state.current) { showAlert(els.docError, `Status check failed: ${error.message} Retrying…`); busy = true; }
      else state.docs.set(id, { ...(state.docs.get(id) || {}), status: "UNKNOWN" });
    }
  }
  renderReader(); renderLibrary(); renderTopology();
  if (busy) schedulePoll(1300);
}

// ── Asking ────────────────────────────────────────────────────────────────────
const CITATION = /\[((?:S\d+)(?:\s*[,;]\s*S\d+)*)\]/g;
const citedIds = (turn) => [...new Set([...String(turn?.answer || "").matchAll(CITATION)].flatMap((m) => m[1].split(/\s*[,;]\s*/)))];

function loadTurns(id) {
  const turns = store.get(KEYS.turns + id, []);
  return Array.isArray(turns) ? turns.filter((t) => t && t.question).map((t) => ({ ...t, live: false })) : [];
}
function saveTurns(id) {
  const turns = (state.turns.get(id) || []).filter((t) => t.answer).slice(-8).map(({ el: _el, live: _live, ...rest }) => rest);
  store.set(KEYS.turns + id, turns);
}

function questionsFor(entry) { return QUESTIONS[entry?.paper || entry?.filename] || DEFAULT_QUESTIONS; }

function renderSuggestions() {
  const ready = currentDoc()?.status === "READY" && !state.asking;
  els.suggestions.replaceChildren(
    ...questionsFor(currentEntry()).map((q) => h("button", { class: "suggestion", type: "button", disabled: !ready, title: q, onclick: () => ask(q), text: q })),
    h("button", { class: "suggestion is-probe", type: "button", disabled: !ready, title: "An off-topic question: a grounded system should say the paper has no evidence.", onclick: () => ask(PROBE_QUESTION), text: "Off-topic test ↯" }));
}

function setComposerEnabled(enabled) {
  els.question.disabled = !enabled;
  els.question.placeholder = enabled ? "Ask about this paper…" : state.asking ? "Waiting for the current answer…" : "Select a ready paper to ask a question";
  els.suggestions.querySelectorAll("button").forEach((button) => { button.disabled = !enabled; });
  updateSend();
}
function updateSend() {
  els.questionCount.textContent = `${els.question.value.length} / 2000`;
  els.send.disabled = els.question.disabled || !els.question.value.trim() || state.asking;
}

function renderThread() {
  const turns = state.turns.get(state.current) || [];
  els.thread.replaceChildren(els.threadEmpty);
  els.threadEmpty.hidden = turns.length > 0;
  for (const turn of turns) { turn.el = buildTurn(turn); els.thread.append(turn.el); paintTurn(turn, { animate: false }); }
  turns.at(-1)?.el.scrollIntoView({ block: "start" });
  updateConsoleStats();
}

function buildTurn(turn) {
  const steps = ["Retrieve", "Queue", "Generate", "Cite"].map((label) =>
    h("div", { class: "step" }, h("div", { class: "step-bar" }), h("div", { class: "step-label" }, h("span", { text: label }), h("span", { class: "step-time", "aria-hidden": "true" }))));
  return h("article", { class: "turn" },
    h("div", { class: "turn-q" }, h("p", { text: turn.question })),
    h("div", { class: "steps" }, steps),
    h("div", { class: "turn-body" }),
    h("div", { class: "turn-evidence" }),
    h("div", { class: "turn-followups" }),
    h("div", { class: "turn-foot" }));
}

function paintSteps(turn) {
  const steps = [...turn.el.querySelectorAll(".step")];
  const order = { retrieve: 0, queued: 1, generating: 2, done: 4 };
  const index = turn.phase === "error" ? turn.failedAt ?? 0 : order[turn.phase] ?? 4;
  const times = [turn.timings?.retrieve, turn.timings?.queue, turn.timings?.generate];
  steps.forEach((step, i) => {
    step.className = "step" + (turn.phase === "error" && i === index ? " is-error" : i < index ? " is-done" : i === index ? " is-active" : "");
    const timeEl = step.querySelector(".step-time");
    if (i === 3) timeEl.textContent = turn.sources ? `${citedIds(turn).length}/${turn.sources.length} used` : "";
    else if (times[i] != null) timeEl.textContent = fmtMs(times[i]);
    else if (i === 1 && turn.answer) { timeEl.textContent = "—"; step.title = "The worker took the job between two polls, so queue time was not measured separately."; }
    else if (i !== index || turn.phase === "error") timeEl.textContent = "";
  });
}

// One ticker drives the stopwatch of whichever step is running.
setInterval(() => {
  for (const turn of state.turns.get(state.current) || []) {
    if (!turn.live || !turn.el || !turn.stepStart) continue;
    const active = turn.el.querySelector(".step.is-active .step-time");
    if (active) active.textContent = fmtMs(performance.now() - turn.stepStart);
  }
}, 100);

function paintTurn(turn, { animate = true } = {}) {
  paintSteps(turn);
  const body = turn.el.querySelector(".turn-body");
  const evidence = turn.el.querySelector(".turn-evidence");
  const followups = turn.el.querySelector(".turn-followups");
  const foot = turn.el.querySelector(".turn-foot");
  if (turn.phase === "error") body.replaceChildren(h("p", { class: "turn-error", text: turn.error }));
  else if (turn.answer) {
    if (!body.dataset.rendered) {
      const container = h("div", { class: "answer" });
      renderAnswer(container, turn.answer, turn);
      if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) revealWords(container);
      body.replaceChildren(container);
      body.dataset.rendered = "1";
    }
  } else body.replaceChildren(h("div", { class: "skeleton", "aria-label": "Waiting for the answer" }, h("span"), h("span"), h("span")));
  if (turn.ranked?.length) evidence.replaceChildren(buildEvidence(turn));
  followups.replaceChildren();
  if (turn.answer && turn === lastTurn()) {
    const asked = new Set((state.turns.get(state.current) || []).map((t) => t.question));
    const next = questionsFor(currentEntry()).filter((q) => !asked.has(q)).slice(0, 2);
    if (next.length) followups.append(h("div", { class: "followups" }, h("span", { text: "Ask next" }),
      ...next.map((q) => h("button", { class: "suggestion", type: "button", disabled: state.asking, onclick: () => ask(q), text: q }))));
  }
  foot.replaceChildren();
  if (turn.answer) {
    foot.append(
      h("span", {}, "model ", h("b", { text: (turn.modelId || "Nova 2 Lite").replace(/^us\./, "") })),
      h("span", {}, "total ", h("b", { text: fmtMs(turn.timings?.total) })),
      turn.jobId ? h("span", {}, "job ", h("b", { text: turn.jobId.slice(0, 8) })) : null,
      h("button", { type: "button", onclick: (event) => copyText(turn.answer, event.currentTarget), text: "Copy answer" }));
  }
}

function revealWords(container) {
  let index = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest(".cite")) continue;
    const frag = document.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.append(part); continue; }
      frag.append(h("span", { class: "w", style: `animation-delay:${Math.min(index * 16, 1500)}ms`, text: part }));
      index += 1;
    }
    node.replaceWith(frag);
  }
}

function buildEvidence(turn) {
  const entry = currentEntry();
  const ranked = turn.ranked;
  const usedIds = new Set(citedIds(turn));
  const cited = new Set((turn.sources || []).filter((s) => usedIds.has(s.source_id)).flatMap((s) => s.pages || []));
  const maxPage = Math.max(1, ...ranked.flatMap((c) => c.pages || []), ...(turn.sources || []).flatMap((s) => s.pages || []));
  const pages = Math.max(entry?.pages || paperMeta(entry?.paper)?.pages || 0, maxPage);
  const scores = ranked.map((c) => c.similarity_score);
  const low = Math.min(...scores), high = Math.max(...scores);
  const perPage = new Map();
  for (const chunk of ranked) for (const page of chunk.pages || []) perPage.set(page, Math.max(perPage.get(page) || 0, chunk.similarity_score));
  const binSize = Math.ceil(pages / 60);
  const bins = Math.ceil(pages / binSize);
  const ribbon = h("div", { class: "ribbon", role: "group", "aria-label": "Relevance of each page to the question" });
  for (let b = 0; b < bins; b += 1) {
    const first = b * binSize + 1;
    const last = Math.min(pages, first + binSize - 1);
    let best = 0, isCited = false;
    for (let page = first; page <= last; page += 1) { best = Math.max(best, perPage.get(page) || 0); isCited ||= cited.has(page); }
    const label = first === last ? `Page ${first}` : `Pages ${first}–${last}`;
    const button = h("button", {
      type: "button", class: `${best ? "is-hit" : ""}${isCited ? " is-cited" : ""}`,
      title: best ? `${label} · best similarity ${best.toFixed(3)}${isCited ? " · cited" : ""}` : `${label} · not in top ${ranked.length}`,
      "aria-label": best ? `${label}, similarity ${best.toFixed(2)}` : label,
      onclick: () => {
        const source = (turn.sources || []).find((s) => (s.pages || []).some((p) => p >= first && p <= last));
        goToPage(first, source ? { excerpt: source.excerpt, label: source.source_id } : {});
      },
    });
    if (best) button.style.setProperty("--alpha", (0.28 + 0.72 * ((best - low) / ((high - low) || 1))).toFixed(2));
    ribbon.append(button);
  }
  const sources = (turn.sources || []).map((source, i) => buildSource(source, i, high, usedIds));
  return h("div", { class: "evidence" },
    h("div", { class: "evidence-head" }, h("h3", { text: "Where the evidence is" }), h("span", { text: `top ${ranked.length}${turn.totalChunks ? ` of ${turn.totalChunks}` : ""} chunks · best ${high.toFixed(3)}` })),
    turn.answer && !usedIds.size ? h("p", { class: "evidence-note", text: "The answer cites none of these passages, which is the expected behaviour when the paper holds no evidence for the question." }) : null,
    ribbon,
    h("div", { class: "ribbon-axis" }, h("span", { text: "p. 1" }), h("span", { text: "● cited by the answer" }), h("span", { text: `p. ${pages}` })),
    sources.length ? h("div", { class: "sources" }, sources) : null);
}

function buildSource(source, index, best, usedIds) {
  const id = source.source_id || `S${index + 1}`;
  const used = usedIds.has(id);
  const pages = (source.pages || []).filter((page) => Number(page) > 0);
  const score = Number(source.similarity_score || 0);
  const bar = h("i");
  bar.style.setProperty("--score", `${Math.round((score / (best || 1)) * 100)}%`);
  return h("details", { class: `source${used ? "" : " is-uncited"}`, "data-source": id },
    h("summary", {},
      h("span", { class: "source-id", text: id }),
      h("span", { class: "source-meta", text: `${pages.length ? `p. ${pages.join(", ")}` : "page unknown"} · chunk ${source.chunk_index ?? "?"}${used ? "" : " · retrieved, not cited"}` }),
      h("span", { class: "source-score", title: "Cosine similarity to the question" }, bar, score ? score.toFixed(3) : "")),
    h("div", { class: "source-body" },
      h("p", { text: source.excerpt || source.text || "No passage text returned." }),
      pages.length ? h("button", { class: "source-jump", type: "button", onclick: () => goToPage(pages[0], { excerpt: source.excerpt, label: id }), text: `Highlight it on page ${pages[0]} →` }) : null));
}

function renderAnswer(container, text, turn) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  let list = null;
  let paragraph = [];
  const flush = () => { if (!paragraph.length) return; const p = h("p"); appendInline(p, paragraph.join(" "), turn); container.append(p); paragraph = []; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); list = null; continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (heading) { flush(); list = null; const h4 = h("h4"); appendInline(h4, heading[1], turn); container.append(h4); continue; }
    if (bullet || ordered) {
      flush();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); container.append(list); }
      const li = h("li"); appendInline(li, (bullet || ordered)[1], turn); list.append(li);
      continue;
    }
    list = null;
    paragraph.push(line);
  }
  flush();
}

function appendInline(target, text, turn) {
  const pattern = new RegExp(`\\*\\*(.+?)\\*\\*|${CITATION.source}`, "g");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) target.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1]) target.append(h("strong", { text: match[1] }));
    else for (const id of match[2].split(/\s*[,;]\s*/)) target.append(citeChip(id, turn));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
}

function citeChip(id, turn) {
  const source = (turn.sources || []).find((item) => item.source_id === id);
  const chip = h("button", { class: "cite", type: "button", text: id, "aria-label": source ? `Source ${id}, page ${(source.pages || []).join(", ")}` : `Source ${id}` });
  const show = () => showCitePop(chip, id, source);
  chip.addEventListener("mouseenter", show);
  chip.addEventListener("focus", show);
  chip.addEventListener("mouseleave", closeCitePop);
  chip.addEventListener("blur", closeCitePop);
  chip.addEventListener("click", () => {
    if (source?.pages?.[0]) goToPage(source.pages[0], { excerpt: source.excerpt, label: id });
    const card = turn.el?.querySelector(`.source[data-source="${id}"]`);
    if (card) {
      card.open = true; card.classList.remove("is-flash"); void card.offsetWidth; card.classList.add("is-flash");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setTimeout(() => card.classList.remove("is-flash"), 1800);
    }
  });
  return chip;
}

function showCitePop(anchor, id, source) {
  if (!source) return;
  const excerpt = String(source.excerpt || "").replace(/\s+/g, " ").trim();
  els.citePop.replaceChildren(
    h("strong", { text: `${id} · page ${(source.pages || []).join(", ") || "?"} · cosine ${Number(source.similarity_score || 0).toFixed(3)}` }),
    h("p", { text: excerpt.length > 240 ? `${excerpt.slice(0, 240)}…` : excerpt }),
    h("small", { text: "Click to highlight it in the paper" }));
  els.citePop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = els.citePop.offsetWidth, height = els.citePop.offsetHeight;
  els.citePop.style.left = `${Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)}px`;
  els.citePop.style.top = `${rect.top - height - 10 > 8 ? rect.top - height - 10 : rect.bottom + 10}px`;
}
function closeCitePop() { els.citePop.hidden = true; }

function updateConsoleStats() {
  const all = [...state.turns.values()].flat().filter((t) => t.answer && t.timings?.total);
  if (!all.length) { els.consoleStats.textContent = ""; return; }
  const avg = (key) => { const v = all.map((t) => t.timings[key]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  els.consoleStats.textContent = `${all.length} answer${all.length === 1 ? "" : "s"} · retrieve ≈ ${fmtMs(avg("retrieve"))} · end to end ≈ ${fmtMs(avg("total"))}`;
}

async function ask(rawQuestion) {
  const question = String(rawQuestion || "").trim();
  const documentId = state.current;
  if (!question || state.asking || currentDoc()?.status !== "READY") return;
  state.asking = true;
  els.question.value = "";
  els.question.style.height = "auto";
  renderReader(); renderSuggestions();
  const total = Number(currentDoc()?.total_chunks) || null;
  const turn = { question, phase: "retrieve", live: true, timings: {}, at: Date.now(), totalChunks: total, stepStart: performance.now() };
  const turns = state.turns.get(documentId) || [];
  turns.push(turn);
  state.turns.set(documentId, turns);
  els.threadEmpty.hidden = true;
  // Earlier turns lose their follow-up chips; only the newest answer offers them.
  turns.slice(0, -1).forEach((t) => t.el?.querySelector(".turn-followups")?.replaceChildren());
  turn.el = buildTurn(turn);
  els.thread.append(turn.el);
  paintTurn(turn);
  turn.el.scrollIntoView({ block: "end", behavior: "smooth" });
  renderTopology();
  narrate(["Signing ", { b: "POST /query" }, ". ", { b: "λ query" }, " embeds the question with Titan and scores ", { b: `${total ?? "all"} chunks` }, " by cosine similarity."]);
  const started = performance.now();
  const visible = () => state.current === documentId;
  const update = () => { if (visible()) { paintTurn(turn); renderTopology(); renderChunkMap(); } };
  try {
    const body = { question, document_ids: [documentId] };
    const retrieved = await postJson("/api/query", { ...body, top_k: 10 });
    turn.timings.retrieve = retrieved.ms;
    turn.ranked = (retrieved.data.top_chunks || []).map(({ pages, similarity_score, chunk_index }) => ({ pages, similarity_score, chunk_index }));
    const best = turn.ranked[0];
    logEvent("state", `retrieved ${turn.ranked.length} chunks · best cosine ${best ? best.similarity_score.toFixed(3) : "—"}`);
    if (visible() && best) narrate(["Best match on ", { b: `page ${best.pages?.[0] ?? "?"}` }, ` (cosine ${best.similarity_score.toFixed(3)}). Top ${turn.ranked.length} passages ranked in ${fmtMs(retrieved.ms)}. Queueing the answer…`]);
    turn.phase = "queued";
    turn.stepStart = performance.now();
    update();
    const queuedAt = performance.now();
    const queued = await postJson("/api/answers", { ...body, top_k: 5 });
    turn.jobId = queued.data.job_id;
    if (!turn.jobId) throw new Error("The server did not return an answer job ID.");
    logEvent("state", `job ${turn.jobId.slice(0, 8)} · QUEUED (HTTP 202)`);
    if (visible()) narrate([{ b: "λ answer" }, " stored the job and returned ", { b: "HTTP 202" }, ". It is waiting in ", { b: "Amazon SQS" }, " for a worker."]);
    update();
    let generatingAt = null;
    let pollErrors = 0;
    const deadline = performance.now() + 6 * 60 * 1000;
    for (;;) {
      await sleep(700);
      if (performance.now() > deadline) throw Object.assign(new Error(`No answer after 6 minutes. Job ${turn.jobId.slice(0, 8)} may still finish; ask again later.`), { failedAt: generatingAt ? 2 : 1 });
      let data;
      try { ({ data } = await api(`/api/answers/${turn.jobId}`, {}, { quiet: true })); pollErrors = 0; } catch (error) {
        pollErrors += 1; // one dropped poll (Wi-Fi, a 429 throttle) does not mean the job failed
        if (pollErrors >= 3) throw Object.assign(error, { failedAt: generatingAt ? 2 : 1 });
        continue;
      }
      const status = String(data.status || "QUEUED").toUpperCase();
      if (status === "GENERATING" && !generatingAt) {
        generatingAt = performance.now();
        turn.timings.queue = generatingAt - queuedAt;
        turn.phase = "generating";
        turn.stepStart = generatingAt;
        logEvent("state", `job ${turn.jobId.slice(0, 8)} · GENERATING`);
        if (visible()) narrate([{ b: "λ worker" }, ` picked the job up after ${fmtMs(turn.timings.queue)}, re-read the passages from DynamoDB and is prompting `, { b: "Nova 2 Lite" }, "."]);
        update();
      }
      if (status === "COMPLETED" && !data.answer) throw Object.assign(new Error("The job completed without an answer."), { failedAt: 2 });
      if (status === "COMPLETED") {
        const finished = performance.now();
        if (!generatingAt) turn.timings.queue = null;
        turn.timings.generate = finished - (generatingAt ?? queuedAt);
        turn.timings.total = finished - started;
        turn.answer = data.answer;
        turn.sources = data.sources || [];
        turn.modelId = data.model_id;
        turn.phase = "done";
        turn.live = false;
        logEvent("ok", `job ${turn.jobId.slice(0, 8)} · COMPLETED · ${turn.sources.length} sources`, turn.timings.total);
        break;
      }
      if (status === "FAILED") throw Object.assign(new Error(data.error_message || "The answer job failed."), { failedAt: 2 });
    }
    saveTurns(documentId);
    const ids = citedIds(turn);
    const citedPages = [...new Set(turn.sources.filter((s) => ids.includes(s.source_id)).flatMap((s) => s.pages || []))].sort((a, b) => a - b);
    if (visible()) {
      narrate(citedPages.length
        ? ["Nova answered, citing ", { b: `page${citedPages.length > 1 ? "s" : ""} ${citedPages.join(", ")}` }, ". ", { b: `Total ${fmtMs(turn.timings.total)}` }, ". The cited passage is highlighted in the paper."]
        : ["Nova found no supporting passage and declined to answer from outside the paper. ", { b: `Total ${fmtMs(turn.timings.total)}` }, "."], "ok");
      toast("Answer ready", `${fmtMs(turn.timings.total)} · ${citedPages.length ? `cited p. ${citedPages.join(", ")}` : "no passage cited"}`, "ok");
    }
  } catch (error) {
    turn.phase = "error";
    turn.live = false;
    turn.failedAt = error.failedAt ?? (turn.ranked ? 1 : 0);
    turn.error = error.message;
    if (visible()) { narrate(["The question failed: ", { b: error.message }], "error"); toast("Question failed", error.message, "error"); }
  } finally {
    state.asking = false;
    update();
    renderReader(); renderSuggestions(); updateConsoleStats();
    if (visible()) {
      const first = (turn.sources || []).find((s) => s.source_id === citedIds(turn)[0]);
      if (first?.pages?.[0]) goToPage(first.pages[0], { excerpt: first.excerpt, label: first.source_id });
      turn.el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
}

// ── Command palette ───────────────────────────────────────────────────────────
const palette = { items: [], active: 0 };
function paletteItems(query) {
  const q = query.trim().toLowerCase();
  const ready = currentDoc()?.status === "READY" && !state.asking;
  const items = [];
  const add = (group, icon, text, hint, run) => items.push({ group, icon, text, hint, run });
  for (const paper of state.papers) {
    const entry = entryForPaper(paper.name);
    const doc = entry ? state.docs.get(entry.document_id) : null;
    add("Papers", "book", paper.title, doc?.status === "READY" ? `${doc.total_chunks} chunks` : entry ? docStateLabel(doc).text : "index", () => (entry && doc?.status !== "FAILED" ? selectDocument(entry.document_id) : indexPaper(paper.name)));
  }
  if (ready) for (const question of questionsFor(currentEntry())) add("Ask this paper", "ask", question, "↵ ask", () => ask(question));
  if (ready) add("Ask this paper", "bolt", "Off-topic test: Who won the 2022 FIFA World Cup?", "grounding", () => ask(PROBE_QUESTION));
  const entry = currentEntry();
  if (entry && paperMeta(entry.paper) && !state.uploading) add("Actions", "refresh", `Re-index “${stripPdf(entry.filename)}” live`, "upload again", () => indexPaper(entry.paper));
  add("Actions", "layout", "Architecture: full / compact / hidden", "A", cycleArch);
  add("Actions", "terminal", "Toggle event stream", "`", toggleConsole);
  add("Actions", "moon", "Toggle light or dark theme", "T", toggleTheme);
  add("Actions", "play", "Replay the intro", "", showIntro);
  if (state.current) add("Actions", "copy", "Copy document ID", state.current.slice(0, 8), () => copyText(state.current, null));
  for (const id of Object.keys(NODE_INFO)) add("AWS services", nodeById(id).icon, NODE_INFO[id].title, nodeById(id).title, () => { if (els.app.dataset.arch === "hidden") setArchMode("full"); requestAnimationFrame(() => openNodeCard(id)); });
  let filtered = q ? items.filter((item) => `${item.text} ${item.group} ${item.hint}`.toLowerCase().includes(q)) : items.filter((item) => item.group !== "AWS services");
  if (q && ready && query.trim().length > 3) {
    const askItem = { group: "Ask this paper", icon: "ask", text: `Ask: “${query.trim()}”`, hint: "↵ ask", run: () => ask(query.trim()) };
    // A question-like query goes first; a short keyword search shows matches first.
    filtered = query.trim().includes(" ") || !filtered.length ? [askItem, ...filtered] : [...filtered, askItem];
  }
  return filtered.slice(0, 40);
}

function renderPalette() {
  const items = paletteItems(els.paletteInput.value);
  palette.items = items;
  palette.active = Math.min(palette.active, Math.max(0, items.length - 1));
  if (!items.length) { els.paletteList.replaceChildren(h("li", { class: "palette-empty", text: "Nothing matches. Try a paper title or a service name." })); return; }
  const nodes = [];
  let group = null;
  items.forEach((item, i) => {
    if (item.group !== group) { group = item.group; nodes.push(h("li", { class: "palette-group", role: "presentation", text: group })); }
    const iconWrap = h("span", { class: "pi-icon" });
    iconWrap.append(iconSvg(item.icon, ""));
    nodes.push(h("li", { class: `palette-item${i === palette.active ? " is-active" : ""}`, role: "option", "aria-selected": String(i === palette.active), "data-index": i,
      onmousemove: () => { if (palette.active !== i) { palette.active = i; highlightPalette(); } },
      onclick: () => runPalette(i) }, iconWrap, h("span", { class: "pi-text", text: item.text }), h("span", { class: "pi-hint", text: item.hint || "" })));
  });
  els.paletteList.replaceChildren(...nodes);
}
function highlightPalette() {
  els.paletteList.querySelectorAll(".palette-item").forEach((node) => {
    const on = Number(node.dataset.index) === palette.active;
    node.classList.toggle("is-active", on); node.setAttribute("aria-selected", String(on));
    if (on) node.scrollIntoView({ block: "nearest" });
  });
}
let paletteReturn = null;
function openPalette() {
  if (!els.palette.hidden || !els.intro.hidden) return;
  paletteReturn = document.activeElement;
  els.palette.hidden = false; els.app.inert = true;
  els.paletteInput.value = ""; palette.active = 0; renderPalette(); els.paletteInput.focus();
}
function closePalette() {
  if (els.palette.hidden) return;
  els.palette.hidden = true; els.app.inert = false;
  if (paletteReturn?.isConnected) paletteReturn.focus();
}
function runPalette(i) { const item = palette.items[i]; closePalette(); item?.run(); }

// ── Intro ─────────────────────────────────────────────────────────────────────
function buildIntro() {
  const root = els.introLines;
  root.replaceChildren();
  const labels = ["Browser", "API Gateway", "Lambda", "S3", "DynamoDB", "SQS", "Bedrock"];
  const icons = ["browser", "gateway", "lambda", "bucket", "database", "queue", "sparkle"];
  const kinds = ["client", "network", "compute", "storage", "database", "integration", "ai"];
  const xs = labels.map((_, i) => 60 + i * 130);
  const path = `M ${xs[0]} 92 ` + xs.slice(1).map((x, i) => `C ${xs[i] + 65} ${i % 2 ? 40 : 144}, ${x - 65} ${i % 2 ? 40 : 144}, ${x} 92`).join(" ");
  root.append(svg("path", { class: "il-edge", d: path, style: "animation-delay:.15s" }));
  labels.forEach((label, i) => {
    const g = svg("g", { "data-kind": kinds[i] });
    g.append(svg("rect", { class: "il-node", x: xs[i] - 26, y: 66, width: 52, height: 52, rx: 14, style: `animation-delay:${0.2 + i * 0.12}s` }));
    const icon = iconSvg(icons[i]);
    icon.setAttribute("x", xs[i] - 11); icon.setAttribute("y", 81); icon.setAttribute("width", 22); icon.setAttribute("height", 22);
    icon.classList.add("il-dot"); icon.setAttribute("style", `animation-delay:${0.3 + i * 0.12}s`);
    g.append(icon, svg("text", { class: "il-label", x: xs[i], y: 142, "text-anchor": "middle", style: `animation-delay:${0.45 + i * 0.12}s` }, label));
    root.append(g);
  });
  [0, 0.9, 1.8].forEach((delay) => root.append(svg("circle", { class: "il-packet", r: 3.2, visibility: "hidden" },
    svg("set", { attributeName: "visibility", to: "visible", begin: `${1.4 + delay}s` }),
    svg("animateMotion", { dur: "2.7s", begin: `${1.4 + delay}s`, repeatCount: "indefinite", path }))));
}

function updateIntroFacts() {
  const readyPapers = state.papers.filter((paper) => { const e = entryForPaper(paper.name); return e && state.docs.get(e.document_id)?.status === "READY"; });
  const chunks = readyPapers.reduce((sum, paper) => sum + Number(state.docs.get(entryForPaper(paper.name).document_id).total_chunks || 0), 0);
  // Counts appear only once every document's status has loaded, so a partial number never shows.
  const loaded = state.hydrated;
  els.introFacts.replaceChildren(
    h("li", {}, h("b", { text: loaded ? String(readyPapers.length) : "…" }), readyPapers.length === 1 ? "paper indexed live" : "papers indexed live"),
    h("li", {}, h("b", { text: loaded ? String(chunks) : "…" }), "chunks with 256-d vectors"),
    h("li", {}, h("b", { text: "16" }), "AWS components"),
    h("li", {}, h("b", { text: state.health?.region || "…" }), state.health?.ok ? "signed in" : "region"));
}

function showIntro() { closePalette(); buildIntro(); updateIntroFacts(); els.intro.classList.remove("is-leaving"); els.intro.hidden = false; els.app.inert = true; els.introEnter.focus(); }
function hideIntro() {
  if (els.intro.hidden) return;
  try { sessionStorage.setItem("folio.intro", "1"); } catch { /* ignore */ }
  els.intro.classList.add("is-leaving");
  els.app.inert = false;
  els.app.classList.add("is-entering");
  setTimeout(() => { els.intro.hidden = true; els.intro.classList.remove("is-leaving"); layoutPages(); }, 560);
  setTimeout(() => els.app.classList.remove("is-entering"), 1400);
}

// ── Small UI pieces ───────────────────────────────────────────────────────────
function setChip(target, label, tone = "") { target.textContent = label; target.className = `chip${tone ? ` is-${tone}` : ""}`; }
function showAlert(target, message) { target.textContent = message; target.hidden = false; }
function clearAlert(target) { target.textContent = ""; target.hidden = true; }
async function copyText(value, button, restore) {
  const original = button?.textContent;
  try { await navigator.clipboard.writeText(value); if (button) button.textContent = "Copied"; else toast("Copied", value.slice(0, 40)); } catch { if (button) button.textContent = "Copy failed"; }
  if (button) setTimeout(() => { if (restore) restore(); else button.textContent = original; }, 1500);
}
function setTheme(theme) { document.documentElement.dataset.theme = theme; store.set(KEYS.theme, theme); }
function toggleTheme() { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); }
function setConsole(open) {
  els.consoleLog.hidden = !open;
  els.consoleBar.setAttribute("aria-expanded", String(open));
  $("console-toggle").setAttribute("aria-pressed", String(open));
  if (open) els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
  store.set(KEYS.console, open);
  requestAnimationFrame(() => layoutPages());
}
function toggleConsole() { setConsole(els.consoleLog.hidden); }

// ── Wiring ────────────────────────────────────────────────────────────────────
function wire() {
  $("theme-toggle").addEventListener("click", toggleTheme);
  $("topology-toggle").addEventListener("click", cycleArch);
  document.querySelectorAll(".seg button").forEach((button) => button.addEventListener("click", () => setArchMode(button.dataset.mode)));
  $("console-toggle").addEventListener("click", toggleConsole);
  els.consoleBar.addEventListener("click", toggleConsole);
  $("node-card-close").addEventListener("click", closeNodeCard);
  $("palette-trigger").addEventListener("click", openPalette);
  els.introEnter.addEventListener("click", hideIntro);
  els.palette.addEventListener("click", (event) => { if (event.target === els.palette) closePalette(); });
  els.paletteInput.addEventListener("input", () => { palette.active = 0; renderPalette(); });
  els.paletteInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); palette.active = Math.min(palette.items.length - 1, palette.active + 1); highlightPalette(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); palette.active = Math.max(0, palette.active - 1); highlightPalette(); }
    else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); runPalette(palette.active); }
    else if (event.key === "Tab") event.preventDefault(); // keep focus inside the palette
  });
  document.addEventListener("click", (event) => { if (!els.nodeCard.hidden && !els.nodeCard.contains(event.target)) closeNodeCard(); });
  els.pdfInput.addEventListener("change", () => uploadFile(els.pdfInput.files?.[0]));
  els.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); els.dropzone.classList.add("is-dragging"); });
  els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("is-dragging"));
  els.dropzone.addEventListener("drop", (event) => { event.preventDefault(); els.dropzone.classList.remove("is-dragging"); uploadFile(event.dataTransfer?.files?.[0]); });
  els.openForm.addEventListener("submit", (event) => { event.preventDefault(); openById(els.openId.value.trim().toLowerCase()); });
  els.statId.addEventListener("click", () => state.current && copyText(state.current, els.statId, renderReader));
  els.reindex.addEventListener("click", () => { const paper = currentEntry()?.paper; if (paper) indexPaper(paper); });
  els.question.addEventListener("input", () => { updateSend(); els.question.style.height = "auto"; els.question.style.height = `${Math.min(els.question.scrollHeight, 140)}px`; });
  els.question.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(els.question.value); } });
  els.composer.addEventListener("submit", (event) => { event.preventDefault(); ask(els.question.value); });
  els.thread.addEventListener("scroll", closeCitePop, { passive: true });
  let scrollFrame = 0;
  els.pages.addEventListener("scroll", () => { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(updateCurrentPage); }, { passive: true });
  $("zoom-in").addEventListener("click", () => { viewer.zoom = Math.min(2.2, viewer.zoom + 0.2); layoutPages(); });
  $("zoom-out").addEventListener("click", () => { viewer.zoom = Math.max(0.5, viewer.zoom - 0.2); layoutPages(); });
  $("zoom-fit").addEventListener("click", () => { viewer.zoom = 1; layoutPages(); });
  let resizeTimer = 0;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layoutPages, 120); }).observe(els.pages);
  document.addEventListener("keydown", (event) => {
    if (!els.intro.hidden) {
      if (event.key === "Enter" || event.key === " " || event.key === "Escape") { event.preventDefault(); hideIntro(); }
      return; // nothing else (including ⌘K) acts behind the intro
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (els.palette.hidden) openPalette(); else closePalette(); return; }
    if (event.key === "Escape") { if (!els.palette.hidden) closePalette(); closeNodeCard(); closeCitePop(); return; }
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (typing || event.metaKey || event.ctrlKey || event.altKey || !els.palette.hidden) return;
    if (event.key === "/") { event.preventDefault(); els.question.focus(); }
    else if (event.key === "`") toggleConsole();
    else if (event.key.toLowerCase() === "t") toggleTheme();
    else if (event.key.toLowerCase() === "a") cycleArch();
  });
}

async function initialize() {
  setTheme(store.get(KEYS.theme, "dark") === "light" ? "light" : "dark");
  buildTopology();
  wire();
  setArchMode(store.get(KEYS.arch, window.innerHeight < 820 ? "compact" : "full"));
  setConsole(store.get(KEYS.console, false) === true);
  renderTopology();
  setComposerEnabled(false);
  let introSeen = false;
  try { introSeen = sessionStorage.getItem("folio.intro") === "1"; } catch { /* ignore */ }
  if (!introSeen && !new URLSearchParams(location.search).has("nointro")) showIntro();
  try {
    const [{ data: health }, { data: catalog }] = await Promise.all([api("/api/health"), api("/api/papers")]);
    state.health = health;
    state.papers = (catalog.papers || []).sort((a, b) => (b.name === catalog.default) - (a.name === catalog.default) || (a.pages ?? 999) - (b.pages ?? 999));
    els.metaRegion.textContent = health.region || "—";
    const apiMatch = String(health.api_url || "").match(/^https:\/\/([^.]+)\.execute-api\.[^/]+(\/.*)$/);
    els.metaApi.textContent = apiMatch ? `${apiMatch[1]} · ${apiMatch[2]}` : health.api_url || "—";
    els.metaApi.title = health.api_url || "";
    els.livePill.classList.add(health.ok ? "is-online" : "is-offline");
    els.liveText.textContent = health.ok ? `AWS live · ${health.region}` : "No AWS credentials";
    if (!health.ok) showAlert(els.libraryError, "The server has no AWS credentials. Run `aws login --profile ucs531-demo` and restart it.");
    logEvent("ok", `connected · API ${apiMatch ? apiMatch[1] : "?"} in ${health.region}`);
    narrate(["Connected to the deployed API in ", { b: health.region || "AWS" }, ". Every request from here is signed with SigV4 by the local server."], "ok");
    updateIntroFacts();
  } catch (error) {
    els.livePill.classList.add("is-offline");
    els.liveText.textContent = "Server offline";
    showAlert(els.libraryError, error.message);
    narrate(["The local server is offline: ", { b: error.message }], "error");
    return;
  }
  await refreshLibrary();
  const saved = store.get(KEYS.current);
  if (state.library.some((entry) => entry.document_id === saved)) selectDocument(saved);
  await hydrateStatuses();
  state.hydrated = true;
  updateIntroFacts();
  if (!state.current && !state.uploading) selectDocument(firstReady());
  renderReader();
}

initialize();
