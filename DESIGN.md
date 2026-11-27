---
name: Folio
description: An operator console that makes a live serverless RAG pipeline on AWS visible, and keeps every answer next to the page it came from.
colors:
  ink: "#08090b"
  panel: "#0f1114"
  panel-2: "#14171b"
  line: "#20242a"
  text: "#ede9e2"
  muted: "#9ba1a9"
  signal: "#ff9f43"
  ready: "#5fe3a6"
  danger: "#ff7166"
  paper: "#f3f0e9"
  paper-signal: "#d36a07"
service-kinds:
  client: "#c7ccd3"
  network: "#b48cff"
  compute: "#ff9f43"
  storage: "#5fe3a6"
  database: "#7d9bff"
  integration: "#ff6fae"
  ai: "#34e0d0"
typography:
  display: "ui-serif (New York), Iowan Old Style, Charter, Georgia"
  interface: "ui-sans-serif (SF Pro), Segoe UI, system-ui"
  telemetry: "ui-monospace (SF Mono), JetBrains Mono, Menlo"
rounded:
  panel: "14px"
  control: "9px"
---

# Design system: Folio

## North star: "Mission control for one paper"

A cloud pipeline is normally invisible: a request goes in, an answer comes out. Folio's job in a lab evaluation is to make the middle visible without inventing anything. Every lit node, counter and timing on screen comes from a real API state or a real measurement.

Three registers carry that idea:

- **Editorial serif** for things a person reads: paper titles, the answer, source passages. Answers read like a page of the paper, not a chat bubble.
- **Interface sans** for controls and labels.
- **Telemetry mono** for anything a machine reports: chunk counts, latencies, IDs, the event stream.

## Color

Ink-dark by default (better contrast for a demo at night or on a dim projector), paper-light on `T`. One warm **signal** color means "work is happening right now": active nodes, marching edges, travelling packets, the progress bar, citation chips. **Ready** green means finished, **danger** coral means failed or gated. Nothing else competes for attention.

Service nodes carry a thin stripe in their category color (compute, storage, database, messaging, AI, networking, client) so the architecture can be read at a glance. These categories echo the convention cloud diagrams use, without copying any vendor artwork.

## Layout

```
┌ topbar ─ brand · region · API · live pill · toggles ─────────────────────┐
├ live architecture: two lanes (Ingest, Ask), 16 nodes, presigned-PUT arc ─┤
├ library ─┬─ reader (PDF, ingest stats) ──────────┬─ ask thread + composer ┤
└ event stream (collapsible) ──────────────────────────────────────────────┘
```

The page is an app shell: it fills the viewport and panels scroll inside themselves, so the architecture, the paper and the answer are visible together. Below 1400 px the side columns narrow; below 840 px of height the architecture caption and legend hide and the composer tightens; below 1100 px the library becomes a horizontal strip; below 900 px everything stacks. The architecture can be hidden with `A` when screen space is short.

## Motion

Motion only encodes state: marching dashes and packets on edges that are carrying work, a halo on active nodes, a sweep on indeterminate progress, a short reveal as an answer arrives, a page pill when the reader jumps. `prefers-reduced-motion` turns all of it off.

## Components

- **Topology node**: rounded box, category stripe, title, live mono metric, status dot. States: idle, active, done, error, gated (the Textract tag). Click or Enter opens a service card with role, configuration from `template.yaml`, and the live metric.
- **Paper row**: serif title, mono metadata, state label (Index, n/total, Ready, Failed) and a hairline progress bar while indexing.
- **Turn**: question, four-step timeline with measured timings, serif answer with citation chips, evidence ribbon, source cards with similarity bars. Retrieved but uncited sources are dimmed and labelled.
- **Evidence ribbon**: one cell per page (pages are binned beyond 60), opacity scaled by the best cosine similarity on that page, a dot under pages the answer cites. Clicking a cell opens that page.
- **Event stream**: timestamp, kind (HTTP, STATE, OK, ERROR), message, latency.

## Rules

- Show real state; never animate progress that the API has not reported.
- Keep the answer, its citations and the cited page reachable in one click.
- Model and PDF text is always inserted as text nodes, never as HTML.
- AWS credentials stay in the local server; the page only calls `127.0.0.1`.
- Do not imply OCR works: the Textract gate is labelled wherever extraction is shown.
