import { PDFName, PDFObjectCopier, PDFPage } from 'pdf-lib';

// Use the same reference mapping for the layer configuration and page resources.
// Copying them separately makes hidden content refer to unconfigured layer copies.
export function createPDFPageEmbedder(sourceDocument, targetDocument) {
  const copier = PDFObjectCopier.for(sourceDocument.context, targetDocument.context);
  for (const key of ['OCProperties', 'OutputIntents']) {
    const name = PDFName.of(key);
    const value = sourceDocument.catalog.get(name);
    if (value) targetDocument.catalog.set(name, copier.copy(value));
  }

  return async (page, boundingBox) => {
    const node = copier.copy(page.node);
    const copiedPage = PDFPage.of(node, targetDocument.context.register(node), targetDocument);
    const embeddedPage = await targetDocument.embedPage(copiedPage, boundingBox);
    // pdf-lib's page embedder omits transparency groups, including the blending
    // color space. Retain that group on the artwork Form XObject.
    const group = node.get(PDFName.of('Group'));
    if (group) {
      await embeddedPage.embed();
      targetDocument.context.lookup(embeddedPage.ref).dict.set(PDFName.of('Group'), group);
    }
    return embeddedPage;
  };
}
