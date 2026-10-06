# Application audit and fixes

Reviewed and updated on 2026-10-06. This covers the React interface, upload lifecycle, print geometry, preflight analysis, image and PDF exports, customer proofs, browser memory use, deployment assets, and project documentation.

## Implemented

| Area | Verified problem and correction |
| --- | --- |
| Image export | The preview already included bleed, but export added it again. Production PNGs and image proofs now use the processed canvas once. |
| Transparent images | Mirror-bleed previews used transparent-black pixels while the normal image preview used white paper. Cropped image pixels now use the same white background before mirroring, keeping automatic contrast consistent. |
| Image dimensions | Images implicitly used the PDF preview scale as their physical resolution. A visible DPI control now determines print size, stamp size, crop, and bleed; default is 300 DPI. |
| Output summary | The size summary used different geometry from export and could hide retained CropBox margins. Both now use the same calculation; the label is **Output Size**. |
| Manual PDF crop | Manual cropping rasterized whole pages and changed original color spaces. It now embeds and clips original PDF resources. |
| Trim geometry | Manual cropping could leave a TrimBox extending outside the output. The resulting TrimBox is the intersection of finished trim and retained artwork. |
| Rotation | Stamp placement, crop preview insets, page size comparisons, and customer proofs ignored page rotation. They now follow the visible orientation, including nonzero page origins. |
| Stamp sources | Rotated custom stamp PDFs are normalized before vector embedding. |
| Invalid crop | Negative inputs and insets that remove the whole page no longer silently produce a one-point output. Export is blocked with an explanation and editable controls. |
| Drop validation | Global drag and drop bypassed supported-file checks. All artwork entry paths now validate before replacing the session. Empty PDFs and PDFs over 250 MB are rejected early. |
| Drag feedback | Local drop targets could leave the global drag overlay active. Drop, drag completion, and window blur clear it. |
| Document replacement | Preview caches could reuse artwork from corrected PDFs or a previous document. Entries now include document identity; replacement invalidates geometry and canvases. |
| Render concurrency | Concurrent renders could share a canvas before the first render finished. The cache stores the rendering promise immediately. |
| Scan concurrency | An old preflight result could overwrite the report after a new upload. Request identifiers discard stale results and failures. |
| Stamp concurrency | Old asynchronous tint results could overwrite the current stamp. Effects discard outdated results; export waits for the current preview. |
| Reset | Reset left page positions, reports, or crop settings from the working file. It now restores a fresh session from the original upload. New uploads also reset file-derived settings. |
| Page removal | Removing the only page was possible, and page position maps could refer to shifted page numbers. The final page is protected and maps are cleared on removal. |
| Blank pages | Outlined/vector artwork without text or XObjects was flagged as blank. PDF.js painting operators, including its optimized path representation, now count as artwork. Detection is deliberately conservative. |
| Fonts | Type0 fonts with embedded descendant font programs were reported as missing. Descendant descriptors are checked. |
| Resource traversal | Inherited resources and fonts/colors inside Form XObjects were skipped. They are inspected recursively. |
| Image resolution | Images inside embedded pages could be reported as “vector only.” Nested Form transformations are included in effective DPI checks; image RGB and soft masks are detected. |
| Bleed checks | Width/height averages could pass a file with zero bleed on one side. Every edge is checked. |
| Overprint | Graphics states without `/Type /ExtGState`, including inline dictionaries, were missed. Detection and removal traverse reachable dictionaries. The wording no longer assumes every overprint is accidental. |
| Fix labels | “Outline Fonts” and “Convert to CMYK” actually rasterized pages. Those rasterization actions were removed from the print repair UI. Missing fonts need embedding/outlining in the source app; unwanted spots need a color-managed conversion. |
| Layers | Deleting `/OCProperties` is not reliable layer flattening. That fix was removed; layer visibility requires review. Geometry and proof exports now retain the catalog layer configuration and share its reference mapping with embedded artwork. Hidden content stays hidden, layers remain toggleable, and saving is supported. |
| Rasterization | Clearing shared resource dictionaries could affect unrelated pages. Each corrected page gets local resources. Rendering retains the original orientation before the page rotation is applied. |
| Bleed feedback | Applying mirror bleed left an unexplained source-file error. The report now identifies bleed scheduled for export and explains that the scan describes the source PDF. |
| Multiple pages | Unvisited pages inherited the current page's absolute alignment and color. Export now computes alignment and automatic contrast independently for every selected page. |
| Targeting | The preview displayed the stamp on excluded pages. It now follows the selected target pages. Empty selections no longer fall back to stamping the current page. |
| Export readiness | Buttons could remain enabled without a valid preview, loaded stamp, valid crop, or valid page selection. They now reflect those requirements and show the reason. |
| PDF worker | Loading required jsDelivr availability. The matching worker is bundled and uses the deployment base path. |
| Startup | PDF engines loaded with the upload screen. They now load on demand; initial JavaScript fell from about 1.11 MB / 385 KB gzip to about 269 KB / 84 KB gzip. |
| Memory | Every visited full page and every stamp tint could remain in memory. Preview caches are bounded; thumbnails render only while expanded, cancel unfinished work, and replaced PDF workers are destroyed. |
| Compression | Tinted stamp streams became uncompressed. They now remain compressed; unchanged exports without a stamp return original bytes. |
| Bleed rendering | Fractional antialias seams appeared between the original artwork and mirrored PDF edges. Reflections overlap by 0.1 point while reusing source resources. |
| Small screens | At 375 px, a 310 px sidebar left a 65 px artwork pane. Preview and controls now stack, with full-width artwork and reachable export actions. |
| Short windows | Export controls could crowd the editable panel out of view. The tool panel has its own scroll area; mobile uses normal page scrolling. |
| Keyboard access | Upload zones and thumbnails were clickable containers; the canvas required dragging. They now use keyboard controls, with arrow-key stamp movement and resize, visible focus, named switches, and labeled navigation/zoom buttons. |
| Feedback and appearance | Blocking alerts were replaced with visible, announced messages. Focus on switches, reduced-motion support, muted-text contrast, and dark-theme header text were corrected. |
| Customer proofs | Non-Latin filenames or IDs could throw a standard-font encoding error, and header fields could overlap. Unsupported label characters are substituted, the artwork stays intact, and header rows have separate space. |
| Deployment and docs | The interface language was marked Korean despite English copy; the header favicon ignored the hosting base. Both were corrected. README instructions now match the current controls, processing paths, tests, and worker. |

## Verification

- Unit suite: 47 passing tests, including shared geometry, page targeting, rotated stamp coordinates, invalid crops/files, rotated/Unicode customer proofs, preserved layer references/output intents/blending spaces, and print requirement checks.
- `npm run lint`, `npm run build`, and `git diff --check` pass.
- `scripts/verify-browser.cjs` runs real Chrome uploads, analysis, replacement, unsupported drops, independent horizontal/vertical alignment, keyboard positioning, multi-page targeting, image DPI/bleed, and production/proof downloads. It also checks nested image DPI, composite font descriptors, asymmetric bleed, blank-page safety, and overprint removal. CDN requests are blocked. No browser exceptions occurred.
- Interface screenshots cover 1440×900 dark, 375×812 light, and 812×375 dark. No horizontal document overflow was found. Rendered production PDFs and customer proofs were visually inspected.
- `scripts/verify-pdf.py` runs `pdfinfo -box`, `pdfimages -list`, and `pdftoppm`, asserts boxes/rotation and the absence of raster images in the vector fixtures, and saves inspection reports and renders under `output/audit/`.

| Output | Media/Crop dimensions | Trim coordinates | Rotation | Raster images |
| --- | --- | --- | --- | --- |
| Business card + 9 pt bleed | 270 × 162 pt | 9, 9 → 261, 153 | 0° | 0 |
| Existing bleed + 9 pt more | 396 × 684 pt | 18, 18 → 378, 666 | 0° | 0 |
| Manual 3 pt inset | 246 × 138 pt | 0, 0 → 246, 138 | 0° | 0 |
| Rotated card + bleed | 270 × 162 pt | 18, 18 → 252, 144 | 90° | 0 |
| Rotated card cropped to trim | 234 × 126 pt | 0, 0 → 234, 126 | 90° | 0 |

A real two-page `newsom 6x4 postcard.pdf` with additional bleed and vector stamps exported from 661,214 bytes to 793,861 bytes (1.201×). Its Poppler inspection retained the source image color spaces and produced no RGB bleed-strip resources. The stamp adds roughly 118 KB to tiny generated PDFs; a ratio against their sub-1 KB source is dominated by that fixed vector asset, not full-page rasterization. Tinted synthetic exports decreased from roughly 159 KB to 120 KB after stream compression.

The exact `newsom business card[51].pdf` and `Steinmeetz-for-Judge-5x9-front original.pdf` fixtures referenced by the spec were unavailable. Generated fixtures reproduce their documented dimensions and explicit boxes; the bundled Union Bug and a separate real production PDF were also used. Those two exact fixtures still need to be checked when available.


## Commercial printing update

- General commercial printing is the default; operators can set required bleed (including none) and minimum image DPI. PDF/X-4 and legacy PDF/X-1a requirement modes are also available, without claiming certification.
- Production output can be analyzed after current crop, bleed, and stamp processing. Its report is invalidated when settings change; a downloadable JSON report identifies source versus production scope.
- Added checks for finished trim/page box validity, embedded output-intent headers, PDF/X declarations, annotations/forms, and custom physical page units.
- Kept modern transparency and spot inks as information; intentional overprint is a review item, and blank-page removal requires job context. Missing fonts are errors with source repair guidance.
- Geometry/proof embedding uses one object copier for pages and catalog layers/output intents. Transparency blending groups are retained on the artwork Form XObject. Default black/white stamp tints use DeviceGray and isolated opaque knockout settings; original source overprint remains intact.
- The layered regression contains genuinely hidden red draft artwork. Browser rendering checks the saved default visibility and deliberately reveals the layer in source, bleed, crop, and proof files. Actual app bleed export and production-report downloads are checked.

Full PDF/X certification, ICC transformation/profile validation, white-overprint object analysis, total ink coverage and RIP separations are not implemented by this browser checker. Production checks cannot determine whether edge artwork is suitable bleed or whether a profile matches a particular press/paper; the job ticket and operator review remain necessary. Source annotation/form appearances are not embedded into rebuilt artwork or proof sheets. Both the source report and prepared production report identify that risk; those appearances must be flattened intentionally before those operations.

## Remaining capabilities and limits

| Capability | Status / next requirement |
| --- | --- |
| Color-managed CMYK conversion and PDF/X validation | Requires output profiles, rendering intents, and a proper prepress engine. The app now describes RGB detection and rasterization honestly. |
| True font outlining or repairing missing font programs | Requires the original fonts and a suitable font/prepress engine. The print repair UI no longer offers rasterization with substituted fonts as a font repair. |
| Reliable flattening of optional content layers | Requires preserving the source visibility configuration while rendering/flattening. The unsafe catalog-deletion action is unavailable. |
| Full multilingual proof labels | Standard proof fonts cannot represent every Unicode character. Unsupported label glyphs become `?`; embedding a licensed multilingual font would preserve those labels exactly. Source artwork is unaffected. |
| Very large/complex PDFs and arbitrary custom PDF structures | Processing still happens in browser memory. The 250 MB PDF limit prevents known excessive allocations; it does not guarantee every smaller complex file will fit. Password entry, PDF/X/output intents, arbitrary custom stamp coloring, annotations during rebuilt output, and nonstandard UserUnit handling need dedicated workflows. |
| Automated visual fidelity and cross-browser coverage | Current automation uses Chrome; PDF renders were reviewed manually. Firefox/Safari, assistive-technology testing, and a press/RIP comparison remain separate checks. |
| Saving sessions, per-page crop settings, batch processing, and guided crop-mark detection | Potential product additions; current state is session-only and crop/bleed settings are global. These require workflow decisions rather than an inferred default. |
| CSS maintenance | Existing historical style overrides remain. A stylesheet consolidation can be done separately with screenshot comparisons; functional fixes were made in the active selectors. |

See README **Verification** for runnable commands. These findings describe the reviewed workflows; they are not certification that every PDF structure or press configuration is supported.
