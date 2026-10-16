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
