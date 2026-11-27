"use strict";

/* Folio front end. Every visual state comes from the local demo server, which signs requests
   to the deployed AWS API. Nothing here holds AWS credentials or invents pipeline progress. */

// ── Tiny DOM helpers ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
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

const fmtMs = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
const fmtBytes = (bytes) => (bytes == null ? "" : bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const stripPdf = (name) => String(name || "Research paper").replace(/\.pdf$/i, "");
const isId = (value) => /^[0-9a-f]{32}$/.test(value || "");
const clock = () => new Date().toLocaleTimeString([], { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0");

// ── Content ────────────────────────────────────────────────────────────────────
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

const NODES = [
  { id: "client", kind: "client", x: 70, y: 131, h: 172, title: "Operator", sub: "browser + signer" },
  { id: "apigw", kind: "network", x: 218, y: 131, h: 172, title: "API Gateway", sub: "REST · AWS_IAM" },
  { id: "upload", kind: "compute", x: 372, y: 72, title: "λ upload-url", sub: "presign PUT" },
  { id: "s3", kind: "storage", x: 537, y: 72, title: "Amazon S3", sub: "private bucket" },
  { id: "process", kind: "compute", x: 702, y: 72, title: "λ process", sub: "S3 event" },
  { id: "extract", kind: "ai", x: 867, y: 72, title: "Extract text", sub: "Textract→pypdf" },
  { id: "chunks", kind: "database", x: 1032, y: 72, title: "DynamoDB", sub: "chunks table" },
  { id: "embed", kind: "compute", x: 1197, y: 72, title: "λ embed", sub: "Streams trigger" },
  { id: "titan", kind: "ai", x: 1362, y: 72, title: "Titan V2", sub: "256-d vectors" },
  { id: "query", kind: "compute", x: 372, y: 190, title: "λ query", sub: "POST /query" },
  { id: "qtitan", kind: "ai", x: 537, y: 190, title: "Titan V2", sub: "embed question" },
  { id: "rank", kind: "database", x: 702, y: 190, title: "Cosine top-k", sub: "exact search" },
  { id: "answer", kind: "compute", x: 867, y: 190, title: "λ answer", sub: "202 + job id" },
  { id: "sqs", kind: "integration", x: 1032, y: 190, title: "Amazon SQS", sub: "answer queue" },
  { id: "worker", kind: "compute", x: 1197, y: 190, title: "λ worker", sub: "prompt + cite" },
  { id: "nova", kind: "ai", x: 1362, y: 190, title: "Nova 2 Lite", sub: "Bedrock Converse" },
];
const NODE_W = 126;
const NODE_H = 54;
const node = (id) => NODES.find((item) => item.id === id);

const EDGES = [
  ["c-gw-i", "client", "apigw", 72], ["c-gw-a", "client", "apigw", 190],
  ["gw-up", "apigw", "upload", 72], ["up-s3", "upload", "s3", 72], ["s3-pr", "s3", "process", 72],
  ["pr-ex", "process", "extract", 72], ["ex-ch", "extract", "chunks", 72], ["ch-em", "chunks", "embed", 72],
  ["em-ti", "embed", "titan", 72],
  ["gw-q", "apigw", "query", 190], ["q-qt", "query", "qtitan", 190], ["qt-rk", "qtitan", "rank", 190],
  ["rk-an", "rank", "answer", 190], ["an-sq", "answer", "sqs", 190], ["sq-wk", "sqs", "worker", 190],
  ["wk-nv", "worker", "nova", 190],
];

const INGEST_STEPS = [
  { nodes: ["client", "apigw", "upload"], edges: ["c-gw-i", "gw-up"] },
  { nodes: ["s3"], edges: ["arc", "up-s3"] },
  { nodes: ["process"], edges: ["s3-pr"] },
  { nodes: ["extract"], edges: ["pr-ex"] },
  { nodes: ["chunks", "embed", "titan"], edges: ["ex-ch", "ch-em", "em-ti"] },
];
const ASK_STEPS = [
  { nodes: ["client", "apigw", "query", "qtitan", "rank"], edges: ["c-gw-a", "gw-q", "q-qt", "qt-rk"] },
  { nodes: ["answer", "sqs"], edges: ["rk-an", "an-sq"] },
  { nodes: ["worker", "nova"], edges: ["sq-wk", "wk-nv"] },
];

const NODE_INFO = {
  client: {
    kind: "Client · demo_ui", title: "Operator browser and local signer",
    body: "This page talks only to a Python server on 127.0.0.1. That server uses RagClient to sign every API call with AWS SigV4, so no AWS credentials ever reach JavaScript.",
    facts: [["Signing", "SigV4 · execute-api"], ["Bind", "localhost only"], ["Writes", "same-origin checked"]],
  },
  apigw: {
    kind: "Networking", title: "Amazon API Gateway (REST)",
    body: "Every route requires IAM authorisation, and a resource policy denies callers from any other AWS account. Stage-wide throttling protects the Lambdas and the bill.",
    facts: [["Auth", "AWS_IAM"], ["Throttle", "5 rps · burst 10"], ["Stage", "dev · REGIONAL"], ["Routes", "/upload-url /documents /query /answer"]],
  },
  upload: {
    kind: "Compute · get_presigned_url", title: "Register the document",
    body: "Validates the filename and size, records the document as AWAITING_UPLOAD in DynamoDB and returns a 15-minute presigned S3 PUT, so the PDF bytes never pass through the API.",
    facts: [["Runtime", "Python 3.12 · 512 MB"], ["Timeout", "20 s"], ["Max PDF", "25 MiB"], ["URL lifetime", "900 s"]],
  },
  s3: {
    kind: "Storage", title: "Amazon S3 · private document bucket",
    body: "Encrypted, versioned and closed to the public, with a TLS-only bucket policy. The ObjectCreated event on the exact object version starts processing.",
    facts: [["Encryption", "SSE-S3 (AES-256)"], ["Versioning", "enabled · 30-day expiry"], ["Public access", "fully blocked"], ["Key", "uploads/{owner}/{id}/document.pdf"]],
  },
  process: {
    kind: "Compute · process_document_batch", title: "Verify and start extraction",
    body: "Checks the stored version's size and %PDF header, then starts asynchronous Textract with an idempotent token. If the account returns SubscriptionRequiredException it reads the existing text layer with pypdf instead.",
    facts: [["Timeout", "300 s · 1024 MB"], ["Retries", "2 async + dead-letter queue"], ["Fallback caps", "10 MiB · 200 pages · 1M chars"]],
  },
  extract: {
    kind: "AI / ML · Textract + fallback", title: "Text extraction",
    body: "Textract (async, SNS callback) is the primary path. This account's Free plan rejects it, so the text layer is parsed with pypdf. Text is split into overlapping chunks that keep their page numbers. Scanned pages would need OCR.",
    facts: [["Primary", "Textract StartDocumentTextDetection"], ["Callback", "SNS → λ textract-result"], ["Fallback", "pypdf text layer"], ["Chunks", "1,500 chars · 200 overlap"]],
  },
  chunks: {
    kind: "Database", title: "Amazon DynamoDB",
    body: "Three on-demand tables: documents, chunks and answer jobs. Chunks get deterministic IDs and conditional writes, so a duplicate event can never overwrite indexed vectors. The chunks table streams new items.",
    facts: [["Billing", "PAY_PER_REQUEST"], ["Stream", "NEW_IMAGE → λ embed"], ["Protection", "SSE + point-in-time recovery"], ["Jobs TTL", "24 h"]],
  },
  embed: {
    kind: "Compute · generate_embeddings", title: "Embed each chunk",
    body: "DynamoDB Streams invokes this once per new chunk. It calls Titan, then stores the vector and increments the document's progress in one transaction. When the count is complete the document becomes READY.",
    facts: [["Batch size", "1 · INSERT filter"], ["Retries", "5 · bisect · DLQ"], ["Atomicity", "TransactWriteItems"]],
  },
  titan: {
    kind: "AI / ML · Bedrock", title: "Amazon Titan Text Embeddings V2",
    body: "Turns each chunk into a normalised 256-dimension vector. The same model and size are used for questions, which is why their cosine similarity is meaningful.",
    facts: [["Model", "amazon.titan-embed-text-v2:0"], ["Dimensions", "256 · normalised"]],
  },
  query: {
    kind: "Compute · handle_query", title: "Synchronous retrieval",
    body: "Embeds the question and ranks every chunk of the selected document. It must finish inside API Gateway's 29-second limit, so it runs with a 28-second timeout.",
    facts: [["Timeout", "28 s · 1024 MB"], ["Scope", "signed owner + document"], ["Limit", "2,500 chunks per search"], ["top_k", "1–10"]],
  },
  qtitan: {
    kind: "AI / ML · Bedrock", title: "Titan V2 · question vector",
    body: "The question is embedded with the same model and dimensions as the chunks, with a short read timeout because a person is waiting.",
    facts: [["Read timeout", "12 s · 1 attempt"], ["Output", "256-d unit vector"]],
  },
  rank: {
    kind: "Search", title: "Exact cosine top-k",
    body: "A brute-force cosine comparison over the document's stored vectors, done in Lambda. No vector database: simple and auditable for a small corpus. Add an index only when measurements show this is the bottleneck.",
    facts: [["Method", "cosine on unit vectors"], ["Cost", "O(chunks × 256)"], ["Returns", "text, pages, score"]],
  },
  answer: {
    kind: "Compute · generate_answer (API)", title: "Queue the answer job",
    body: "Generation can outlast an API request, so this writes a QUEUED job to DynamoDB, sends its ID to SQS and immediately returns HTTP 202. The browser then polls GET /answers/{job_id}.",
    facts: [["Response", "202 Accepted + job_id"], ["Job expiry", "24 h (TTL)"], ["Poll", "GET /answers/{job_id}"]],
  },
  sqs: {
    kind: "Messaging", title: "Amazon SQS · answer queue",
    body: "Decouples slow model calls from the request. A message is retried up to three times, then moves to a dead-letter queue watched by a CloudWatch alarm.",
    facts: [["Visibility", "1,800 s"], ["maxReceiveCount", "3 → answer-failures DLQ"], ["Alarm", "DLQ messages > 0"]],
  },
  worker: {
    kind: "Compute · generate_answer (worker)", title: "Grounded generation worker",
    body: "Leases the job, retrieves trusted passages from DynamoDB itself (it never trusts text sent by a client), builds an evidence-only prompt and stores the cited answer with source pages.",
    facts: [["Timeout", "300 s · 1024 MB"], ["Lease", "330 s"], ["Prompt", "cite [S1]…, abstain without evidence"]],
  },
  nova: {
    kind: "AI / ML · Bedrock", title: "Amazon Nova 2 Lite",
    body: "Called through Bedrock's Converse API using the US cross-region inference profile. It sees only the retrieved excerpts and is told to treat them as untrusted data.",
    facts: [["Model", "us.amazon.nova-2-lite-v1:0"], ["API", "Converse"], ["Max output", "4,096 tokens"]],
  },
};

// ── State ──────────────────────────────────────────────────────────────────────
const KEYS = { theme: "folio.theme", current: "folio.current", turns: "folio.turns.", panes: "folio.panes" };
const state = {
  health: null,
  papers: [],
  library: [],
  docs: new Map(),
  current: null,
  uploading: null,
  turns: new Map(),
  asking: false,
  pollTimer: null,
  readerVersion: 0,
  selectedNode: null,
  packetKey: "",
  events: 0,
};

const els = {
  app: $("app"), livePill: $("live-pill"), liveText: $("live-text"), metaRegion: $("meta-region"), metaApi: $("meta-api"),
  topologySvg: $("topology-svg"), topology: $("topology"), nodeCard: $("node-card"),
  paperList: $("paper-list"), uploadList: $("upload-list"), uploadsTitle: $("uploads-title"), libraryHint: $("library-hint"),
  dropzone: $("dropzone"), pdfInput: $("pdf-input"), dropTitle: $("drop-title"), dropSubtitle: $("drop-subtitle"),
  libraryError: $("library-error"), openForm: $("open-form"), openId: $("open-id"),
  readerTitle: $("reader-title"), readerSub: $("reader-sub"), docChip: $("doc-chip"), ingest: $("ingest"),
  ingestTrack: $("ingest-fill").parentElement, ingestFill: $("ingest-fill"), statChunks: $("stat-chunks"),
  statMethod: $("stat-method"), statUpload: $("stat-upload"), statIndexed: $("stat-indexed"), statId: $("stat-id"),
  docError: $("doc-error"), readerFrame: $("reader-frame"), pdfFrame: $("pdf-frame"), readerEmpty: $("reader-empty"),
  readerEmptyText: $("reader-empty-text"), reindex: $("reindex"), thread: $("thread"), threadEmpty: $("thread-empty"), composer: $("composer"),
  suggestions: $("suggestions"), question: $("question"), send: $("send"), composerHint: $("composer-hint"),
  questionCount: $("question-count"), console: $("console"), consoleBar: $("console-bar"), consoleLog: $("console-log"),
  consoleLast: $("console-last"), consoleCount: $("console-count"), citePop: $("cite-pop"),
};

// ── Event stream (console) ─────────────────────────────────────────────────────
function logEvent(kind, message, ms) {
  state.events += 1;
  const labels = { http: "HTTP", state: "STATE", ok: "OK", error: "ERROR" };
  const row = h("li", {},
    h("span", { class: "log-time", text: clock() }),
    h("span", { class: `log-kind k-${kind}`, text: labels[kind] || kind }),
    h("span", { class: "log-msg", text: message, title: message }),
    h("span", { class: "log-ms", text: ms == null ? "" : fmtMs(ms) }));
  els.consoleLog.append(row);
  while (els.consoleLog.childElementCount > 300) els.consoleLog.firstElementChild.remove();
  els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
  els.consoleLast.textContent = `${labels[kind] || kind}  ${message}${ms == null ? "" : `  · ${fmtMs(ms)}`}`;
  els.consoleCount.textContent = `${state.events} event${state.events === 1 ? "" : "s"}`;
  els.console.classList.add("has-activity");
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
  try { data = await response.json(); } catch { /* Non-JSON error bodies are reported by status. */ }
  if (!response.ok) {
    logEvent("error", `${method} ${path} → ${response.status} ${data.error || ""}`.trim(), ms);
    throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  }
  if (!quiet) logEvent("http", `${method} ${path} → ${response.status}`, ms);
  return { data, ms };
}

const postJson = (path, body, opts) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts);

// ── Topology ───────────────────────────────────────────────────────────────────
const refs = { nodes: {}, edges: {}, packets: null, laneIngest: null, laneAsk: null };

function buildTopology() {
  const root = els.topologySvg;
  root.replaceChildren();
  root.append(
    svg("line", { class: "lane-rule", x1: 300, y1: 131, x2: 1430, y2: 131 }),
    svg("text", { x: 1425, y: 34, "text-anchor": "end" },
      svg("tspan", { class: "lane-label" }, "Ingest  "), (refs.laneIngest = svg("tspan", { class: "lane-state" }, "idle"))),
    svg("text", { x: 1425, y: 153, "text-anchor": "end" },
      svg("tspan", { class: "lane-label" }, "Ask  "), (refs.laneAsk = svg("tspan", { class: "lane-state" }, "idle"))),
  );

  const edgeLayer = svg("g");
  const arcPath = "M 70 45 C 70 2, 537 2, 537 39";
  const arc = svg("g", { class: "edge-g is-dashed" },
    svg("path", { class: "edge", d: arcPath }),
    svg("polygon", { class: "edge-arrow", points: "537,45 533,38 541,38" }),
    svg("text", { class: "edge-label", x: 303, y: 9, "text-anchor": "middle" }, "presigned PUT · bytes go straight to S3"));
  refs.edges.arc = { g: arc, d: arcPath };
  edgeLayer.append(arc);
  for (const [id, from, to, y] of EDGES) {
    const x1 = node(from).x + NODE_W / 2;
    const x2 = node(to).x - NODE_W / 2;
    const d = `M ${x1} ${y} L ${x2 - 5} ${y}`;
    const g = svg("g", { class: "edge-g" },
      svg("path", { class: "edge", d }),
      svg("polygon", { class: "edge-arrow", points: `${x2},${y} ${x2 - 6},${y - 3.5} ${x2 - 6},${y + 3.5}` }));
    refs.edges[id] = { g, d };
    edgeLayer.append(g);
  }
  refs.packets = svg("g");

  const nodeLayer = svg("g");
  for (const item of NODES) {
    const height = item.h || NODE_H;
    const bx = item.x - NODE_W / 2;
    const by = item.y - height / 2;
    const tall = Boolean(item.h);
    const titleY = tall ? by + 26 : item.y - 3;
    const sub = svg("text", { class: "node-sub", x: bx + 18, y: titleY + 16 }, item.sub);
    const g = svg("g", { class: "node", "data-kind": item.kind, tabindex: 0, role: "button", "aria-label": `${item.title}: details` },
      svg("rect", { class: "node-halo", x: bx, y: by, width: NODE_W, height, rx: 10 }),
      svg("rect", { class: "node-box", x: bx, y: by, width: NODE_W, height, rx: 10 }),
      svg("rect", { class: "node-stripe", x: bx + 8, y: by + 12, width: 3, height: tall ? 30 : height - 24, rx: 1.5 }),
      svg("text", { class: "node-title", x: bx + 18, y: titleY }, item.title),
      sub,
      svg("circle", { class: "node-dot", cx: bx + NODE_W - 12, cy: by + 12, r: 3.5 }));
    if (tall) {
      const lines = item.id === "client" ? ["page on 127.0.0.1", "Python RagClient", "SigV4 per request"] : ["IAM on every route", "same-account only", "throttled stage"];
      lines.forEach((line, index) => g.append(svg("text", { class: "node-sub", x: bx + 18, y: by + 86 + index * 18 }, line)));
    }
    if (item.id === "extract") {
      g.append(svg("g", { class: "node-gate" },
        svg("rect", { x: item.x - 47, y: by - 18, width: 94, height: 14, rx: 7 }),
        svg("text", { x: item.x, y: by - 8, "text-anchor": "middle" }, "TEXTRACT GATED")));
    }
    g.addEventListener("click", (event) => { event.stopPropagation(); openNodeCard(item.id); });
    g.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNodeCard(item.id); } });
    refs.nodes[item.id] = { g, sub, item };
    nodeLayer.append(g);
  }
  root.append(edgeLayer, refs.packets, nodeLayer);
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
  const status = doc.status;
  const total = Number(doc.total_chunks || 0);
  const done = Number(doc.completed_chunks || 0);
  if (status === "READY") return { ...stepStates(INGEST_STEPS, INGEST_STEPS.length), label: `ready · ${total}/${total} chunks`, tone: "done" };
  if (status === "FAILED") return { ...stepStates(INGEST_STEPS, total ? 4 : 3, { error: true }), label: "failed", tone: "error" };
  if (status === "EMBEDDING") return { ...stepStates(INGEST_STEPS, 4), label: `embedding · ${done}/${total}`, tone: "active" };
  if (status === "EXTRACTING") return { ...stepStates(INGEST_STEPS, 3), label: "extracting text", tone: "active" };
  if (status === "AWAITING_UPLOAD") return { ...stepStates(INGEST_STEPS, 2), label: "waiting for S3 event", tone: "active" };
  return { nodes: new Map(), edges: new Map(), label: "checking…", tone: "" };
}

function askVisual() {
  const turns = state.turns.get(state.current) || [];
  const turn = turns[turns.length - 1];
  if (!turn) return { nodes: new Map(), edges: new Map(), label: "idle", tone: "" };
  if (turn.phase === "error") return { ...stepStates(ASK_STEPS, turn.failedAt ?? 0, { error: true }), label: "failed", tone: "error" };
  if (turn.answer) return { ...stepStates(ASK_STEPS, ASK_STEPS.length), label: `answered · ${fmtMs(turn.timings?.total)}`, tone: "done" };
  const index = { retrieve: 0, queued: 1, generating: 2 }[turn.phase] ?? 0;
  const labels = ["retrieving passages", "queued in SQS", "Nova is writing"];
  return { ...stepStates(ASK_STEPS, index), label: labels[index], tone: "active" };
}

function liveSub(id) {
  // While a new upload is in flight the selected document is the previous one; don't show its numbers.
  const doc = state.uploading ? null : currentDoc();
  const entry = state.uploading ? null : currentEntry();
  const turns = state.turns.get(state.current) || [];
  const turn = turns[turns.length - 1];
  const total = Number(doc?.total_chunks || 0);
  switch (id) {
    case "s3": return state.uploading ? `PUT ${fmtBytes(state.uploading.size)}` : entry?.size_bytes ? `${fmtBytes(entry.size_bytes)} stored` : null;
    case "upload": return entry?.upload_ms ? `upload ${fmtMs(entry.upload_ms)}` : null;
    case "extract": return doc?.extraction_method === "pypdf" ? `pypdf · ${entry?.pages ?? "?"} pp` : doc?.extraction_method === "textract" ? "Textract OCR" : null;
    case "chunks": return total ? `${total} chunks` : null;
    case "embed": return doc?.status === "EMBEDDING" ? `${doc.completed_chunks}/${total} embedded` : doc?.status === "READY" ? `${total}/${total} ✓` : null;
    case "titan": return doc?.status === "READY" ? "256-d · indexed" : null;
    case "query": return turn?.timings?.retrieve ? `${fmtMs(turn.timings.retrieve)}` : null;
    case "rank": return turn?.ranked?.length && total ? `top ${turn.ranked.length} of ${total}` : null;
    case "sqs": return turn?.live && turn.phase === "queued" ? "job waiting" : turn?.jobId ? `job ${turn.jobId.slice(0, 6)}` : null;
    case "nova": return turn?.timings?.generate ? `wrote in ${fmtMs(turn.timings.generate)}` : null;
    default: return null;
  }
}

function renderTopology() {
  const ingest = ingestVisual();
  const ask = askVisual();
  const rank = { done: 1, active: 2, error: 3 };
  const merge = (a, b) => (rank[a] || 0) >= (rank[b] || 0) ? a : b;
  for (const [id, ref] of Object.entries(refs.nodes)) {
    const status = merge(ingest.nodes.get(id), ask.nodes.get(id));
    ref.g.classList.toggle("is-active", status === "active");
    ref.g.classList.toggle("is-done", status === "done");
    ref.g.classList.toggle("is-error", status === "error");
    ref.g.classList.toggle("is-selected", state.selectedNode === id);
    ref.sub.textContent = liveSub(id) || ref.item.sub;
  }
  refs.nodes.extract.g.classList.toggle("is-gated", currentDoc()?.extraction_method === "pypdf");
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
    refs.packets.replaceChildren(...activeEdges.map((id) => svg("circle", { class: "packet", r: 3 },
      svg("animateMotion", { dur: id === "arc" ? "1.6s" : "1.1s", repeatCount: "indefinite", path: refs.edges[id].d }))));
  }
  const setLane = (target, visual) => {
    target.textContent = visual.label;
    target.setAttribute("class", `lane-state ${visual.tone ? `is-${visual.tone}` : ""}`);
  };
  setLane(refs.laneIngest, ingest);
  setLane(refs.laneAsk, ask);
  if (state.selectedNode) fillNodeLive(state.selectedNode);
}

function openNodeCard(id) {
  const info = NODE_INFO[id];
  if (!info) return;
  if (state.selectedNode === id && !els.nodeCard.hidden) { closeNodeCard(); return; }
  state.selectedNode = id;
  const item = node(id);
  els.nodeCard.dataset.kind = item.kind;
  $("node-card-kind").textContent = info.kind;
  $("node-card-title").textContent = info.title;
  $("node-card-body").textContent = info.body;
  $("node-card-facts").replaceChildren(...info.facts.flatMap(([key, value]) => [h("dt", { text: key }), h("dd", { text: value })]));
  fillNodeLive(id);
  els.nodeCard.hidden = false;
  const box = refs.nodes[id].g.getBoundingClientRect();
  const host = els.topology.getBoundingClientRect();
  const width = els.nodeCard.offsetWidth;
  const left = Math.min(Math.max(8, box.left - host.left + box.width / 2 - width / 2), host.width - width - 8);
  els.nodeCard.style.left = `${left}px`;
  els.nodeCard.style.top = `${box.bottom - host.top + 10}px`;
  renderTopology();
}

function fillNodeLive(id) {
  const live = liveSub(id);
  $("node-card-live").textContent = live ? `Now: ${live}` : "";
}

function closeNodeCard() {
  els.nodeCard.hidden = true;
  state.selectedNode = null;
  renderTopology();
}

// ── Library ────────────────────────────────────────────────────────────────────
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
  const total = Number(doc.total_chunks || 0);
  if (doc.status === "READY") return { text: "Ready", tone: "ready" };
  if (doc.status === "FAILED") return { text: "Failed", tone: "error" };
  if (doc.status === "EMBEDDING") return { text: `${doc.completed_chunks || 0}/${total}`, tone: "busy" };
  if (doc.status === "EXTRACTING") return { text: "Extracting", tone: "busy" };
  return { text: "Uploading", tone: "busy" };
}

function paperButton({ title, meta, entry, onClick, current }) {
  const doc = entry ? state.docs.get(entry.document_id) : null;
  const label = entry ? docStateLabel(doc) : { text: "Index", tone: "new" };
  const busy = label.tone === "busy";
  const progress = doc?.status === "EMBEDDING" && doc.total_chunks ? doc.completed_chunks / doc.total_chunks : doc?.status === "EXTRACTING" ? 0.06 : 0;
  return h("button", { class: `paper${current ? " is-current" : ""}`, type: "button", "data-key": entry?.document_id || title, onclick: onClick, disabled: Boolean(state.uploading) && !entry, "aria-current": current ? "true" : null },
    h("span", { class: "paper-title", text: title }),
    h("span", { class: `paper-state is-${label.tone}`, text: label.text }),
    h("span", { class: "paper-meta", text: meta }),
    busy ? h("span", { class: "paper-progress" }, Object.assign(h("span"), { style: `transform: scaleX(${Math.max(progress, 0.04)})` })) : null);
}

function renderLibrary() {
  // The list is rebuilt on every poll; keep keyboard focus on the same row.
  const focusedKey = document.activeElement?.closest?.(".paper")?.dataset.key;
  els.paperList.replaceChildren(...state.papers.map((paper) => {
    const entry = entryForPaper(paper.name);
    const doc = entry ? state.docs.get(entry.document_id) : null;
    const chunks = doc?.status === "READY" ? ` · ${doc.total_chunks} chunks` : "";
    return h("li", {}, paperButton({
      title: paper.title, entry, current: entry && entry.document_id === state.current,
      meta: `${paper.pages ?? "?"} pp · ${fmtBytes(paper.size_bytes)}${chunks}`,
      onClick: () => (entry && doc?.status !== "FAILED" ? selectDocument(entry.document_id) : indexPaper(paper.name)),
    }));
  }));
  const uploads = state.library.filter((entry) => !entry.paper || !paperMeta(entry.paper));
  els.uploadsTitle.hidden = els.uploadList.hidden = uploads.length === 0;
  els.uploadList.replaceChildren(...uploads.map((entry) => {
    const doc = state.docs.get(entry.document_id);
    const meta = [entry.pages ? `${entry.pages} pp` : null, entry.size_bytes ? fmtBytes(entry.size_bytes) : null, doc?.status === "READY" ? `${doc.total_chunks} chunks` : null].filter(Boolean).join(" · ") || entry.document_id.slice(0, 12);
    return h("li", {},
      paperButton({ title: stripPdf(entry.filename), meta, entry, current: entry.document_id === state.current, onClick: () => selectDocument(entry.document_id) }),
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

async function fetchDoc(id, { quiet = true } = {}) {
  const { data } = await api(`/api/documents/${id}`, {}, { quiet });
  const before = state.docs.get(id);
  state.docs.set(id, data);
  const changed = !before || before.status !== data.status || before.completed_chunks !== data.completed_chunks;
  if (changed && before) {
    const progress = data.status === "EMBEDDING" ? ` ${data.completed_chunks}/${data.total_chunks}` : "";
    logEvent(data.status === "READY" ? "ok" : data.status === "FAILED" ? "error" : "state", `document ${id.slice(0, 8)} · ${data.status}${progress}`);
  }
  return { data, changed };
}

async function hydrateStatuses() {
  // Staggered so the stage throttle (5 requests/s) is never hit.
  for (const entry of state.library) {
    try { await fetchDoc(entry.document_id); } catch { state.docs.set(entry.document_id, { status: "UNKNOWN" }); }
    renderLibrary();
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
}

async function indexPaper(name) {
  if (state.uploading) return;
  clearAlert(els.libraryError);
  const paper = paperMeta(name);
  state.uploading = { name, size: paper?.size_bytes };
  enterUploadingView(stripPdf(name), paper?.pages);
  try {
    const { data } = await postJson("/api/sample-document", { paper: name });
    logEvent("state", `registered ${data.document_id.slice(0, 8)} · S3 PUT complete in ${fmtMs(data.upload_ms)}`);
    state.uploading = null;
    state.docs.set(data.document_id, data);
    await refreshLibrary();
    selectDocument(data.document_id);
  } catch (error) {
    state.uploading = null;
    showAlert(els.libraryError, error.message);
    selectDocument(state.current);
  }
}

async function uploadFile(file) {
  clearAlert(els.libraryError);
  if (!file) return;
  if (!/\.pdf$/i.test(file.name)) return showAlert(els.libraryError, "Choose a .pdf file.");
  if (file.size === 0) return showAlert(els.libraryError, "That PDF is empty.");
  if (file.size > 10 * 1024 * 1024) return showAlert(els.libraryError, "The text-layer fallback accepts PDFs up to 10 MB.");
  if (state.uploading) return;
  state.uploading = { name: file.name, size: file.size };
  els.dropzone.classList.add("is-busy");
  els.dropTitle.textContent = `Uploading ${file.name}`;
  els.dropSubtitle.textContent = `${fmtBytes(file.size)} → private S3`;
  enterUploadingView(stripPdf(file.name), null);
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    const { data } = await api("/api/documents", { method: "POST", body: form });
    logEvent("state", `registered ${data.document_id.slice(0, 8)} · S3 PUT complete in ${fmtMs(data.upload_ms)}`);
    state.uploading = null;
    state.docs.set(data.document_id, data);
    await refreshLibrary();
    selectDocument(data.document_id);
  } catch (error) {
    state.uploading = null;
    showAlert(els.libraryError, error.message);
    selectDocument(state.current);
  } finally {
    els.dropzone.classList.remove("is-busy");
    els.dropTitle.textContent = "Upload a PDF";
    els.dropSubtitle.textContent = "Drop a text-based paper · max 10 MB";
    els.pdfInput.value = "";
  }
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
  } catch (error) {
    showAlert(els.libraryError, error.message);
  }
}

async function forget(id) {
  try {
    await api(`/api/library/${id}`, { method: "DELETE" });
    if (state.current === id) state.current = null;
    await refreshLibrary();
    selectDocument(state.current || firstReady());
  } catch (error) {
    showAlert(els.libraryError, error.message);
  }
}

const firstReady = () => state.library.find((entry) => state.docs.get(entry.document_id)?.status === "READY")?.document_id || state.library[0]?.document_id || null;

// ── Reader + document state ────────────────────────────────────────────────────
function enterUploadingView(title, pages) {
  els.readerTitle.textContent = title;
  els.readerSub.textContent = `${pages ? `${pages} pages · ` : ""}registering with the API and streaming to S3`;
  setChip(els.docChip, "Uploading", "active");
  els.reindex.hidden = true;
  els.ingest.hidden = false;
  els.ingestTrack.classList.add("is-indeterminate");
  els.ingestTrack.classList.remove("is-ready");
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
    loadPdf();
    renderReader();
    renderThread();
    renderLibrary();
    renderTopology();
    return;
  }
  const changed = state.current !== id;
  state.current = id;
  try { localStorage.setItem(KEYS.current, id); } catch { /* Storage can be disabled. */ }
  if (!state.turns.has(id)) state.turns.set(id, loadTurns(id));
  renderReader();
  if (changed) {
    loadPdf();
    renderThread();
  }
  renderSuggestions();
  renderLibrary();
  renderTopology();
  schedulePoll(0);
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
    els.readerSub.textContent = "Choose a bundled paper or upload one to begin.";
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
  const messages = {
    READY: "Indexed · ask anything about it",
    EMBEDDING: "Titan is embedding each chunk",
    EXTRACTING: "Reading the PDF's pages",
    AWAITING_UPLOAD: "Waiting for the S3 upload event",
    FAILED: "Processing stopped",
  };
  els.readerSub.textContent = [pages ? `${pages} pages` : null, messages[status] || "Checking status…"].filter(Boolean).join(" · ");
  const chip = { READY: ["Ready", "ok"], FAILED: ["Failed", "error"], EMBEDDING: ["Indexing", "active"], EXTRACTING: ["Extracting", "active"], AWAITING_UPLOAD: ["Uploaded", "active"] }[status] || ["Checking", ""];
  setChip(els.docChip, chip[0], chip[1]);
  els.ingest.hidden = false;
  const progress = status === "READY" ? 1 : status === "EMBEDDING" && total ? Math.max(0.04, done / total) : 0;
  els.ingestTrack.classList.toggle("is-indeterminate", ["EXTRACTING", "AWAITING_UPLOAD"].includes(status));
  els.ingestTrack.classList.toggle("is-ready", status === "READY");
  els.ingestFill.style.transform = `scaleX(${progress})`;
  els.ingestTrack.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  els.statChunks.textContent = total ? `${done} / ${total}` : "—";
  els.statMethod.textContent = doc?.extraction_method === "pypdf" ? "pypdf (Textract gated)" : doc?.extraction_method === "textract" ? "Amazon Textract" : "pending";
  els.statUpload.textContent = entry.upload_ms ? fmtMs(entry.upload_ms) : "—";
  if (doc?.created_at && doc?.updated_at) {
    const seconds = status === "READY" || status === "FAILED" ? doc.updated_at - doc.created_at : Math.max(0, Math.round(Date.now() / 1000 - doc.created_at));
    els.statIndexed.textContent = status === "READY" ? `${seconds} s` : `${seconds} s…`;
  } else {
    els.statIndexed.textContent = "—";
  }
  els.statId.textContent = `${state.current.slice(0, 8)}…${state.current.slice(-4)}`;
  els.statId.title = `Copy ${state.current}`;
  if (status === "FAILED") showAlert(els.docError, doc.error_message || "Processing failed. Try a text-based PDF.");
  else clearAlert(els.docError);
  setComposerEnabled(status === "READY" && !state.asking);
}

function loadPdf(page) {
  const entry = currentEntry();
  if (!entry?.pdf_url) {
    els.pdfFrame.hidden = true;
    els.pdfFrame.removeAttribute("src");
    els.readerEmpty.hidden = false;
    els.readerEmptyText.textContent = entry ? "No local copy of this PDF is on this machine, so the reader is off. Answers and page citations still work." : "The paper opens here. Citations in an answer jump straight to their page.";
    return;
  }
  state.readerVersion += 1;
  els.readerEmpty.hidden = true;
  els.pdfFrame.hidden = false;
  // A changing query string forces the built-in PDF viewer to honour the new #page.
  els.pdfFrame.src = `${entry.pdf_url}?v=${state.readerVersion}#page=${page || 1}&navpanes=0&view=FitH`;
}

function jumpToPage(page) {
  if (!page) return;
  loadPdf(page);
  els.readerFrame.dataset.page = `Page ${page}`;
  els.readerFrame.classList.remove("is-jumping");
  void els.readerFrame.offsetWidth;
  els.readerFrame.classList.add("is-jumping");
  clearTimeout(jumpToPage.timer);
  jumpToPage.timer = setTimeout(() => els.readerFrame.classList.remove("is-jumping"), 1600);
  logEvent("state", `reader → page ${page}`);
}

function schedulePoll(delay = 1500) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(poll, delay);
}

async function poll() {
  const watched = state.library
    .map((entry) => entry.document_id)
    .filter((id) => id === state.current || !["READY", "FAILED", "UNKNOWN"].includes(state.docs.get(id)?.status));
  let busy = false;
  for (const id of watched) {
    try {
      await fetchDoc(id);
      if (!["READY", "FAILED"].includes(state.docs.get(id)?.status)) busy = true;
    } catch (error) {
      if (id === state.current) {
        showAlert(els.docError, `Status check failed: ${error.message} Retrying…`);
        busy = true;
      } else {
        state.docs.set(id, { ...(state.docs.get(id) || {}), status: "UNKNOWN" });
      }
    }
  }
  renderReader();
  renderLibrary();
  renderTopology();
  if (busy) schedulePoll(1500);
}

// ── Asking ─────────────────────────────────────────────────────────────────────
function loadTurns(id) {
  try {
    const turns = JSON.parse(localStorage.getItem(KEYS.turns + id) || "[]");
    return Array.isArray(turns) ? turns.filter((turn) => turn && turn.question).map((turn) => ({ ...turn, live: false })) : [];
  } catch { return []; }
}

function saveTurns(id) {
  const turns = (state.turns.get(id) || []).filter((turn) => turn.answer).slice(-8).map(({ el: _el, live: _live, ...rest }) => rest);
  try { localStorage.setItem(KEYS.turns + id, JSON.stringify(turns)); } catch { /* Storage can be full or disabled. */ }
}

function renderSuggestions() {
  const entry = currentEntry();
  const questions = QUESTIONS[entry?.paper || entry?.filename] || DEFAULT_QUESTIONS;
  const ready = currentDoc()?.status === "READY" && !state.asking;
  els.suggestions.replaceChildren(
    ...questions.map((question) => h("button", { class: "suggestion", type: "button", disabled: !ready, title: question, onclick: () => ask(question), text: question })),
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
  for (const turn of turns) {
    turn.el = buildTurn(turn);
    els.thread.append(turn.el);
    paintTurn(turn, { animate: false });
  }
  turns.at(-1)?.el.scrollIntoView({ block: "start" });
}

function buildTurn(turn) {
  const steps = ["Retrieve", "Queue", "Generate", "Cite"].map((label) =>
    h("div", { class: "step" }, h("div", { class: "step-bar" }), h("div", { class: "step-label" }, h("span", { text: label }), h("span", { class: "step-time" }))));
  return h("article", { class: "turn" },
    h("div", { class: "turn-q" }, h("p", { text: turn.question })),
    h("div", { class: "steps" }, steps),
    h("div", { class: "turn-body" }),
    h("div", { class: "turn-evidence" }),
    h("div", { class: "turn-foot" }));
}

function paintSteps(turn) {
  const steps = [...turn.el.querySelectorAll(".step")];
  const order = { retrieve: 0, queued: 1, generating: 2, done: 4 };
  const index = turn.phase === "error" ? turn.failedAt ?? 0 : order[turn.phase] ?? 4;
  const times = [turn.timings?.retrieve, turn.timings?.queue, turn.timings?.generate, turn.sources ? null : undefined];
  steps.forEach((step, i) => {
    step.className = "step" + (turn.phase === "error" && i === index ? " is-error" : i < index ? " is-done" : i === index ? " is-active" : "");
    const time = times[i];
    step.querySelector(".step-time").textContent = i === 3 ? (turn.sources ? `${citedIds(turn).length}/${turn.sources.length} used` : "") : time != null ? fmtMs(time) : "";
  });
}

function paintTurn(turn, { animate = true } = {}) {
  paintSteps(turn);
  const body = turn.el.querySelector(".turn-body");
  const evidence = turn.el.querySelector(".turn-evidence");
  const foot = turn.el.querySelector(".turn-foot");
  if (turn.phase === "error") {
    body.replaceChildren(h("p", { class: "turn-error", text: turn.error }));
  } else if (turn.answer) {
    if (!body.dataset.rendered) {
      const container = h("div", { class: "answer" });
      renderAnswer(container, turn.answer, turn);
      if (animate) [...container.children].forEach((child, i) => { child.classList.add("reveal"); child.style.animationDelay = `${i * 70}ms`; });
      body.replaceChildren(container);
      body.dataset.rendered = "1";
    }
  } else {
    body.replaceChildren(h("div", { class: "skeleton", "aria-label": "Waiting for the answer" }, h("span"), h("span"), h("span")));
  }
  if (turn.ranked?.length) evidence.replaceChildren(buildEvidence(turn));
  foot.replaceChildren();
  if (turn.answer) {
    foot.append(
      h("span", {}, "model ", h("b", { text: (turn.modelId || "Nova 2 Lite").replace(/^us\./, "") })),
      h("span", {}, "total ", h("b", { text: fmtMs(turn.timings?.total) })),
      turn.jobId ? h("span", {}, "job ", h("b", { text: turn.jobId.slice(0, 8) })) : null,
      h("button", { type: "button", onclick: (event) => copyText(turn.answer, event.currentTarget), text: "Copy answer" }));
  }
}

const CITATION = /\[((?:S\d+)(?:\s*[,;]\s*S\d+)*)\]/g;
function citedIds(turn) {
  return [...new Set([...String(turn.answer || "").matchAll(CITATION)].flatMap((match) => match[1].split(/\s*[,;]\s*/)))];
}

function buildEvidence(turn) {
  const entry = currentEntry();
  const ranked = turn.ranked;
  const usedIds = new Set(citedIds(turn));
  const cited = new Set((turn.sources || []).filter((source) => usedIds.has(source.source_id)).flatMap((source) => source.pages || []));
  const maxPage = Math.max(1, ...ranked.flatMap((chunk) => chunk.pages || []), ...(turn.sources || []).flatMap((source) => source.pages || []));
  const pages = Math.max(entry?.pages || paperMeta(entry?.paper)?.pages || 0, maxPage);
  const scores = ranked.map((chunk) => chunk.similarity_score);
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const perPage = new Map();
  for (const chunk of ranked) for (const page of chunk.pages || []) perPage.set(page, Math.max(perPage.get(page) || 0, chunk.similarity_score));
  const binSize = Math.ceil(pages / 60);
  const bins = Math.ceil(pages / binSize);
  const ribbon = h("div", { class: "ribbon", role: "group", "aria-label": "Relevance of each page to the question" });
  for (let b = 0; b < bins; b += 1) {
    const first = b * binSize + 1;
    const last = Math.min(pages, first + binSize - 1);
    let best = 0;
    let isCited = false;
    for (let page = first; page <= last; page += 1) {
      best = Math.max(best, perPage.get(page) || 0);
      isCited ||= cited.has(page);
    }
    const label = first === last ? `Page ${first}` : `Pages ${first}–${last}`;
    const button = h("button", {
      type: "button", class: `${best ? "is-hit" : ""}${isCited ? " is-cited" : ""}`,
      title: best ? `${label} · best similarity ${best.toFixed(3)}${isCited ? " · cited" : ""}` : `${label} · not in top ${ranked.length}`,
      "aria-label": best ? `${label}, similarity ${best.toFixed(2)}` : label,
      onclick: () => jumpToPage(first),
    });
    if (best) button.style.setProperty("--alpha", (0.28 + 0.72 * ((best - low) / ((high - low) || 1))).toFixed(2));
    ribbon.append(button);
  }
  const sources = (turn.sources || []).map((source, index) => buildSource(source, index, high, usedIds));
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
  const scoreBar = h("i");
  scoreBar.style.setProperty("--score", `${Math.round((score / (best || 1)) * 100)}%`);
  const card = h("details", { class: `source${used ? "" : " is-uncited"}`, "data-source": id },
    h("summary", {},
      h("span", { class: "source-id", text: id }),
      h("span", { class: "source-meta", text: `${pages.length ? `p. ${pages.join(", ")}` : "page unknown"} · chunk ${source.chunk_index ?? "?"}${used ? "" : " · retrieved, not cited"}` }),
      h("span", { class: "source-score", title: "Cosine similarity to the question" }, scoreBar, score ? score.toFixed(3) : "")),
    h("div", { class: "source-body" },
      h("p", { text: source.excerpt || source.text || "No passage text returned." }),
      pages.length ? h("button", { class: "source-jump", type: "button", onclick: () => jumpToPage(pages[0]), text: `Show page ${pages[0]} in the reader →` }) : null));
  return card;
}

function renderAnswer(container, text, turn) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  let list = null;
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const p = h("p");
    appendInline(p, paragraph.join(" "), turn);
    container.append(p);
    paragraph = [];
  };
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
      const li = h("li");
      appendInline(li, (bullet || ordered)[1], turn);
      list.append(li);
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
    if (source?.pages?.[0]) jumpToPage(source.pages[0]);
    const card = turn.el?.querySelector(`.source[data-source="${id}"]`);
    if (card) {
      card.open = true;
      card.classList.remove("is-flash");
      void card.offsetWidth;
      card.classList.add("is-flash");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setTimeout(() => card.classList.remove("is-flash"), 1800);
    }
  });
  return chip;
}

function showCitePop(anchor, id, source) {
  if (!source) return;
  const pages = (source.pages || []).join(", ");
  const excerpt = String(source.excerpt || "").replace(/\s+/g, " ").trim();
  els.citePop.replaceChildren(
    h("strong", { text: `${id} · page ${pages || "?"} · similarity ${Number(source.similarity_score || 0).toFixed(3)}` }),
    h("p", { text: excerpt.length > 260 ? `${excerpt.slice(0, 260)}…` : excerpt }));
  els.citePop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = els.citePop.offsetWidth;
  const height = els.citePop.offsetHeight;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const top = rect.top - height - 10 > 8 ? rect.top - height - 10 : rect.bottom + 10;
  els.citePop.style.left = `${left}px`;
  els.citePop.style.top = `${top}px`;
}

function closeCitePop() { els.citePop.hidden = true; }

async function ask(rawQuestion) {
  const question = String(rawQuestion || "").trim();
  const documentId = state.current;
  if (!question || state.asking || currentDoc()?.status !== "READY") return;
  state.asking = true;
  els.question.value = "";
  renderReader();
  renderSuggestions();
  const turn = { question, phase: "retrieve", live: true, timings: {}, at: Date.now(), totalChunks: Number(currentDoc()?.total_chunks) || null };
  const turns = state.turns.get(documentId) || [];
  turns.push(turn);
  state.turns.set(documentId, turns);
  els.threadEmpty.hidden = true;
  turn.el = buildTurn(turn);
  els.thread.append(turn.el);
  paintTurn(turn);
  turn.el.scrollIntoView({ block: "end", behavior: "smooth" });
  renderTopology();
  const started = performance.now();
  const update = () => { if (state.current === documentId) { paintTurn(turn); renderTopology(); } };
  try {
    const body = { question, document_ids: [documentId] };
    const retrieved = await postJson("/api/query", { ...body, top_k: 10 });
    turn.timings.retrieve = retrieved.ms;
    turn.ranked = (retrieved.data.top_chunks || []).map(({ pages, similarity_score, chunk_index }) => ({ pages, similarity_score, chunk_index }));
    logEvent("state", `retrieved ${turn.ranked.length} chunks · best cosine ${Math.max(...turn.ranked.map((c) => c.similarity_score)).toFixed(3)}`);
    turn.phase = "queued";
    update();
    const queuedAt = performance.now();
    const queued = await postJson("/api/answers", { ...body, top_k: 5 });
    turn.jobId = queued.data.job_id;
    if (!turn.jobId) throw new Error("The server did not return an answer job ID.");
    logEvent("state", `job ${turn.jobId.slice(0, 8)} · QUEUED (HTTP 202)`);
    let generatingAt = null;
    let pollErrors = 0;
    const deadline = performance.now() + 6 * 60 * 1000;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (performance.now() > deadline) throw Object.assign(new Error(`No answer after 6 minutes. Job ${turn.jobId.slice(0, 8)} may still finish; ask again later.`), { failedAt: generatingAt ? 2 : 1 });
      let data;
      try {
        ({ data } = await api(`/api/answers/${turn.jobId}`, {}, { quiet: true }));
        pollErrors = 0;
      } catch (error) {
        // One dropped poll (Wi-Fi, a 429 throttle) does not mean the job failed.
        pollErrors += 1;
        if (pollErrors >= 3) throw Object.assign(error, { failedAt: generatingAt ? 2 : 1 });
        continue;
      }
      const status = String(data.status || "QUEUED").toUpperCase();
      if (status === "GENERATING" && !generatingAt) {
        generatingAt = performance.now();
        turn.timings.queue = generatingAt - queuedAt;
        turn.phase = "generating";
        logEvent("state", `job ${turn.jobId.slice(0, 8)} · GENERATING`);
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
  } catch (error) {
    turn.phase = "error";
    turn.live = false;
    turn.failedAt = error.failedAt ?? (turn.ranked ? 1 : 0);
    turn.error = error.message;
  } finally {
    state.asking = false;
    update();
    renderReader();
    renderSuggestions();
    if (state.current === documentId) {
      const firstCited = (turn.sources || []).find((source) => source.source_id === citedIds(turn)[0]) || turn.sources?.[0];
      const firstPage = firstCited?.pages?.[0];
      if (firstPage) jumpToPage(firstPage);
      turn.el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
}

// ── Small UI pieces ────────────────────────────────────────────────────────────
function setChip(target, label, tone = "") {
  target.textContent = label;
  target.className = `chip${tone ? ` is-${tone}` : ""}`;
}
function showAlert(target, message) { target.textContent = message; target.hidden = false; }
function clearAlert(target) { target.textContent = ""; target.hidden = true; }

async function copyText(value, button, restore) {
  const original = button.textContent;
  try { await navigator.clipboard.writeText(value); button.textContent = "Copied"; } catch { button.textContent = "Copy failed"; }
  setTimeout(() => { if (restore) restore(); else button.textContent = original; }, 1500);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEYS.theme, theme); } catch { /* ignore */ }
}

function setPane(name, open) {
  if (name === "topology") {
    els.app.classList.toggle("is-topology-hidden", !open);
    $("topology-toggle").setAttribute("aria-pressed", String(open));
    if (!open) closeNodeCard();
  } else {
    els.consoleLog.hidden = !open;
    els.consoleBar.setAttribute("aria-expanded", String(open));
    $("console-toggle").setAttribute("aria-pressed", String(open));
    if (open) els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
  }
  try {
    const panes = JSON.parse(localStorage.getItem(KEYS.panes) || "{}");
    localStorage.setItem(KEYS.panes, JSON.stringify({ ...panes, [name]: open }));
  } catch { /* ignore */ }
}

// ── Wiring ─────────────────────────────────────────────────────────────────────
function wire() {
  $("theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("topology-toggle").addEventListener("click", () => setPane("topology", els.app.classList.contains("is-topology-hidden")));
  const toggleConsole = () => setPane("console", els.consoleLog.hidden);
  $("console-toggle").addEventListener("click", toggleConsole);
  els.consoleBar.addEventListener("click", toggleConsole);
  $("node-card-close").addEventListener("click", closeNodeCard);
  document.addEventListener("click", (event) => { if (!els.nodeCard.hidden && !els.nodeCard.contains(event.target)) closeNodeCard(); });
  els.pdfInput.addEventListener("change", () => uploadFile(els.pdfInput.files?.[0]));
  els.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); els.dropzone.classList.add("is-dragging"); });
  els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("is-dragging"));
  els.dropzone.addEventListener("drop", (event) => { event.preventDefault(); els.dropzone.classList.remove("is-dragging"); uploadFile(event.dataTransfer?.files?.[0]); });
  els.openForm.addEventListener("submit", (event) => { event.preventDefault(); openById(els.openId.value.trim().toLowerCase()); });
  els.statId.addEventListener("click", () => state.current && copyText(state.current, els.statId, renderReader));
  els.reindex.addEventListener("click", () => { const paper = currentEntry()?.paper; if (paper) indexPaper(paper); });
  els.question.addEventListener("input", () => {
    updateSend();
    els.question.style.height = "auto";
    els.question.style.height = `${Math.min(els.question.scrollHeight, 140)}px`;
  });
  els.question.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(els.question.value); }
  });
  els.composer.addEventListener("submit", (event) => { event.preventDefault(); ask(els.question.value); });
  els.thread.addEventListener("scroll", closeCitePop, { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeNodeCard(); closeCitePop(); }
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") { event.preventDefault(); els.question.focus(); }
    else if (event.key === "`") toggleConsole();
    else if (event.key.toLowerCase() === "t") setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    else if (event.key.toLowerCase() === "a") setPane("topology", els.app.classList.contains("is-topology-hidden"));
  });
}

async function initialize() {
  try { setTheme(localStorage.getItem(KEYS.theme) || "dark"); } catch { setTheme("dark"); }
  try {
    const panes = JSON.parse(localStorage.getItem(KEYS.panes) || "{}");
    if (panes.topology === false) setPane("topology", false);
    if (panes.console === true) setPane("console", true);
  } catch { /* ignore */ }
  buildTopology();
  wire();
  renderTopology();
  setComposerEnabled(false);
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
  } catch (error) {
    els.livePill.classList.add("is-offline");
    els.liveText.textContent = "Server offline";
    showAlert(els.libraryError, error.message);
    return;
  }
  await refreshLibrary();
  let saved = null;
  try { saved = localStorage.getItem(KEYS.current); } catch { /* ignore */ }
  if (state.library.some((entry) => entry.document_id === saved)) selectDocument(saved);
  await hydrateStatuses();
  // Respect anything the operator clicked while statuses were loading.
  if (!state.current && !state.uploading) selectDocument(firstReady());
}

initialize();
