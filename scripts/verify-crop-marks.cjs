const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, cmyk, degrees } = require('pdf-lib');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const out = path.resolve(process.env.PREFLIGHT_AUDIT_OUTPUT || 'output/audit');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { getCropMarkLines } = await import('../src/utils/cropMarks.js');
  const source = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = source.addPage([360, 252]);
    page.setMediaBox(10, 20, 360, 252);
    page.setCropBox(10, 20, 360, 252);
    page.setRotation(degrees(rotation));
    const trim = { x: 40, y: 62, width: 288, height: 186 };
    page.drawRectangle({ ...trim, color: cmyk(1, 0.3, 0, 0) });
    for (const line of getCropMarkLines(trim, { x: 31, y: 41, width: 318, height: 210 })) page.drawLine({
      start: { x: line.x1, y: line.y1 }, end: { x: line.x2, y: line.y2 }, color: cmyk(0, 0, 0, 1), thickness: 0.5,
    });
  }
  const sourceBytes = [...await source.save()];
  fs.writeFileSync(out + '/crop-mark-vector.pdf', new Uint8Array(sourceBytes));
  const plain = await PDFDocument.create();
  plain.addPage([360, 252]).drawRectangle({ width: 360, height: 252, color: cmyk(1, 0, 0, 0) });
  fs.writeFileSync(out + '/crop-no-marks.pdf', await plain.save());
  const ambiguous = await PDFDocument.create();
  const ambiguousPage = ambiguous.addPage([360, 252]);
  for (const trim of [{ x: 36, y: 36, width: 288, height: 180 }, { x: 45, y: 45, width: 270, height: 162 }]) {
    for (const line of getCropMarkLines(trim, { x: 21, y: 21, width: 318, height: 210 })) ambiguousPage.drawLine({ start: { x: line.x1, y: line.y1 }, end: { x: line.x2, y: line.y2 }, color: cmyk(0, 0, 0, 1), thickness: 0.5 });
  }
  fs.writeFileSync(out + '/crop-ambiguous.pdf', await ambiguous.save());
  const annotated = await PDFDocument.load(new Uint8Array(sourceBytes));
  annotated.getPage(0).node.set(PDFName.of('Annots'), annotated.context.obj([{ Type: 'Annot', Subtype: 'Text', Rect: [10, 20, 25, 35], F: 4 }]));
  fs.writeFileSync(out + '/crop-marks-annotated.pdf', await annotated.save());
  const stamp = await PDFDocument.create();
  stamp.addPage([20, 10]).drawRectangle({ width: 20, height: 10, color: cmyk(0, 0, 0, 1) });
  const stampBytes = [...await stamp.save()];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(process.env.PREFLIGHT_BASE_URL || 'http://127.0.0.1:5173');
    const result = await page.evaluate(async ({ sourceBytes, stampBytes }) => {
      const { loadPDF, stitchBugToPDF } = await import('/src/utils/pdfProcessor.js');
      const { normalizePdfTrim } = await import('/src/utils/normalizePdfTrim.js');
      const { getVisibleBoxInsets } = await import('/src/utils/cropMarks.js');
      const file = new File([new Uint8Array(sourceBytes)], 'marked.pdf');
      const bug = new File([new Uint8Array(stampBytes)], 'stamp.pdf');
      const doc = await loadPDF(file);
      const normalized = await normalizePdfTrim(file, doc, new AbortController().signal);
      const scans = Object.values(normalized.reviews), images = [];
      if (scans.length !== 4 || scans.some(scan => scan.status !== 'found' || !scan.applied)) throw new Error('All pages must receive ordinary trim metadata during import.');
      const pdfPage = await doc.getPage(1), viewport = pdfPage.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      images.push(canvas.toDataURL('image/png'));
      const reviewed = new File([normalized.bytes], 'normalized.pdf');
      const normalizedDoc = await loadPDF(reviewed);
      const unchanged = await normalizePdfTrim(reviewed, normalizedDoc, new AbortController().signal);
      if (unchanged.bytes !== null || Object.keys(unchanged.reviews).length) throw new Error('Existing trim metadata must be authoritative.');
      await normalizedDoc.destroy();
      const canceled = new AbortController();
      canceled.abort();
      try { await normalizePdfTrim(file, doc, canceled.signal); throw new Error('Canceled normalization must stop'); }
      catch (error) { if (error.name !== 'AbortError') throw error; }
      const outputs = {};
      for (const [name, bleed, crop, marks, enabled] of [
        ['marks-only', 0, false, true, true], ['marks-bleed', 9, false, true, true],
        ['marks-cropped', 9, true, true, true], ['marks-off', 9, true, false, true],
        ['marks-original', 0, false, false, false],
      ]) outputs[name] = [...await stitchBugToPDF(reviewed, bug, '#000000', { left: 60, top: 70 }, { width: 20, height: 10 }, 1, [1, 2, 3, 4], 1, bleed, enabled, {}, {}, crop, 0, false, { cropMarksEnabled: marks })];
      const marked = await loadPDF(new File([new Uint8Array(outputs['marks-cropped'])], 'marked.pdf'));
      const unmarked = await loadPDF(new File([new Uint8Array(outputs['marks-off'])], 'unmarked.pdf'));
      const differences = [];
      for (let n = 1; n <= 4; n++) {
        const canvases = [];
        for (const pdf of [marked, unmarked]) {
          const pdfPage = await pdf.getPage(n), viewport = pdfPage.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          canvases.push(canvas);
        }
        const w = canvases[1].width, h = canvases[1].height;
        const a = canvases[0].getContext('2d').getImageData(42, 42, w, h).data;
        const b = canvases[1].getContext('2d').getImageData(0, 0, w, h).data;
        let difference = 0;
        for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
        differences.push(difference / a.length);
      }
      await marked.destroy(); await unmarked.destroy();
      const { createCustomerProofPdf } = await import('/src/utils/customerProof.js');
      outputs['crop-marks-proof'] = [...await createCustomerProofPdf({ sourcePdfBytes: new Uint8Array(outputs['marks-cropped']), proofId: 'MARKS-TEST', sourceName: 'marked.pdf' })];
      await doc.destroy();
      return { differences, scans, images, outputs, reviewed: [...await reviewed.arrayBuffer().then(buffer => new Uint8Array(buffer))], expectedInsets: [0, 90, 180, 270].map(rotation => getVisibleBoxInsets({ x: 40, y: 62, width: 288, height: 186 }, { x: 10, y: 20, width: 360, height: 252 }, rotation)) };
    }, { sourceBytes, stampBytes });
    result.scans.forEach((scan, index) => {
      assert.equal(scan.status, 'found');
      for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(Math.abs(scan.insets[edge] - result.expectedInsets[index][edge]) < 0.6, JSON.stringify(scan));
    });
    for (const [name, bytes] of Object.entries(result.outputs)) fs.writeFileSync(out + '/' + name + '.pdf', new Uint8Array(bytes));
    const reviewed = await PDFDocument.load(new Uint8Array(result.reviewed));
    reviewed.getPages().forEach((output, index) => {
      assert.deepEqual(output.getMediaBox(), source.getPage(index).getMediaBox());
      assert.deepEqual(output.getCropBox(), source.getPage(index).getCropBox());
      assert.deepEqual(output.getBleedBox(), output.getTrimBox());
      assert.ok(Math.abs(output.getTrimBox().width - 288) < 0.6);
      assert.ok(Math.abs(output.getTrimBox().height - 186) < 0.6);
    });
    assert.deepEqual(result.outputs['marks-original'], result.reviewed);
    assert.ok(result.differences.every(value => value < 0.5), 'Marks must not change the artwork, bleed or stamp position at any rotation: ' + result.differences);
    const proof = await PDFDocument.load(new Uint8Array(result.outputs['crop-marks-proof']));
    const proofForms = proof.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
    const artworkForm = proofForms.lookup(proofForms.keys()[0]);
    const bounds = artworkForm.dict.lookup(PDFName.of('BBox')).asArray().map(number => number.asNumber());
    assert.ok(Math.abs(bounds[2] - bounds[0] - 306) < 1 && Math.abs(bounds[3] - bounds[1] - 204) < 1, 'Customer proof excludes the new mark margin');
    for (const [name, size, bleed] of [['marks-only', [402, 294], [21, 21, 360, 252]], ['marks-bleed', [420, 312], [21, 21, 378, 270]], ['marks-cropped', [348, 246], [21, 21, 306, 204]], ['marks-off', [306, 204], [0, 0, 306, 204]]]) {
      const output = await PDFDocument.load(new Uint8Array(result.outputs[name]));
      for (const [index, pdfPage] of output.getPages().entries()) {
        const box = pdfPage.getMediaBox(), band = pdfPage.getBleedBox();
        assert.ok(Math.abs(box.width - size[0]) < 1 && Math.abs(box.height - size[1]) < 1);
        assert.ok([band.x, band.y, band.width, band.height].every((number, n) => Math.abs(number - bleed[n]) < 1));
        assert.equal(pdfPage.getRotation().angle, [0, 90, 180, 270][index]);
      }
      assert.equal(execFileSync('pdfimages', ['-list', out + '/' + name + '.pdf'], { encoding: 'utf8' }).trim().split('\n').length, 2);
      const info = execFileSync('pdfinfo', ['-box', out + '/' + name + '.pdf'], { encoding: 'utf8' });
      fs.writeFileSync(out + '/' + name + '-verification.txt', info);
      execFileSync('pdftoppm', ['-scale-to', '1000', '-png', out + '/' + name + '.pdf', out + '/' + name]);
      if (name === 'marks-only') {
        const commands = output.getPage(0).node.Contents().asArray().map(ref => output.context.lookup(ref)).filter(object => object instanceof PDFRawStream).map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
        assert.ok(commands.includes('0 0 0 1 K'), 'Printer marks must use K100 CMYK strokes');
      }
    }

    // Flatten the source page into an image PDF, like a Canva flattened export.
    const flat = await PDFDocument.create();
    const image = await flat.embedPng(result.images[0]);
    flat.addPage([360, 252]).drawImage(image, { x: 0, y: 0, width: 360, height: 252 });
    fs.writeFileSync(out + '/canva-like-flat.pdf', await flat.save());
    if (process.env.PREFLIGHT_PRODUCTION_URL) await page.goto(process.env.PREFLIGHT_PRODUCTION_URL);
    const upload = () => page.locator('input[type=file]').first();
    await upload().setInputFiles(out + '/canva-like-flat.pdf');
    const summary = page.getByLabel('Document size summary');
    const loaded = async () => {
      await page.locator('.artwork-canvas canvas').waitFor();
      await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
      assert.equal(await page.getByRole('region', { name: 'Crop mark review' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Confirm trim', exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Suggested trim guide', { exact: true }).count(), 0);
      assert.ok(!(await summary.innerText()).includes('unconfirmed'));
    };
    await loaded();
    assert.ok((await summary.innerText()).includes('Trim Size'));
    assert.ok((await summary.innerText()).includes('4.00" × 2.58"'));
    assert.equal(await page.getByRole('img', { name: 'Trim guide', exact: true }).count(), 1);
    assert.equal(await page.getByRole('img', { name: 'Safe area guide', exact: true }).count(), 1);
    assert.deepEqual(await page.locator('.artwork-canvas canvas').evaluate(canvas => [canvas.width, canvas.height]), [540, 378]);
    await page.getByRole('button', { name: 'Stamper Settings', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Crop to trim box', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: 'Add mirror bleed', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Add crop marks', exact: true }).check();
    assert.equal(await page.getByRole('img', { name: 'Crop marks preview' }).locator('line').count(), 8);
    const save = page.getByRole('button', { name: 'Save Production File', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Save Production File' && !button.disabled));
    const download = page.waitForEvent('download');
    await save.click();
    await (await download).saveAs(out + '/ui-crop-marks.pdf');
    const uiOutput = await PDFDocument.load(fs.readFileSync(out + '/ui-crop-marks.pdf'));
    assert.deepEqual(uiOutput.getPage(0).getMediaBox(), { x: 0, y: 0, width: 420, height: 312 });
    assert.deepEqual(uiOutput.getPage(0).getBleedBox(), { x: 21, y: 21, width: 378, height: 270 });
    const images = execFileSync('pdfimages', ['-list', out + '/ui-crop-marks.pdf'], { encoding: 'utf8' }).trim().split('\n').slice(2);
    assert.ok(images.length > 0 && images.every(line => line.includes('720') && line.includes('504')), 'Retain original raster resources without new page images');
    const imageStreams = doc => doc.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).map(stream => [...stream.contents]);
    assert.deepEqual(imageStreams(uiOutput), imageStreams(await PDFDocument.load(fs.readFileSync(out + '/canva-like-flat.pdf'))), 'Original flattened image bytes are preserved');
    await page.screenshot({ path: out + '/ui-crop-marks.png', fullPage: true });
    execFileSync('pdftoppm', ['-scale-to', '1100', '-png', out + '/ui-crop-marks.pdf', out + '/ui-crop-marks']);
    await page.getByRole('checkbox', { name: 'Add crop marks', exact: true }).uncheck();
    assert.equal(await page.getByRole('img', { name: 'Crop marks preview' }).count(), 0);
    await upload().setInputFiles(out + '/crop-mark-vector.pdf');
    await loaded();
    assert.equal(await page.getByRole('checkbox', { name: 'Add crop marks', exact: true }).isChecked(), false);
    // Export before visiting later pages: every page must already carry the recognized trim.
    const allPagesDownload = page.waitForEvent('download');
    await save.click();
    await (await allPagesDownload).saveAs(out + '/all-pages-normalized.pdf');
    const allPages = await PDFDocument.load(fs.readFileSync(out + '/all-pages-normalized.pdf'));
    allPages.getPages().forEach(pdfPage => {
      assert.ok(Math.abs(pdfPage.getTrimBox().width - 288) < 0.6 && Math.abs(pdfPage.getTrimBox().height - 186) < 0.6);
    });
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await loaded();
    assert.ok((await summary.innerText()).includes('2.58" × 4.00"'));
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await loaded();
    assert.ok((await summary.innerText()).includes('4.00" × 2.58"'));
    for (const name of ['marks-cropped', 'crop-no-marks', 'crop-ambiguous']) {
      await upload().setInputFiles(out + '/' + name + '.pdf');
      await loaded();
      const unchanged = page.waitForEvent('download');
      await save.click();
      await (await unchanged).saveAs(out + '/' + name + '-unchanged.pdf');
      assert.ok(fs.readFileSync(out + '/' + name + '-unchanged.pdf').equals(fs.readFileSync(out + '/' + name + '.pdf')), name + ' must remain unchanged');
    }
    // Replacing artwork during import must not install the previous file's recognized trim.
    await upload().setInputFiles(out + '/crop-mark-vector.pdf');
    await upload().setInputFiles(out + '/crop-no-marks.pdf');
    await loaded();
    assert.ok((await summary.innerText()).includes('5.00" × 3.50"'));
    await upload().setInputFiles(out + '/crop-marks-annotated.pdf');
    await loaded();
    await page.getByRole('checkbox', { name: 'Add crop marks', exact: true }).check();
    await page.getByRole('button', { name: 'Preflight', exact: true }).click();
    await page.getByRole('button', { name: 'Check production output', exact: true }).click();
    await page.getByText(/Checked production output/).waitFor();
    const reportDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download preflight report', exact: true }).click();
    await (await reportDownload).saveAs(out + '/crop-marks-report.json');
    const report = JSON.parse(fs.readFileSync(out + '/crop-marks-report.json', 'utf8'));
    assert.equal(report.cropMarksEnabled, true);
    assert.equal(report.cropMarkReviews[1].detected, true);
    assert.equal(report.checks.interactiveContent.status, 'warning');
    await page.getByRole('button', { name: 'Stamper Settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Add crop marks', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Preflight', exact: true }).click();
    assert.equal(await page.getByText(/Checked production output/).count(), 0);
    // Optional local customer regression; the private 23 MB artwork is never checked into Git.
    if (process.env.PREFLIGHT_RMD_SAMPLE) {
      const original = await PDFDocument.load(fs.readFileSync(process.env.PREFLIGHT_RMD_SAMPLE));
      await upload().setInputFiles(process.env.PREFLIGHT_RMD_SAMPLE);
      await loaded();
      assert.ok((await summary.innerText()).includes('16.00" × 8.50"'));
      assert.equal(await page.getByRole('img', { name: 'Trim guide', exact: true }).count(), 1);
      await page.screenshot({ path: out + '/rmd-normal-ui.png', fullPage: true });
      const download = page.waitForEvent('download');
      await save.click();
      await (await download).saveAs(out + '/rmd-normalized.pdf');
      const reviewed = await PDFDocument.load(fs.readFileSync(out + '/rmd-normalized.pdf'));
      assert.equal(reviewed.getPageCount(), original.getPageCount());
      for (const [index, pdfPage] of reviewed.getPages().entries()) {
        assert.deepEqual(pdfPage.getMediaBox(), original.getPage(index).getMediaBox());
        assert.deepEqual(pdfPage.getCropBox(), original.getPage(index).getCropBox());
        assert.ok(Math.abs(pdfPage.getTrimBox().width - 1152) < 0.2 && Math.abs(pdfPage.getTrimBox().height - 612) < 0.2);
        const crop = pdfPage.getCropBox(), trim = pdfPage.getTrimBox();
        const insets = [trim.x - crop.x, trim.y - crop.y, crop.x + crop.width - trim.x - trim.width, crop.y + crop.height - trim.y - trim.height];
        assert.ok(Math.max(...insets) - Math.min(...insets) < 0.0001, 'All four trim insets must match');
      }
      assert.deepEqual(imageStreams(reviewed), imageStreams(original), 'Retain both original CMYK image streams byte for byte');
      fs.writeFileSync(out + '/rmd-normalized-verification.txt', execFileSync('pdfinfo', ['-box', out + '/rmd-normalized.pdf']));
      fs.appendFileSync(out + '/rmd-normalized-verification.txt', execFileSync('pdfimages', ['-list', out + '/rmd-normalized.pdf']));
      execFileSync('pdftoppm', ['-scale-to', '1400', '-png', out + '/rmd-normalized.pdf', out + '/rmd-normalized']);
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await loaded();
      assert.ok((await summary.innerText()).includes('16.00" × 8.50"'));
      await page.screenshot({ path: out + '/rmd-normalized-ui.png', fullPage: true });
      console.log('Actual Canva brochure passed: both trims approximately 16 × 8.5 inches, full page preserved, original CMYK image bytes unchanged.');
    }
    assert.deepEqual(errors, []);
    console.log('Crop marks passed: raster/vector detection, offsets/rotations, automatic import trim, no special UI, all-page output, CMYK vector marks, boxes, original resources, cancellation, marks toggle and reset.');
  } catch (error) {
    await page.screenshot({ path: out + '/crop-mark-failure.png', fullPage: true });
    console.error(await page.locator('body').innerText());
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
