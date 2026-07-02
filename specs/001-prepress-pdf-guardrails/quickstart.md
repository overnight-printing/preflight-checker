# Quickstart: Prepress PDF Guardrails

Use this checklist before claiming any PDF geometry, mirror bleed, upload reset, or Union Bug export fix is complete.

## Required Commands

```bash
npm run lint
npm run build
```

## Fixture Checks

### No-Bleed Business Card

Fixture:

```text
/Users/onp/Downloads/newsom business card[51].pdf
```

Expected:

- Page boxes are all `252 x 144 pt`
- Final Trim is `3.5 x 2 in`
- Included bleed indicator is false
- No automatic trim inference to `3.25 x 1.75 in`

Commands:

```bash
pdfinfo -box "/Users/onp/Downloads/newsom business card[51].pdf"
```

### Already-Bleeded Judge Card With Additional Bleed

Fixture:

```text
/Users/onp/Downloads/Steinmeetz-for-Judge-5x9-front original.pdf
```

Expected when adding `0.125 in` mirror bleed:

- Source page is `378 x 666 pt`
- Output page is `396 x 684 pt`
- Output TrimBox represents the original `5 x 9 in` finished trim inside both bleed layers
- No RGB PNG edge strips are added to normal PDF-preserving output
- Union Bug remains visible and vector when enabled
- Output file size remains in a practical range

Commands for exported output:

```bash
pdfinfo -box "/path/to/output.pdf"
pdfimages -list "/path/to/output.pdf"
pdftoppm -png -r 72 "/path/to/output.pdf" "/private/tmp/preflight-output"
```

## Upload State Check

1. Upload PDF A.
2. Confirm PDF A preview is visible.
3. Upload PDF B once.
4. Confirm PDF B preview appears immediately.
5. Confirm PDF A artwork, boxes, cached render, page count, and extracted colors are not still visible.

## Review Stop Conditions

Stop and fix before push if any of these happen:

- A no-bleed PDF is shown as bleed-included without distinct PDF box metadata.
- A user-requested additional bleed is skipped because the file already has bleed.
- PDF output gains RGB PNG strips over CMYK/ICC artwork during normal mirror bleed.
- Union Bug disappears, rasterizes unexpectedly, or shifts relative to preview.
- File size grows by more than roughly `3x` without a documented unavoidable reason.
- The final answer says a PDF export bug is fixed without box, image-resource, and render evidence.
