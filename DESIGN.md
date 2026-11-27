---
name: UCS531 PDF Q&A
description: An operator-facing lab interface for a live, page-cited AWS PDF question answering pipeline.
colors:
  canvas: "#071923"
  surface: "#0d2630"
  surface-strong: "#12313b"
  surface-hover: "#19404a"
  border: "#31505a"
  border-soft: "#26444e"
  text: "#f2f6f4"
  muted: "#acc2c6"
  quiet: "#8faab0"
  mint: "#8fe3d0"
  mint-deep: "#173b39"
  error: "#ffc0b4"
  error-background: "#452c2c"
typography:
  display:
    fontFamily: "Avenir Next, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.65rem, 4.2vw, 4.7rem)"
    fontWeight: 760
    lineHeight: 1.06
    letterSpacing: "-.047em"
  body:
    fontFamily: "Avenir Next, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.5
  label:
    fontFamily: "Avenir Next, Segoe UI, system-ui, sans-serif"
    fontSize: ".75rem"
    fontWeight: 700
rounded:
  panel: "16px"
  control: "11px"
components:
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "26px"
  button-primary:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-sample:
    backgroundColor: "{colors.mint-deep}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "15px 18px"
---

# Design System: UCS531 PDF Q&A

## Overview

**Creative North Star: "The Visible Pipeline"**

The interface should let an evaluator understand what is happening in AWS while Aryan operates the demo. Its dark navy canvas and mint signals extend the existing presentation deck. The layout is compact enough to keep the paper, job state, question, answer, and sources in one view without making asynchronous work look instantaneous.

## Colors

Mint marks actions, current pipeline stages, ready states, links, and source references. Navy tonal layers distinguish the canvas, panels, and controls. A warm error pair is reserved for failed or unavailable states. The frontmatter values reflect the actual CSS custom properties in `demo_ui/static/style.css`.

## Typography

The display headline uses a large, tightly tracked system font stack. Body copy stays at normal tracking; wide tracking is reserved for brief uppercase metadata labels. Source excerpts and answer text use comfortable line spacing for reading during a presentation.

## Layout

At desktop widths the paper and document status occupy the left column, while question, answer, and source pages occupy the right. The five-stage pipeline spans both columns. Below 950px the work area stacks; below 760px the stages wrap into two columns so all five remain visible without horizontal scrolling.

## Elevation & Depth

Depth comes from tonal surfaces and thin borders, without drop shadows. This keeps progress, status, and cited text more prominent than decoration.

## Shapes

Panels use softly rounded corners; controls use a slightly tighter radius. Status chips are pill-shaped. Thin rules and progress lines express the sequence of work.

## Components

The sample-paper button is the first-run path. The primary answer button uses solid mint; the upload button and preset questions are quieter until available. Document and answer chips show real state from the API. Source cards disclose excerpts and a PDF page link when the selected file is available locally. Focus outlines and reduced-motion behavior are defined in the stylesheet.

## Do's and Don'ts

- Show actual job state and source evidence before presenting a result as complete.
- Preserve the two-column relationship between paper status and answer evidence on desktop.
- Use uppercase tracking only on short labels.
- Keep answer content as text and link only recognized source citations.
- Do not imply OCR works for scanned PDFs in the current AWS account.
