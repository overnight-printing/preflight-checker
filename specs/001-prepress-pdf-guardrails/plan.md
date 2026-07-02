# Implementation Plan: Prepress PDF Guardrails

**Branch**: `main` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-prepress-pdf-guardrails/spec.md`

## Summary

Protect preflight-checker from drifting away from production-safe PDF behavior. The app must rely on explicit PDF boxes for trim/bleed metadata, allow user-requested additional bleed, preserve PDF resources for normal PDF export, keep Union Bug output visible and vector, reset stale upload state, and require real PDF verification before fixes are called complete.

## Technical Context

**Language/Version**: JavaScript with React and Vite

**Primary Dependencies**: `pdf-lib`, `pdfjs-dist`, React, Vite

**Storage**: Browser state only for the app; repository specs under `specs/`

**Testing**: `npm run lint`, `npm run build`, plus Poppler verification with `pdfinfo -box`, `pdfimages -list`, and `pdftoppm`

**Target Platform**: Browser-based print preflight and proofing UI

**Project Type**: Frontend web application with in-browser PDF processing

**Performance Goals**: Keep normal PDF-preserving exports in a practical file-size range and avoid repeated uploads or stale canvas renders.

**Constraints**: Do not damage print quality, color spaces, vector Union Bug output, or PDF page geometry. Avoid full-page rasterization unless a user-selected operation truly requires it.

**Scale/Scope**: Single and multi-page customer PDFs used in print production; representative fixtures are listed in [spec.md](./spec.md).

## Constitution Check

The project constitution is still the default template and does not define enforceable gates. Until it is replaced, this plan treats the PDF guardrails in [spec.md](./spec.md) as mandatory project gates for any PDF geometry, mirror bleed, upload, or export change.

## Project Structure

### Documentation (this feature)

```text
specs/001-prepress-pdf-guardrails/
├── spec.md
├── plan.md
├── quickstart.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── App.jsx
├── components/
│   ├── ControlPanel.jsx
│   ├── EditorCanvas.jsx
│   └── PreflightPanel.jsx
└── utils/
    └── pdfProcessor.js

public/
├── union-bug-black.pdf
└── union-bug-white.pdf
```

**Structure Decision**: PDF geometry, rendering, bleed, and export behavior live primarily in `src/utils/pdfProcessor.js` and the associated React state/UI in `src/App.jsx` and `src/components/`. This spec is the guardrail source for future changes in those files.

## Required Design Decisions

- Explicit PDF box metadata is authoritative.
- Dimension-pattern heuristics are forbidden for included bleed detection.
- User-selected mirror bleed is additive outside the current output base.
- Normal PDF exports must preserve PDF resources and avoid RGB PNG edge strips.
- Union Bug must be drawn after bleed/background operations and remain vector in PDF output.
- New uploads must clear file-derived state before rendering the next file.
- Verification evidence must include PDF boxes, image resource lists, and rendered visual output for affected fixtures.

## Verification Gates

Every future change touching PDF box handling, mirror bleed, Union Bug placement, upload state, or PDF export must include:

1. `npm run lint`
2. `npm run build`
3. `pdfinfo -box` on affected PDF output
4. `pdfimages -list` on affected PDF output
5. `pdftoppm` render and visual inspection
6. A written note if browser automation or actual app export could not be completed

## Complexity Tracking

No complexity violations are approved by default. Any future raster fallback, file-size increase, or heuristic metadata inference must be explicitly justified against [spec.md](./spec.md).
