import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream, rgb } from 'pdf-lib';
import { createPDFPageEmbedder } from '../src/utils/pdfPageEmbedding.js';
import { createCustomerProofPdf } from '../src/utils/customerProof.js';

test('embedded artwork shares configured layers, output intent, and transparency blending space', async () => {
  const source = await PDFDocument.create();
  const visible = source.context.register(source.context.obj({ Type: 'OCG', Name: 'Artwork' }));
  const hidden = source.context.register(source.context.obj({ Type: 'OCG', Name: 'Hidden draft' }));
  source.catalog.set(PDFName.of('OCProperties'), source.context.obj({
    OCGs: [visible, hidden], D: { BaseState: 'ON', OFF: [hidden], Order: [visible, hidden] },
    Configs: [{ Name: 'Alternate', BaseState: 'OFF', ON: [visible] }]
  }));
  const profile = source.context.register(source.context.flateStream(new Uint8Array([1, 2, 3]), { N: 4 }));
  source.catalog.set(PDFName.of('OutputIntents'), source.context.obj([
    { Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: 'Test CMYK', DestOutputProfile: profile }
  ]));
  for (let index = 0; index < 2; index++) {
    const page = source.addPage([252, 144]);
    page.drawRectangle({ width: 252, height: 144, color: rgb(0, 0, 1) });
    page.node.Resources().set(PDFName.of('Properties'), source.context.obj({ Visible: visible, Hidden: hidden }));
    page.node.set(PDFName.of('Group'), source.context.obj({ S: 'Transparency', CS: 'DeviceCMYK', I: true }));
  }
  const target = await PDFDocument.create();
  const embed = createPDFPageEmbedder(source, target);
  for (const sourcePage of source.getPages()) target.addPage([252, 144]).drawPage(await embed(sourcePage));
  const proofBytes = await createCustomerProofPdf({ sourcePdfBytes: await source.save(), proofId: '42', sourceName: 'layers.pdf' });

  for (const bytes of [await target.save(), proofBytes]) {
    const document = await PDFDocument.load(bytes);
    assert.equal(document.getPageCount(), 2);
    const configuration = document.catalog.lookup(PDFName.of('OCProperties'));
    const groups = configuration.lookup(PDFName.of('OCGs'));
    assert.equal(groups.size(), 2);
    const hiddenRef = groups.get(1).toString();
    assert.equal(configuration.lookup(PDFName.of('D')).lookup(PDFName.of('OFF')).get(0).toString(), hiddenRef);
    assert.equal(configuration.lookup(PDFName.of('Configs')).size(), 1);
    const outputIntent = document.catalog.lookup(PDFName.of('OutputIntents')).lookup(0);
    assert.deepEqual(Array.from(outputIntent.lookup(PDFName.of('DestOutputProfile')).getContents()), Array.from(source.context.lookup(profile).getContents()));
    let artworks = 0;
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream) || !object.dict.has(PDFName.of('Group'))) continue;
      const properties = object.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('Properties'));
      assert.equal(properties.get(PDFName.of('Hidden')).toString(), hiddenRef);
      assert.equal(object.dict.lookup(PDFName.of('Group')).get(PDFName.of('CS')).toString(), '/DeviceCMYK');
      artworks++;
    }
    assert.equal(artworks, 2);
  }
});
