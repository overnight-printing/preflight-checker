import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { removeOrphanedObjects } from '../src/utils/pdfGarbageCollect.js';

test('removeOrphanedObjects drops a page left behind by removePage, keeps the rest intact', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([200, 200]);
  first.drawText('first', { x: 10, y: 180, size: 12, font, color: rgb(0, 0, 0) });
  const second = doc.addPage([300, 300]);
  second.drawText('second', { x: 10, y: 280, size: 12, font, color: rgb(0, 0, 0) });

  const firstPageRef = first.ref;
  const firstContentsRef = first.node.get(PDFName.of('Contents'));
  assert.ok(doc.context.enumerateIndirectObjects().some(([ref]) => ref === firstPageRef));

  doc.removePage(0); // pdf-lib only unlinks the Pages-tree leaf; the page dict/contents stay registered

  const removed = await removeOrphanedObjects(doc);
  assert.ok(removed > 0);

  const remainingRefs = new Set(doc.context.enumerateIndirectObjects().map(([ref]) => ref));
  assert.equal(remainingRefs.has(firstPageRef), false);
  assert.equal(remainingRefs.has(firstContentsRef), false);

  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 1);
  assert.deepEqual(reloaded.getPage(0).getSize(), { width: 300, height: 300 });
});

test('removeOrphanedObjects is a no-op when every registered object is reachable', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 200]);
  page.drawText('hello', { x: 10, y: 180, size: 12, font });

  await doc.flush();
  const before = doc.context.enumerateIndirectObjects().length;
  const removed = await removeOrphanedObjects(doc);
  assert.equal(removed, 0);
  assert.equal(doc.context.enumerateIndirectObjects().length, before);
});

test('removeOrphanedObjects does not break a pending embedPage() still waiting to flush', async () => {
  // embedPage() reserves its ref via context.nextRef() without assigning it,
  // and the copied source page it will read from isn't linked into the
  // catalog graph until the embed actually runs (normally deferred to
  // save()). Without flushing first, that source page looks unreachable and
  // a naive GC would delete it out from under the pending embed.
  const source = await PDFDocument.create();
  const sourcePage = source.addPage([100, 100]);
  sourcePage.drawText('source', { x: 10, y: 80, size: 12 });

  const target = await PDFDocument.create();
  const embeddedPage = await target.embedPage(sourcePage);
  const page = target.addPage([100, 100]);
  page.drawPage(embeddedPage, { x: 0, y: 0, width: 100, height: 100 });

  await removeOrphanedObjects(target); // must not throw
  const bytes = await target.save();
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 1);
});

test('removeOrphanedObjects never touches objects reachable only through Info', async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Keep me');
  doc.addPage([100, 100]);

  await removeOrphanedObjects(doc);
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getTitle(), 'Keep me');
});
