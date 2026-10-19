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
| Bleed rendering | Fractional mask/clip antialias seams appeared between original artwork and mirrored PDF edges. Reflections now overlap by 0.5 point while reusing source resources; the center artwork is drawn last. |
| Small screens | At 375 px, a 310 px sidebar left a 65 px artwork pane. Preview and controls now stack, with full-width artwork and reachable export actions. |
| Short windows | Export controls could crowd the editable panel out of view. The tool panel has its own scroll area; mobile uses normal page scrolling. |
| Keyboard access | Upload zones and thumbnails were clickable containers; the canvas required dragging. They now use keyboard controls, with arrow-key stamp movement and resize, visible focus, named switches, and labeled navigation/zoom buttons. |
| Feedback and appearance | Blocking alerts were replaced with visible, announced messages. Focus on switches, reduced-motion support, muted-text contrast, and dark-theme header text were corrected. |
| Customer proofs | Non-Latin filenames or IDs could throw a standard-font encoding error, and header fields could overlap. Unsupported label characters are substituted, the artwork stays intact, and header rows have separate space. |
| Deployment and docs | The interface language was marked Korean despite English copy; the header favicon ignored the hosting base. Both were corrected. README instructions now match the current controls, processing paths, tests, and worker. |

## Verification

- Unit suite: 50 passing tests, including shared geometry, page targeting, rotated stamp coordinates, invalid crops/files, rotated/Unicode customer proofs, preserved layer references/output intents/blending spaces, print requirement checks, and compatibility resolution/memory limits.
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
| Flattening of optional content layers | Explicit compatibility output bakes saved display visibility into opaque RGB artwork. Normal export retains layer configurations; print visibility still needs operator review. |
| Full multilingual proof labels | Standard proof fonts cannot represent every Unicode character. Unsupported label glyphs become `?`; embedding a licensed multilingual font would preserve those labels exactly. Source artwork is unaffected. |
| Very large/complex PDFs and arbitrary custom PDF structures | Processing still happens in browser memory. The 250 MB PDF limit prevents known excessive allocations; it does not guarantee every smaller complex file will fit. Password entry, PDF/X/output intents, arbitrary custom stamp coloring, annotations during rebuilt output, and nonstandard UserUnit handling need dedicated workflows. |
| Automated visual fidelity and cross-browser coverage | Current automation uses Chrome; PDF renders were reviewed manually. Firefox/Safari, assistive-technology testing, and a press/RIP comparison remain separate checks. |
| Saving sessions, per-page crop settings, batch processing, and guided crop-mark detection | Potential product additions; current state is session-only and crop/bleed settings are global. These require workflow decisions rather than an inferred default. |
| CSS maintenance | Existing historical style overrides remain. A stylesheet consolidation can be done separately with screenshot comparisons; functional fixes were made in the active selectors. |

See README **Verification** for runnable commands. These findings describe the reviewed workflows; they are not certification that every PDF structure or press configuration is supported.

## Disappearing artwork / printer compatibility update

The operator reported disappearing objects, gradients, and a white logo, and supplied three real PDFs. Two single-page letter menus contain live transparency and RGB artwork. The two-page 5×10-inch flyer is already PDF 1.3/PDF/X-1a; its white logo is a CCITT-compressed one-bit stencil painted with overprint disabled. Its problem cannot be explained simply as unflattened transparency.

The real-file render exposed a missing-asset bug: PDF.js could not initialize its CCITT/JBIG2 decoder, logged warnings, and omitted the stencil from the browser preview and initial appearance export. Local WASM/JS decoder assets are now bundled under stable filenames and supplied through `wasmUrl`, including image decoders, ICC support, and PostScript shading functions. Decoder errors are no longer silently ignored (`stopAtErrors: true`). Decoder licenses accompany the assets. This fixes the app's missing logo; the external printer/RIP cause still requires a test print.

### Masked artwork bleed seam correction

A subsequent real mirrored-menu export showed white seams at the trim joins when rendered at 150%. The existing 0.1-point overlap did not fully cover fractional clip and alpha-mask edges. At a uniform teal top edge, the faulty render produced RGB 199/240/242 along the join instead of the artwork's 9/191/199. Increasing the reflection/clip overlap to 0.5 point restores the source color there at render scales 1, 1.5, 2, and 4. Page geometry stays unchanged, the source artwork is drawn last, and normal export continues to reuse source PDF vectors, ICC images, and masks.

Added a generated full-page alpha-mask background regression that checks both sides of all four joins and corners at those scales. Browser/UI export, the 50-unit-test suite, lint/build, and Poppler box/image-resource checks passed. The corrected real menu was downloaded through the app; it retains the 629×810 pt page and 9/9→620/801 trim box, and reuses the source ICC image/mask rather than adding RGB strips. Browser and Poppler renders were inspected. The user's exact viewer/RIP was not supplied, so its final print still needs an operator check.

Added an explicit **Flatten visible artwork (RGB)** export, defaulting to 600 DPI with a 300 DPI option. This requested appearance fallback is the exception to the normal resource-preserving PDF invariant. It creates opaque page images before existing crop/bleed operations, then applies vector Union Bugs. It retains boxes/rotation, resets to preserve mode on new uploads, invalidates stale production reports when changed, records mode/resolution in reports, and uses distinct production filenames. No new runtime dependencies were added.

The tradeoffs are visible beside the control: source text/vectors and CMYK/spot separations become RGB pixels, source output profiles are removed, annotations/forms are excluded, overprint is not simulated, and original image detail cannot be recovered by raising export DPI. Page/document/canvas memory limits reject oversized work without automatic downsampling. General print checks now include PDF shadings, nested transparency groups, and opaque stencil/explicit image masks (18 checks total).

Verification includes normal vector exports with zero raster images, synthetic axial gradients with nested transparency/soft masks and a white CCITT stencil, default hidden layers, rotated nonzero page origins, multiple pages, 300/600 DPI resources, no output soft masks, vector stamps, actual UI exports/reports, and upload reset. Poppler boxes/resources and rendered source/output comparisons were checked. The GitHub Pages base-path production build was exercised with the synthetic stencil and the real flyer: `jbig2.wasm` returned HTTP 200, the logo region contained 1,408 white preview pixels, a compatibility production download completed, and no browser exceptions occurred. The real 600 DPI compatibility copies retain the menu dimensions (611×792 pt) and both flyer's 402×762 pt media boxes, 21/21→381/741 trim, and 12/12→390/750 bleed. Final outputs are approximately 3.46 MB, 1.99 MB, and 7.30 MB; the white logo is visible in the final flyer render. Color appearance differs from the source CMYK rendering, as expected for the RGB fallback. These are local test copies, not press-color-certified replacements.

## Direct preflight repairs

Preflight findings now offer **Apply flattening repair (RGB)** for troublesome transparency, gradients, image masks and saved optional-layer visibility. This explicit action uses the existing compatibility engine to replace the working PDF, refresh the preview and rerun checks. Normal bleed/overprint/page-removal operations continue preserving PDF resources. The repair's RGB conversion and annotation/form omission are disclosed before use; applied repair metadata stays in reports and filenames, omitted interactive appearances remain a warning through subsequent source/production scans, and **Reset Artwork** restores the original. Keeping repaired artwork avoids flattening it a second time during export.

**Add Mirror Bleed** now schedules the selected job requirement, preserving any larger enabled extension and translating custom stamp positions consistently. Source findings describe the pending export instead of claiming the uploaded PDF has changed. The operator can check and download production output. Insufficient pending bleed retains its repair action. Blank-page placement state changes only after the corrected file has loaded successfully; unsuccessful post-repair scans display an error instead of implying verification succeeded.

Verification: 50 unit tests, lint/build, normal browser regression and Poppler regression passed. The compatibility browser regression additionally applied a direct 600 DPI repair to a gradient/soft-mask/white-CCITT-stencil fixture with an annotation, reanalyzed it, checked production output, downloaded the repaired PDF/report, restored the original and applied 5 mm bleed. Reports showed the four live-effect checks passing, RGB repair metadata and the retained annotation warning. Poppler confirmed opaque RGB artwork at 600 DPI, unchanged 252×144 pt boxes and no new stamp image; the 5 mm repair retained original vector resources and produced the required trim inset. Source/output renders, normal vector/stamp output and desktop/mobile repair controls were inspected. No browser exceptions occurred. The two exact named specification fixtures remain unavailable; synthetic equivalents cover their geometry as documented above. Actual printer/RIP behavior is not certified.

## 2026-10-19 — Phase 0 correctness and Phase 8 CI

Implemented only the dispatched Phase 0 and Phase 8 scope from `take-a-look-at-ticklish-steele.md`, reverified against `8b304b7`. `src/components/PreflightPanel.jsx` and `src/index.css` are unchanged.

Operator-visible change: PDFs without explicit TrimBox/BleedBox metadata now request review rather than reporting a red bleed failure. Review uses the existing yellow warning status because the reserved report component supports only pass/warning/error/info. Explicit insufficient bleed still holds the job; an explicit additive mirror-bleed action remains available. The configured minimum DPI now holds jobs, with a separate advisory below 150 DPI when a deliberately lower job target is met. Unmeasurable images retain their own finding alongside measured low-resolution results. Order-size findings retain page consistency details.

Registration (`/All`) and `/None` separations are reported. Painted registration artwork holds the job; explicitly tagged `/Artifact` printer marks are exempt, while untagged registration marks require operator inspection. This does not add geometric mark inference. Geometry validation uses MediaBox for TrimBox/BleedBox/ArtBox containment and separately notes viewer CropBox clipping. PNG/JPEG dimensions are checked from headers before browser decoding, using the existing 16384-edge/40-MP guard; processed preview/export dimensions, canvas allocation and PNG encoding failures are also guarded. Frozen visual-crop UI branches, customer-text console logging and six unreferenced root scripts were removed. The favicon now respects Vite's base path.

Plan correction for 0.6: installed PDF.js 5.7.284 already applies UserUnit inside PageViewport. Multiplying it again would be incorrect. Compatibility memory checks now use the same actual PDF.js viewport as rendering; full/partial repair tests verify retained UserUnit/boxes/rotation and physical DPI. The browser fixture with UserUnit 10 emits 1500×750 pixels on a physical 5×2.5-inch page at 300 DPI.

Verification:

- Baseline: 63 unit tests and clean lint. All five committed Playwright scripts passed before changes, using this worktree's dev/production servers.
- After changes: 81 unit tests; lint/build; all five Playwright scripts, including oversize-image upload rejection, no-box multi-page review, white zero-ink knockout, source-resource preservation, crop/bleed/stamp placement, compatibility repair and upload reset.
- Poppler `pdfinfo -box`, `pdfimages -list` and `pdftoppm` passed before and after for all 18 existing vector fixtures. Eight representative normal/stamp renders are pixel-identical: card/judge bleed, all rotated variants, masked mirror edges and both white-knockout paths. Their contact sheet was visually inspected. Artifacts and logs are in ignored `output/phase0-before/` and `output/phase0-after/`.
- Compatibility UserUnit output includes a box/resource report and rendered image under `output/phase0-after/user-unit-300dpi*`. Effective DPI is computed using retained UserUnit because Poppler's image-list DPI column does not account for it.
- `actionlint` accepts both workflows. GitHub Actions run `39295212583` deliberately failed its added smoke test; build, browser and version jobs were skipped. The temporary failure was then removed. Auto-version's actual shell steps were also exercised against a temporary local bare remote: a verified SHA bumped and pushed 2.0.19→2.0.20; a stale SHA did not authorize another bump. The real repository version remains 2.0.19.

CI runs `npm ci`, lint, tests and build on PRs and main. Its separate browser job runs all five Playwright scripts and Poppler checks, retaining evidence as an artifact. Only successful main runs call the reusable auto-version workflow; it operates on the verified SHA and never rebases onto unchecked code.

Limit: a real multi-page customer PDF without explicit TrimBox metadata was not supplied for this round; generated multi-page fixtures cover that shape. Actual printer/RIP behavior is not certified. Phases 1–7 remain deferred.
