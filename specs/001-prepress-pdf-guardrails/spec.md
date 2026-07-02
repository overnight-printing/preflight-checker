# Feature Specification: Prepress PDF Guardrails

**Feature Branch**: `main`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Record all PDF/bleed/Union Bug bugs, required features, limits, and forbidden behaviors so future development does not drift."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trust PDF Geometry (Priority: P1)

A print operator uploads PDF artwork and needs the app to report the real trim, crop, bleed, and final output sizes without inventing missing bleed metadata.

**Why this priority**: Incorrect geometry creates bad proofs, wrong print size, wasted material, and broken customer trust.

**Independent Test**: Can be tested by uploading known PDFs with and without explicit TrimBox/BleedBox metadata and comparing the app's displayed geometry with `pdfinfo -box`.

**Acceptance Scenarios**:

1. **Given** a `3.5 x 2 in` business card PDF whose MediaBox, CropBox, TrimBox, BleedBox, and ArtBox are all `252 x 144 pt`, **When** the file is uploaded, **Then** Final Trim is `3.5 x 2 in` and the UI does not show "Mirror Bleed Included".
2. **Given** a PDF with a real TrimBox smaller than its CropBox/BleedBox, **When** the file is uploaded, **Then** the app uses the actual PDF boxes to show included bleed and trim dimensions.
3. **Given** a PDF whose page dimensions merely look like a common trim plus `0.125 in`, **When** the PDF lacks distinct TrimBox/BleedBox metadata, **Then** the app must not infer included bleed from page dimensions alone.

---

### User Story 2 - Add Bleed Without Color or Quality Damage (Priority: P1)

A print operator enables mirror bleed and expects the selected bleed amount to be added outside the current artwork, even if the PDF already contains bleed.

**Why this priority**: Operators may intentionally add more bleed to already-bleeded artwork; blocking that action or rasterizing the art is unacceptable.

**Independent Test**: Can be tested by exporting a known PDF with mirror bleed enabled and verifying output boxes, visual edge mirroring, image resources, color space, and file size.

**Acceptance Scenarios**:

1. **Given** a `5.25 x 9.25 in` PDF that already contains `0.125 in` bleed around a `5 x 9 in` trim, **When** the operator enables an additional `0.125 in` mirror bleed, **Then** the output canvas/page is `5.5 x 9.5 in` and the TrimBox represents the original finished trim inside both bleed layers.
2. **Given** a CMYK/ICC PDF, **When** mirror bleed is added, **Then** the app reuses original PDF page resources for PDF-preserving output and must not add RGB PNG strips over the artwork.
3. **Given** a PDF export with mirror bleed and Union Bug enabled, **When** the output is inspected, **Then** the Union Bug appears in the final PDF and the base artwork is not flattened to a lower-quality image.

---

### User Story 3 - Preserve Union Bug Placement and Vector Quality (Priority: P1)

A print operator places a Union Bug in the preview and expects it to land in the same relative output location with crisp vector quality.

**Why this priority**: Preview/output mismatch creates unusable proofs and forces manual rework.

**Independent Test**: Can be tested by placing the Union Bug on known coordinates with and without bleed/crop options, exporting, and comparing rendered output position against preview coordinates.

**Acceptance Scenarios**:

1. **Given** a Union Bug PDF and artwork PDF, **When** the operator exports with mirror bleed enabled, **Then** the Union Bug is drawn after bleed/background operations and remains visible in the output.
2. **Given** a vector Union Bug PDF, **When** the app exports to PDF, **Then** the Union Bug remains vector unless the source mode explicitly requires image export.
3. **Given** per-page placement settings, **When** exporting current, first, last, or all pages, **Then** each selected page uses its saved placement and size.

---

### User Story 4 - Reset Artwork State on New Upload (Priority: P1)

A print operator uploads one file, then uploads a different file, and expects the canvas, artwork cache, page geometry, and preview to switch immediately to the new file.

**Why this priority**: Stale artwork or requiring a second upload makes the app unreliable during production work.

**Independent Test**: Can be tested by uploading two visually different PDFs in sequence and confirming the second preview appears on the first upload attempt with no stale artwork.

**Acceptance Scenarios**:

1. **Given** PDF A is loaded and visible, **When** PDF B is uploaded, **Then** PDF A's preview, cached canvases, box metadata, page count, and color extraction state are cleared before PDF B renders.
2. **Given** a new file upload completes, **When** the preview updates, **Then** the operator must not need to upload the same file twice.
3. **Given** the previous file had bleed/crop/bug placement state, **When** a new file is uploaded, **Then** file-specific derived state must not leak unless it is an intentional global preference.

---

### User Story 5 - Keep Output Practical for Print Production (Priority: P2)

A print operator needs exported proof files to stay close to the original quality and a reasonable file size.

**Why this priority**: A proof that balloons from about `5 MB` to `40+ MB`, changes color, or loses detail is not production-safe.

**Independent Test**: Can be tested by exporting representative PDFs and comparing file size, image resource list, page boxes, and rendered preview.

**Acceptance Scenarios**:

1. **Given** a single-page raster PDF around `5 MB`, **When** mirror bleed and Union Bug are added, **Then** output should remain in the same practical size range unless the operation truly requires rasterization.
2. **Given** a PDF-preserving path is possible, **When** exporting, **Then** the app must prefer PDF resource reuse over full-page PNG rasterization.
3. **Given** output file size grows by more than roughly `3x`, **When** the change is reviewed, **Then** the implementation must justify the growth with a specific unavoidable reason and provide test evidence.

### Edge Cases

- PDFs with all page boxes identical must be treated as having no distinct trim or bleed metadata.
- PDFs with explicit TrimBox/BleedBox differences must use the explicit boxes, not guessed dimensions.
- Already-bleeded PDFs may still receive additional user-requested bleed.
- PDFs without explicit boxes must not be silently treated as bleed-included based on common print dimensions.
- Multi-page PDFs may have different page boxes and placements; calculations must be page-specific.
- Manual crop and interactive crop may require raster fallback, but that fallback must be isolated from normal PDF-preserving export.
- Image exports may be raster by nature, but PDF exports must avoid rasterizing the main page when PDF resources can be preserved.
- Large PDFs must fail safely with a clear browser-limit message rather than producing partial or broken output.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST use actual PDF box metadata to detect distinct trim and bleed. Distinct means the relevant PDF boxes differ by more than a small tolerance.
- **FR-002**: The system MUST NOT infer included bleed from page dimensions alone.
- **FR-003**: The system MUST report a PDF with identical MediaBox, CropBox, TrimBox, BleedBox, and ArtBox as having no distinct included bleed.
- **FR-004**: The system MUST show Final Trim based on the actual TrimBox only when a distinct TrimBox exists; otherwise it MUST use the current visible PDF page box.
- **FR-005**: The system MUST treat the user's mirror bleed setting as an amount to add outside the current output base, not as a total bleed cap.
- **FR-006**: The system MUST allow additional mirror bleed even when a PDF already has explicit or visually included bleed.
- **FR-007**: For PDF-preserving exports, the system MUST reuse original PDF page resources for added mirror bleed instead of generating RGB PNG strips.
- **FR-008**: The system MUST NOT cover CMYK/ICC artwork edges with RGB canvas-generated strips in PDF output.
- **FR-009**: The system MUST keep the Union Bug in the PDF output when Union Bug export is enabled, including when mirror bleed is also enabled.
- **FR-010**: The system MUST draw the Union Bug after bleed/background operations so it cannot be hidden by added bleed.
- **FR-011**: The system MUST preserve vector Union Bug output for PDF exports whenever the Union Bug source is a PDF.
- **FR-012**: The system MUST clear file-specific artwork, box metadata, page cache, preview canvas, and derived color state before rendering a newly uploaded file.
- **FR-013**: The system MUST render a newly uploaded file on the first upload attempt without requiring a second upload.
- **FR-014**: The system MUST keep geometry dashboard labels aligned with the actual export behavior.
- **FR-015**: The system MUST keep file-size growth within a practical print-production range for normal PDF-preserving operations.
- **FR-016**: The system MUST run a PDF verification checklist for changes that touch PDF box handling, mirror bleed, Union Bug placement, upload state, or export file generation.
- **FR-017**: The system MUST verify representative outputs with `pdfinfo -box`, `pdfimages -list`, and a rendered visual preview before claiming a PDF export fix is complete.
- **FR-018**: The system MUST document any remaining browser automation or direct app export verification gaps when they cannot be completed.

### Required Regression Fixtures

- **No-bleed business card**: `/Users/onp/Downloads/newsom business card[51].pdf`; expected page and trim size `252 x 144 pt` (`3.5 x 2 in`), no included bleed.
- **Already-bleeded judge card**: `/Users/onp/Downloads/Steinmeetz-for-Judge-5x9-front original.pdf`; expected source page `378 x 666 pt` (`5.25 x 9.25 in`) and user-requested additional `9 pt` bleed should output `396 x 684 pt` (`5.5 x 9.5 in`).
- **Union Bug source PDFs**: `public/union-bug-black.pdf` and `public/union-bug-white.pdf`; expected vector placement in PDF output.

### Forbidden Behaviors

- **FB-001**: Do not guess that a PDF has bleed because its dimensions match common print math.
- **FB-002**: Do not hide the bleed size input merely because the source has included bleed.
- **FB-003**: Do not skip user-requested additional bleed just because the source already has bleed.
- **FB-004**: Do not rasterize the full PDF page for normal mirror bleed plus Union Bug export.
- **FB-005**: Do not convert PDF artwork edges to PNG/RGB strips when the original PDF resources can be reused.
- **FB-006**: Do not claim a fix is verified without checking actual PDF boxes and rendered output.
- **FB-007**: Do not let previous uploads leave stale artwork, page boxes, or preview state on the next upload.
- **FB-008**: Do not allow output file size blowups without explicit evidence and justification.

### Key Entities *(include if feature involves data)*

- **PDF Page Geometry**: MediaBox, CropBox, TrimBox, BleedBox, ArtBox, page rotation, and page-specific dimensions used for preview and export.
- **Bleed Operation**: User-selected amount, source base box, output Media/Crop/BleedBox, output TrimBox, and whether the operation preserves PDF resources or falls back to raster.
- **Union Bug Placement**: Page-specific position, size, selected color, source PDF, enabled state, and target page selection.
- **Artwork Session State**: Current file, file type, page count, current page, preview canvas, cached page renders, PDF box info, color extraction, and crop guides.
- **Verification Result**: Expected boxes, actual boxes, image resource list, file size comparison, rendered preview path, and unresolved verification gaps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The no-bleed business card fixture displays Final Trim `3.5 x 2 in` and no included bleed indicator on first upload.
- **SC-002**: The already-bleeded judge-card fixture with additional `0.125 in` mirror bleed exports as `5.5 x 9.5 in` with a TrimBox corresponding to the original `5 x 9 in` finished trim.
- **SC-003**: Representative PDF-preserving mirror bleed exports contain no newly generated RGB PNG edge strips.
- **SC-004**: Union Bug appears in the final rendered PDF when enabled, including with mirror bleed enabled.
- **SC-005**: Uploading PDF B after PDF A shows PDF B on the first upload attempt in 100% of regression runs.
- **SC-006**: Normal PDF-preserving output stays within about `3x` the original file size unless an explicit documented exception is approved.
- **SC-007**: Every future PR or direct commit touching PDF export includes evidence from `pdfinfo -box`, `pdfimages -list`, and rendered visual inspection for affected fixtures.

## Assumptions

- The app is a browser-based React/Vite preflight and proofing tool used in a print-production workflow.
- PDF output quality and prepress correctness are more important than clever automatic inference.
- Explicit PDF boxes are authoritative; visual or dimension-based guesses are not authoritative unless the operator explicitly asks for a manual crop or trim.
- Additional bleed means additional bleed outside the current output base, not "ensure the final file has this total amount of bleed."
- PDF exports should preserve source PDF resources whenever possible; raster fallback is acceptable only for operations that inherently require rasterization.
- User-facing geometry labels are part of the production contract and must match exported PDF boxes.
