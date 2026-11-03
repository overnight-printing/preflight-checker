import { PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib';

// pdf-lib's writer serializes every indirect object ever registered in the
// context (PDFWriter.computeBufferSize has no reachability check), so an
// object orphaned by a deleted page or replaced resource is never dropped on
// save(). This walks the catalog/trailer graph the same way it will actually
// be read, marks every indirect object still reachable, and deletes the rest.
// Lossless: nothing is removed that the saved document can still reach.
//
// Must run after pending embeds (fonts/images/pages) are flushed: embedPage()
// etc. reserve a ref via context.nextRef() without assigning it until the
// deferred embed actually runs (normally inside save()), and the source
// content it will read meanwhile looks unreachable from the catalog. Flushing
// first resolves those refs and re-points them at the real embedded content,
// so the walk below sees the document's true final shape.
export async function removeOrphanedObjects(pdfDoc) {
  await pdfDoc.flush();
  const { context } = pdfDoc;
  const reachable = new Set();

  const visit = value => {
    if (value == null) return;
    if (value instanceof PDFRef) {
      if (reachable.has(value)) return;
      reachable.add(value);
      visit(context.lookup(value));
      return;
    }
    if (value instanceof PDFStream) { visit(value.dict); return; }
    if (value instanceof PDFDict) { value.keys().forEach(key => visit(value.get(key))); return; }
    if (value instanceof PDFArray) { value.asArray().forEach(visit); return; }
  };

  visit(context.trailerInfo.Root);
  visit(context.trailerInfo.Info);
  visit(context.trailerInfo.ID);
  visit(context.trailerInfo.Encrypt);

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) { context.delete(ref); removed += 1; }
  }
  return removed;
}
