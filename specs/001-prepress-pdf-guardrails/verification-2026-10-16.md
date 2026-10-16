# Preflight issue fixes — verification

Tested against the working checkout based on `a106b8f`, which is newer than the issue report's `d9b4fda`.

## Coverage

| Report items | Result |
| --- | --- |
| 1–3, 7–8 | Type0 descendant font programs and Type3 exclusion covered, including nested Forms. Tokenized scans ignore strings, hex, comments and inline-image data. Form transforms carry through image DPI checks. RGB operators and three-channel ICC resources report page numbers. Vector painting prevents blank-page classification. |
| 4 | Painted overprint is informational; white DeviceGray/RGB/CMYK fills and strokes with overprint are errors. Form inheritance and graphics-state save/restore are checked. Blanket overprint removal was deleted. |
| 5, 14 | Explicit order presets/custom dimensions check all finished pages. Matching order-plus-bleed bounds offer an explicit box-setting repair; existing TrimBoxes remain authoritative. No order means no inferred trim. |
| 6 | A transparency group alone or unused graphics state no longer triggers transparency. Used opacity, blend modes and soft masks still do. |
| 9–10 | Normal crop/bleed/stamp output retains PDF resources. Direct RGB repair affects only the displayed page and records per-page DPI; untouched pages retain original content. Whole-document compatibility output remains an explicit last resort. Stamp tints emit CMYK operators and preserve strings/image payloads. |
| 11–13, 15 | Encryption has a clear unencrypted-copy instruction. Blank deletion confirms all page numbers and retains at least one page; annotated pages are retained. Below 150 DPI is an error. Source bytes and read-only pdf-lib documents are cached; editing uses fresh copies. |
| 16–19 | Existing interface labels, bundled worker and updated package/README were already present. Safe-zone inset is configurable. Default stamp loading is deferred until stamping is enabled and uses `VITE_DEFAULT_STAMP_URL` or a custom upload. |

## Commands and evidence

- `npm test`: 55 passing tests, including tokenizer/state, tinting, cache/encryption and order geometry tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- `PLAYWRIGHT_MODULE=/tmp/preflight-browser/node_modules/playwright node scripts/verify-browser.cjs`: passed. Includes real app uploads, scans and downloads, order-box repair, canceled/confirmed blank removal, nested Type0/ICCBased resources, RGB page numbers, and white-overprint fixtures. No browser page errors.
- `PLAYWRIGHT_MODULE=/tmp/preflight-browser/node_modules/playwright node scripts/verify-compatibility.cjs`: passed. Includes direct repair/rescan/reset, annotations disclosure, masks/gradients/layers, and a selective repair with byte-identical untouched vector content.
- `python3 scripts/verify-pdf.py`: passed. `pdfinfo -box` and `pdfimages -list` checked the expected geometry and zero raster resources for normal vector fixtures, including real UI order-box and blank-removal downloads. `pdftoppm` generated previews.
- Selective repair: `pdfimages -list output/audit/partial-repair.pdf` lists exactly one 1050 × 600 RGB image on page 1 at 300 DPI; page 2 stays vector. `pdfinfo -box` retains two pages with the expected bounds.
- Visually inspected rendered order-box output, retained vector path page, stamped card/judge bleed output, both selective-repair pages, and the direct-repair UI screenshot. Stamp visibility, retained artwork and edge coverage were correct.

Generated PDFs, screenshots, JSON reports and Poppler inspections are in ignored `output/audit/`. Tiny generated vector fixtures grow when they embed the existing roughly 118 KB stamp PDF; normal exports add no page raster images.

## Limits and deferred scope

The two customer PDFs named in the guardrails were unavailable at their documented Downloads paths. Generated 252 × 144 pt no-bleed and 378 × 666 pt already-bleeded fixtures covered the required box geometry; the original customer artwork was not verified. Browser checks used the development app; the production bundle was built but not deployed.

Inline-image end markers remain delimiter-based and trigger an incomplete-inspection warning. White-overprint detection covers direct device-color fills/strokes/text, not every pattern, ICC white or image-mask case. Custom stamp CMYK tints are unprofiled approximations, not press-profile conversions. RGB repair still loses vectors/ink separations on the explicitly repaired page and removes document output-profile/PDF-X promises.

The separate MVP backlog was not implemented. Existing vector bleed and customer proof behavior were retained.

## Deployment module recovery

An older v2.0.11 tab requested `/assets/pdfProcessor-DmVe2dAC.js` after the live site moved to v2.0.12. That URL returned `200 text/html` (the SPA fallback); the current `/assets/pdfProcessor-WSIhg5MK.js` returned `200 application/javascript`.

Added a persistent Vite preload-error banner with explicit refresh instructions, without automatic reload or changes to loaded artwork. Added HTML revalidation headers and a static 404 document to prevent missing modules from receiving SPA HTML on Cloudflare Pages.

`npm run lint`, all 55 unit tests and `npm run build` passed. `verify-module-recovery.cjs` ran against the production preview with deliberately blocked PDF imports: upload failure showed recovery guidance, refresh/reselect loaded the PDF, and a later preflight-module failure retained the canvas and still allowed a real production download. `pdfinfo -box` confirmed 252 × 144 pt boxes; `pdfimages -list` showed no image resources. Inspected the recovery banner screenshot and `pdftoppm` output. Evidence is in `output/audit/module-recovery*`. PDF processing/output code was not changed by this recovery patch.

## Decimal input editing

Bleed, manual crop inset, safe zone and order dimensions now retain local text drafts until blur/Enter; Escape cancels, and invalid drafts restore the prior value. Preview rendering has a separate busy flag so it cannot disable focused controls. Uploads, repairs, scans and exports still lock controls; export waits for the latest preview. Existing render-request cancellation remains in place.

`verify-decimal-inputs.cjs` runs against a production preview (default port 4175). It covers continuous typing with a focus/DOM-identity assertion after every character, leading decimals, middle-of-string edits/caret position, Enter/Tab commits, invalid drafts, Escape, preset synchronization, steppers, oversized-crop recovery, safe zone and order dimensions after an existing preflight result. Its real downloaded vector PDF is expected to be 267.12 × 159.12 pt after 0.020-inch inset and 0.125-inch bleed. Evidence is saved under `output/audit/decimal-inputs*`.

The decimal-input, main browser and compatibility suites passed, alongside lint, all 55 unit tests and the production build. Poppler confirmed 267.12 × 159.12 pt Media/Crop/BleedBoxes, a TrimBox inset by 9 pt, and zero image resources. Visually inspected the field UI and rendered cyan vector export. Safari and mobile-keyboard behavior were not tested.

## Printed crop-mark review and optional export marks

Pages without a distinct TrimBox now receive a bounded, rendered-pixel scan for conventional dark corner marks, including flattened image PDFs. Detection proposes an editable orange cut line; explicit confirmation changes TrimBox/BleedBox metadata only. MediaBox, CropBox, page artwork and original printed marks remain intact. Existing distinct trim remains authoritative. Missing or ambiguous marks require manual review; custom UserUnit scaling is unsupported. No bleed is inferred from the original mark margin. A separate explicit BleedBox is retained only when it contains the reviewed trim and excludes the detected marks.

The PDF-only Add crop marks option is off by default, resets on upload, and works with or without mirror bleed. Eight vector 0.25 pt K100 strokes sit outside the artwork/BleedBox with a 3 pt gap and 18 pt length. MediaBox/CropBox gain 21 pt per edge; finished trim size, artwork-relative stamp coordinates and proof artwork bounds remain unchanged. Mirror bleed still reflects the current outer artwork; a warning explains that retained old marks may be repeated. Removing that outer area requires the separate Crop to trim box choice.

- Lint, all 60 unit tests, and the production build passed.
- `verify-crop-marks.cjs` passed against development and production-preview UI. Generated fixtures cover vector and flattened marks, offset bounds, asymmetric insets, all four page rotations, missing/ambiguous marks, manual correction, existing authoritative trim, retries/dismissal, page-specific state and upload reset. UI confirmation retains the full page and leaves cropping disabled.
- The suite checks marks-only, mirror-plus-marks, explicit trim-crop-plus-marks, marks-off and byte-identical unchanged export. A rendered pixel comparison at all rotations verifies unchanged artwork, bleed and stamp placement after removing the new paper margin. Customer proofs exclude that margin. Production-result invalidation, per-page report evidence and annotations warnings are covered.
- Poppler verified Media/Crop sizes of 402 × 294 pt (marks only), 420 × 312 pt (mirror plus marks), 348 × 246 pt (crop plus mirror plus marks), and 306 × 204 pt (crop plus mirror, no marks). Bleed excludes the new 21 pt paper margin. The vector fixtures contain zero image resources. The flattened UI export preserves the original compressed image bytes and dimensions; repeated references reuse that source image rather than rasterizing the PDF.
- Existing main browser, compatibility-repair and PDF verification suites passed. Rendered UI output and rotated crop/bleed/marks output were visually inspected. Generated PDFs, screenshots and reports are under ignored `output/audit/`.

No actual customer Canva PDF was supplied. Detection remains a reviewable heuristic for axis-aligned dark corner marks; unusual, faint, incomplete or compressed marks may need manual insets. Safari and mobile were not tested.

## Actual Canva brochure regression

The subsequently supplied `RMD Brochure Proof2.pdf` reproduced an ambiguous result on both pages: the old detector admitted 778/764 horizontal/vertical artwork fragments on page 1 and 936/1303 on page 2, exceeding its safety cap. One corner mark also joined dark photo pixels. The fix requires white space beside each candidate stroke before grouping it, separating the real marks from artwork without requiring a white gap at their endpoints. The ambiguity caps remain intact. Ink-weighted centers retain antialiased edge information; right/bottom insets now exclude fractional canvas padding.

The source is two flattened 4942 × 2692 CMYK images at 300 DPI, on 1186.08 × 646.08 pt pages with no distinct TrimBox. The printed mark centers span 4800 × 2550 image pixels: 16 × 8.5 inches. Both pages now propose about 15.999 × 8.499 inches, within 0.1 pt of those spans, without rounding to a guessed order size.

Lint, all 62 unit tests, and the production build passed. The new dense-artwork regression fails with the previous detector and passes with the fix; a second regression checks subpixel centers. The full crop-mark browser/PDF suite passed against the production preview, including the actual brochure via `PREFLIGHT_RMD_SAMPLE='/Users/onp/Downloads/RMD Brochure Proof2.pdf' PREFLIGHT_PRODUCTION_URL=http://127.0.0.1:4175 PLAYWRIGHT_MODULE=/tmp/preflight-browser/node_modules/playwright node scripts/verify-crop-marks.cjs`.

The actual UI confirmed each page's suggested trim without manual edits, downloaded a production PDF, retained both original MediaBox/CropBoxes, and preserved both compressed CMYK image streams byte for byte. Poppler confirmed their original dimensions and 300 DPI; both rendered output PNGs are byte-identical to the source renders. The reviewed UI was visually inspected. Evidence is under ignored `output/audit/rmd-*`; the customer PDF is not committed. Colored or crowded mark margins still need manual review; Safari/mobile were not retested.
