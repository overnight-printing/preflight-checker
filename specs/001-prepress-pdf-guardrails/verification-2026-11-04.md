# ICC-managed spot conversion verification

Branch: `overnight-printing/profiled-spot-conversion`.

## Behavior

- Spot inks start unchecked; names are decoded for display. Foil/varnish plates remain unchanged unless explicitly selected. Font selection behavior stays the same.
- DeviceCMYK tint recipes retain their values. Supported Lab and ICC-based RGB, Gray, CMYK, and Lab alternates use LittleCMS WASM, honoring the PDF rendering intent. Converted operators select an ICCBased CMYK resource containing the exact destination profile.
- Custom CMYK ICC profiles take precedence over a single embedded CMYK output profile. Otherwise the displayed fallback is the unchanged, licensed SWOP2006_Coated3v2 profile from the ICC registry. It represents CGATS TR003, not the customer's declared CGATS TR001 or a measured press. Profile and engine assets load locally on demand.
- Invalid, incomplete, oversized, RGB/monitor, and display-only CMYK destination profiles are rejected. ICC headers, not channel counts, identify Lab versus RGB sources.
- Repairs are planned before any content is rewritten. An unsupported occurrence keeps its ink unchanged throughout the document. Partial DeviceN selections, image/shading/pattern uses, implicit default tints, and conflicting shared Forms are refused. Inline images, Type3 fonts, annotation appearances, and soft-mask groups conservatively prevent conversion rather than risking partially converted plates.
- Unchanged repairs report specific reasons without replacing or rescanning the source. New artwork/reset clears the custom profile and ink selections.

## Automated evidence

- `npm test`: 143 passed. Native LittleCMS 2.17 reference values independently check Lab/RGB/CMYK transforms, negative Lab components, and CMYK percentage scaling. Regression coverage includes transactional refusal, stream-array state, inherited Forms, rendering intents, foil retention, unsupported content, profile validation, and readable preflight metadata.
- `npm run lint`: passed.
- `GITHUB_ACTIONS=true npm run build`: passed, including the production subpath. The deferred LittleCMS assets are approximately 35 KB JavaScript and 316 KB WASM; the unchanged fallback profile is approximately 2.68 MB.
- Focused browser verification passed for custom and standard profiles, opt-in selection, invalid profile rejection, upload reset, tagged CMYK export, preserved foil, loaded WASM/profile assets, and no-op preview preservation. The same script runs against the production subpath in CI.
- The full six-suite browser run and Poppler regression suite are required by CI; see the pull request checks for the final result.

## Local customer fixture

The private two-page Westland PDF was tested through the actual browser repair and Save Production File workflow. No customer artwork is committed.

- The previously verified 3,996,505-byte outlined production file was used as input. The ICC-managed output is 6,211,001 bytes; the increase embeds the destination ICC profile and is justified by color management, without rasterization.
- PANTONE 877 U converted using SWOP2006_Coated3v2.icc. SILVER FOIL and registration remain spot plates. The destination ICC bytes match the bundled profile's SHA-256.
- Both pages retain MediaBox/CropBox 0 0 426 570, BleedBox 24 24 402 546, TrimBox 33 33 393 537, and rotation 0.
- `pdfimages -list` retains the one original 4452 x 6699 ICC JPEG at 749 PPI. Encoded source image bytes are identical; no new raster resources were added.
- `pdftoppm` rendered both pages without errors. Visual review confirmed the original layout, readable vector outlines, intact bottle image, neutral silver artwork, and untouched foil appearance. The synthetic Lab/foil export also rendered correctly with zero image resources.
- Browser export reported no page errors. Local evidence is retained in ignored `output/audit/`.

No physical press/RIP test or full PDF/X certification was performed. Use the printer's actual press/paper profile when it becomes available.
