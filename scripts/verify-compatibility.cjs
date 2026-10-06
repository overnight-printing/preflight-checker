// Run after verify-browser.cjs; checks the explicit RGB compatibility path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, PDFName, PDFOperator, StandardFonts, rgb } = require(process.cwd() + '/node_modules/pdf-lib');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const out = path.resolve(process.env.PREFLIGHT_AUDIT_OUTPUT || 'output/audit');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const source = await PDFDocument.create();
  const page = source.addPage([252, 144]);
  const shading = source.context.register(source.context.obj({
    ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 252, 0],
    Function: { FunctionType: 2, Domain: [0, 1], C0: [0.05, 0.3, 0.9], C1: [0.9, 0.8, 0.1], N: 1 }, Extend: [true, true],
  }));
  page.node.Resources().set(PDFName.of('Shading'), source.context.obj({ Gradient: shading }));
  page.pushOperators(PDFOperator.of('sh', [PDFName.of('Gradient')]));
  const mask = source.context.register(source.context.flateStream(
    '0 g 60 60 100 40 re f 1 g 110 60 50 40 re f',
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 252, 144],
      Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: {} },
  ));
  const form = source.context.register(source.context.flateStream(
    'q /Mask gs 1 0 0 rg 60 60 100 40 re f Q',
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 252, 144],
      Group: { S: 'Transparency', CS: 'DeviceRGB' },
      Resources: { ExtGState: { Mask: { Type: 'ExtGState', SMask: { S: 'Luminosity', G: mask, BC: [0] } } } } },
  ));
  // Generated 16x16 G4 stencil: black square centered on white. This exercises
  // the same decoder as white CCITT logos without including customer artwork.
  const stencil = source.context.register(source.context.stream(Buffer.from('JqC/8uf////4/wAQAQ==', 'base64'), {
    Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ImageMask: true, BitsPerComponent: 1,
    Filter: 'CCITTFaxDecode', Decode: [0, 1], DecodeParms: { K: -1, Columns: 16, Rows: 16 },
  }));
  page.node.Resources().set(PDFName.of('XObject'), source.context.obj({ Artwork: form, Stencil: stencil }));
  page.pushOperators(PDFOperator.of('Do', [PDFName.of('Artwork')]));
  page.pushOperators(PDFOperator.of('q'), PDFOperator.of('g', [source.context.obj(1)]),
    PDFOperator.of('cm', [32, 0, 0, 32, 180, 48].map(value => source.context.obj(value))),
    PDFOperator.of('Do', [PDFName.of('Stencil')]), PDFOperator.of('Q'));
  page.drawText('Gradient + masked artwork', { x: 12, y: 120, size: 12, font: await source.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
  fs.writeFileSync(out + '/compatibility-source.pdf', await source.save());
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const browserPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  browserPage.on('pageerror', error => errors.push(error.message));
  try {
    await browserPage.goto(process.env.PREFLIGHT_BASE_URL || 'http://127.0.0.1:5173');
    for (const [name, dpi] of [['compatibility-source', 300], ['compatibility-source', 600], ['rotated', 600], ['layers', 300], ['multi', 300]]) {
      console.log(`VERIFY compatibility ${name} ${dpi} DPI`);
      const input = [...fs.readFileSync(out + '/' + name + '.pdf')];
      const result = await browserPage.evaluate(async ({ input, name, dpi }) => {
        const { loadPDF } = await import('/src/utils/pdfProcessor.js');
        const { createCompatibilityArtworkPdf } = await import('/src/utils/compatibilityPdf.js');
        const { runPreflightChecks } = await import('/src/utils/preflightChecker.js');
        const file = new File([new Uint8Array(input)], name + '.pdf', { type: 'application/pdf' });
        const original = await loadPDF(file);
        const before = await runPreflightChecks(file, original);
        const bytes = await createCompatibilityArtworkPdf(file, original, dpi);
        const flattenedFile = new File([bytes], 'flattened.pdf', { type: 'application/pdf' });
        const flattened = await loadPDF(flattenedFile);
        const after = await runPreflightChecks(flattenedFile, flattened, { bleedPoints: 0 });
        const differences = [];
        for (let n = 1; n <= original.numPages; n++) {
          const samples = [];
          for (const pdfDocument of [original, flattened]) {
            const pdfPage = await pdfDocument.getPage(n);
            const viewport = pdfPage.getViewport({ scale: 1 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0 }).promise;
            samples.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
            if (name === 'compatibility-source') {
              const border = canvas.getContext('2d').getImageData(182, 80, 1, 1).data;
              if (Math.min(...border.slice(0, 3)) < 245) throw new Error('White CCITT stencil disappeared during rendering.');
            }
          }
          let sum = 0;
          for (let i = 0; i < samples[0].length; i++) sum += Math.abs(samples[0][i] - samples[1][i]);
          differences.push(sum / samples[0].length);
        }
        await original.destroy(); await flattened.destroy();
        return { bytes: [...bytes], before, after, differences };
      }, { input, name, dpi });
      assert.equal(result.after.checks.transparency.status, 'pass');
      assert.equal(result.after.checks.gradients.status, 'pass');
      assert.equal(result.after.checks.hiddenLayers.status, 'pass');
      assert.equal(result.after.checks.imageMasks.status, 'pass');
      assert.equal(result.after.checks.resolution.status, 'pass');
      assert.ok(result.differences.every(value => value < 3), JSON.stringify({ name, dpi, differences: result.differences }));
      if (name === 'compatibility-source') {
        assert.deepEqual(result.before.checks.gradients.value, [2]);
        assert.equal(result.before.checks.transparency.value, true);
        assert.equal(result.before.checks.imageMasks.value.stencils, 1);
      }
      const filename = `${out}/${name}-${dpi}dpi.pdf`;
      fs.writeFileSync(filename, new Uint8Array(result.bytes));
      const original = await PDFDocument.load(new Uint8Array(input)), flattened = await PDFDocument.load(new Uint8Array(result.bytes));
      original.getPages().forEach((originalPage, index) => {
        const flatPage = flattened.getPage(index);
        for (const box of ['getMediaBox', 'getCropBox', 'getTrimBox', 'getBleedBox']) assert.deepEqual(flatPage[box](), originalPage[box]());
        assert.deepEqual(flatPage.getRotation(), originalPage.getRotation());
      });
      // Fresh artwork must contain opaque image data and no dormant live effects.
      for (const [, object] of flattened.context.enumerateIndirectObjects()) {
        const dict = object.dict || object;
        if (!dict?.has) continue;
        for (const key of ['SMask', 'ShadingType', 'OCProperties', 'OutputIntents']) assert.equal(dict.has(PDFName.of(key)), false, `${name}: ${key}`);
      }
      fs.writeFileSync(`${out}/${name}-${dpi}dpi-checks.json`, JSON.stringify({ before: result.before, after: result.after, differences: result.differences }, null, 2));
    }

    // Optional deployment smoke test: the real UI must find decoder assets
    // under the hosting base path as well as in the development server.
    const decoderRequests = [];
    if (process.env.PREFLIGHT_PRODUCTION_URL) {
      await browserPage.goto(process.env.PREFLIGHT_PRODUCTION_URL);
      browserPage.on('response', response => {
        if (response.url().includes('/assets/pdfjs/')) decoderRequests.push({ url: response.url(), status: response.status() });
      });
    }
    await browserPage.locator('input[type=file]').first().setInputFiles(out + '/compatibility-source.pdf');
    await browserPage.getByRole('button', { name: 'Save Production File', exact: true }).waitFor();
    await browserPage.locator('#pdf-output-mode').selectOption('compatibility');
    await browserPage.getByRole('button', { name: 'Stamper Settings', exact: true }).click();
    if (!await browserPage.getByRole('checkbox', { name: 'Add mirror bleed', exact: true }).count())
      await browserPage.getByRole('button', { name: 'Bleed & Trim', exact: false }).click();
    await browserPage.getByRole('checkbox', { name: 'Add mirror bleed', exact: true }).check();
    await browserPage.getByRole('button', { name: 'Union Bug', exact: false }).filter({ has: browserPage.locator('strong') }).click();
    await browserPage.getByRole('checkbox', { name: 'Apply Union Bug', exact: true }).check();
    await browserPage.locator('.draggable-bug').waitFor();
    const downloadPromise = browserPage.waitForEvent('download');
    await browserPage.getByRole('button', { name: 'Save Production File', exact: true }).click();
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith('_Compatibility_600dpi.pdf'));
    await download.saveAs(out + '/ui-compatibility.pdf');
    await browserPage.getByRole('button', { name: 'Preflight', exact: true }).click();
    await browserPage.getByRole('button', { name: 'Check production output', exact: true }).click();
    await browserPage.getByText(/Checked production output/).waitFor();
    const reportPromise = browserPage.waitForEvent('download');
    await browserPage.getByRole('button', { name: 'Download preflight report', exact: true }).click();
    await (await reportPromise).saveAs(out + '/ui-compatibility-report.json');
    const report = JSON.parse(fs.readFileSync(out + '/ui-compatibility-report.json', 'utf8'));
    assert.equal(report.outputMode, 'compatibility');
    assert.equal(report.compatibilityDpi, 600);
    assert.equal(report.checks.gradients.status, 'pass');
    assert.equal(report.checks.bleed.status, 'pass');
    await browserPage.screenshot({ path: out + '/ui-compatibility.png', fullPage: true });
    await browserPage.locator('#compatibility-dpi').selectOption('300');
    assert.equal(await browserPage.getByText(/Checked production output/).count(), 0);
    await browserPage.locator('input[type=file]').first().setInputFiles(out + '/rotated.pdf');
    assert.equal(await browserPage.locator('#pdf-output-mode').inputValue(), 'preserve');
    assert.equal(await browserPage.locator('#compatibility-dpi').count(), 0);
    assert.deepEqual(errors, []);
    if (process.env.PREFLIGHT_PRODUCTION_URL) {
      assert.ok(decoderRequests.some(request => request.url.endsWith('/assets/pdfjs/jbig2.wasm') && request.status === 200), JSON.stringify(decoderRequests));
    }

    for (const [name, width, height, dpi] of [
      ['compatibility-source-300dpi', 1050, 600, 300], ['compatibility-source-600dpi', 2100, 1200, 600],
      ['rotated-600dpi', 2100, 1200, 600], ['layers-300dpi', 1050, 600, 300], ['multi-300dpi', 1050, 600, 300],
      ['ui-compatibility', 2100, 1200, 600],
    ]) {
      const filename = `${out}/${name}.pdf`;
      const info = execFileSync('pdfinfo', ['-box', filename], { encoding: 'utf8' });
      const images = execFileSync('pdfimages', ['-list', filename], { encoding: 'utf8' });
      const rows = images.trim().split('\n').slice(2).map(line => line.trim().split(/\s+/));
      assert.ok(rows.length > 0);
      assert.ok(rows.every(row => row[2] === 'image' && row[5] === 'rgb'), images);
      assert.equal(Number(rows[0][3]), width); assert.equal(Number(rows[0][4]), height);
      assert.equal(Number(rows[0][12]), dpi); assert.equal(Number(rows[0][13]), dpi);
      if (name === 'ui-compatibility') {
        assert.match(info, /Page size:\s+270 x 162/);
        assert.match(info, /TrimBox:\s+9\.00\s+9\.00\s+261\.00\s+153\.00/);
        // Mirrored bleed shares one RGB image; the stamp adds no image resource.
        assert.equal(new Set(rows.map(row => row[10] + ':' + row[11])).size, 1);
      }
      fs.writeFileSync(`${out}/${name}-verification.txt`, info + '\n' + images);
      execFileSync('pdftoppm', ['-scale-to', '1100', '-png', filename, `${out}/${name}`]);
    }
    execFileSync('pdftoppm', ['-scale-to', '1100', '-png', out + '/compatibility-source.pdf', out + '/compatibility-source']);
    console.log('Compatibility checks passed: gradients, nested groups/soft mask, white CCITT stencil, saved layers, rotation, multiple pages, opaque RGB, selected DPI, vector stamp, report and upload reset.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
