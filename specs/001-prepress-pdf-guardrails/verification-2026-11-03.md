# Repair selection and print export verification

Worktree: `repair-capabilities`, branch `feature/real-repair-capabilities`.

## Behavior

- Spot conversion and font outlining receive only the currently selected names. Registration/None cannot be selected. Empty selections disable the action. Exclusions survive rescans, repairs, and sidebar collapse; a new upload or reset clears them.
- Mixed DeviceN selections remain untouched. Conversion accepts only valid four-component DeviceCMYK tint results. Other alternates retain their profiles and spot plates, including the customer's three-channel Lab ICC Pantone definition, previously misinterpreted as RGB.
- Outlines use upward font coordinates, PDF-declared widths, and local page/Form coordinates. Paths paint outside text objects; removed fonts leave no dangling `Tf` selectors. Unsupported or mixed-selection text objects remain intact and are reported with a warning.
- Production exports omit private `PieceInfo` application editing data before removing orphaned objects. Source files, print artwork, images, page boxes, profiles, and spot plates remain available independently of that editing data. Keep the original for editing.
- Browser regressions use the two independent sidebars. Mobile collapse buttons remain inside the viewport.

## Automated evidence

- `npm run lint`: passed.
- `npm test`: 130 passed, including raster comparison of bare CFF outlines under page transforms and multiple transformed uses of a shared Form, PDF widths, split content streams, quoted text, mixed selections, unsupported render modes, Lab ICC rejection, and foil retention.
- `npm run build`: passed.
- Browser and PDF verification scripts include selective UI repairs, production downloads, private-data removal, original-state reset, and geometry/image checks. Final browser run and CI results are recorded in the pull request.

## Local customer fixture

The two-page Westland print PDF supplied by the user was tested locally; it is not committed.

- Original: 37,688,072 bytes. Direct outlined production fixture: 3,996,504 bytes (89.4% smaller), primarily by omitting Illustrator reconstruction data.
- All five embedded CFF fonts converted; `pdffonts` reports no remaining fonts.
- `pdfinfo -box`: MediaBox/CropBox 0 0 426 570, BleedBox 24 24 402 546, TrimBox 33 33 393 537; two pages, rotation 0. Geometry is unchanged.
- `pdfimages -list`: one original 4452 × 6699 ICC JPEG at 749 PPI; no new raster image resources.
- `pdftoppm -scale-to 1100 -png`: both pages rendered without Poppler errors and were visually inspected. Page 1's PNG is byte-identical to the original render. Page 2 retains readable, upright text in the original layout; text is now vector paths.
- The original Pantone and foil plates remain. The Pantone's Lab ICC alternate requires an external color-managed conversion; it is not falsely reported as CMYK.

Local artifacts are in ignored `output/audit/`. Full PDF/X certification and a physical press/RIP test were not performed.
