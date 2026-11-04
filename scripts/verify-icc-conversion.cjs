const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const out = path.resolve(process.env.PREFLIGHT_AUDIT_OUTPUT || 'output/audit');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const labBytes = fs.readFileSync('test/fixtures/lab-d50.icc');
  const profile = fs.readFileSync('public/profiles/SWOP2006_Coated3v2.icc');
  const fixtures = {};
  for (const malformed of [false, true]) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([252, 144]);
    const lab = doc.context.register(doc.context.flateStream(labBytes, { N: 3, Alternate: ['Lab', { WhitePoint: [0.9642, 1, 0.8249] }] }));
    const alternate = malformed ? 'DeviceCMYK' : ['ICCBased', lab];
    const tint = malformed
      ? { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 2], N: 1 }
      : { FunctionType: 2, Domain: [0, 1], C0: [100, 0, 0], C1: [74.1176, -1, -1], N: 1, Range: [0, 100, -128, 127, -128, 127] };
    page.node.set(PDFName.of('Resources'), doc.context.obj({ ColorSpace: {
      Ink: ['Separation', 'PANTONE 877 U', alternate, tint],
      Foil: ['Separation', 'SILVER FOIL', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 0.25], N: 1 }]
    } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/Ink cs 1 scn 10 10 80 80 re f /Foil cs 1 scn 110 10 80 80 re f')));
    const filename = malformed ? 'icc-malformed-tint.pdf' : 'icc-lab-source.pdf';
    fixtures[filename] = { name: filename, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
    fs.writeFileSync(path.join(out, filename), fixtures[filename].buffer);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], assetRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('lcms-') || response.url().includes('SWOP2006_Coated3v2.icc')) assetRequests.push({ url: response.url(), status: response.status() });
    });
    await page.goto(process.env.PREFLIGHT_PRODUCTION_URL || process.env.PREFLIGHT_BASE_URL || 'http://127.0.0.1:5173');
    const upload = () => page.locator('input[type=file]').first();
    const analyze = () => page.getByRole('button', { name: 'Analyze PDF', exact: true });
    const spots = page.getByRole('group', { name: 'Spot colors to convert', exact: true });
    await upload().setInputFiles(fixtures['icc-lab-source.pdf']);
    await analyze().click();
    await spots.waitFor();
    assert.equal(await spots.getByRole('checkbox', { name: 'SILVER FOIL', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Convert to CMYK (0/2)', exact: true }).isDisabled(), true);
    await page.getByLabel('CMYK ICC profile', { exact: true }).setInputFiles('test/fixtures/srgb.icc');
    await page.getByRole('alert').filter({ hasText: 'not an RGB or monitor profile' }).waitFor();
    await page.getByLabel('CMYK ICC profile', { exact: true }).setInputFiles({ name: 'shop-cmyk.icc', mimeType: 'application/vnd.iccprofile', buffer: profile });
    await page.getByRole('status').filter({ hasText: 'CMYK conversion target: shop-cmyk.icc' }).waitFor();
    await spots.getByRole('checkbox', { name: 'PANTONE 877 U', exact: true }).check();
    await page.getByRole('button', { name: 'Collapse Preflight sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Expand Preflight sidebar', exact: true }).click();
    await page.getByText('shop-cmyk.icc', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Convert to CMYK (1/2)', exact: true }).click();
    await page.getByRole('button', { name: 'Convert to CMYK (0/1)', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'using shop-cmyk.icc: PANTONE 877 U' }).waitFor();
    assert.equal(await spots.getByRole('checkbox').count(), 1);
    assert.equal(await spots.getByRole('checkbox').isChecked(), false, 'foil stays unselected');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Production File', exact: true }).click();
    const filename = path.join(out, 'ui-icc-lab-converted.pdf');
    await (await download).saveAs(filename);
    const output = await PDFDocument.load(fs.readFileSync(filename));
    const spaces = output.getPage(0).node.Resources().lookup(PDFName.of('ColorSpace'));
    assert.equal(spaces.get(PDFName.of('Ink')), undefined);
    assert.ok(spaces.get(PDFName.of('Foil')) instanceof PDFArray);
    const processSpace = spaces.keys().map(key => spaces.lookup(key)).find(space => space instanceof PDFArray && space.get(0) === PDFName.of('ICCBased'));
    assert.ok(processSpace, 'converted color is explicitly tagged with the chosen ICC profile');
    const embedded = output.context.lookup(processSpace.get(1));
    assert.equal(embedded.dict.get(PDFName.of('N')).asNumber(), 4);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(decodePDFRawStream(embedded).decode()), hash(profile));
    assert.equal(output.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length, 0);
    await upload().setInputFiles(fixtures['icc-lab-source.pdf']);
    await analyze().click();
    await spots.waitFor();
    assert.equal(await page.getByText('shop-cmyk.icc', { exact: true }).count(), 0, 'new upload resets the custom profile');
    await spots.getByRole('checkbox', { name: 'PANTONE 877 U', exact: true }).check();
    await page.getByRole('button', { name: 'Convert to CMYK (1/2)', exact: true }).click();
    await page.getByRole('button', { name: 'Convert to CMYK (0/1)', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'using SWOP2006_Coated3v2.icc: PANTONE 877 U' }).waitFor();
    await upload().setInputFiles(fixtures['icc-malformed-tint.pdf']);
    await analyze().click();
    await spots.waitFor();
    await page.locator('.artwork-canvas canvas').evaluate(canvas => { canvas.dataset.unchanged = 'yes'; });
    await spots.getByRole('checkbox', { name: 'PANTONE 877 U', exact: true }).check();
    await page.getByRole('button', { name: 'Convert to CMYK (1/2)', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'No inks changed. PANTONE 877 U:' }).waitFor();
    assert.equal(await page.locator('.artwork-canvas canvas').getAttribute('data-unchanged'), 'yes', 'a refused repair does not replace or re-scan artwork');
    assert.ok(assetRequests.some(request => request.url.includes('lcms-') && request.url.endsWith('.wasm') && request.status === 200));
    assert.ok(assetRequests.some(request => request.url.includes('SWOP2006_Coated3v2.icc') && request.status === 200));
    assert.deepEqual(errors, []);
    console.log('ICC browser checks passed: Lab conversion, selected profile and plates, profile validation/reset, WASM/profile assets, tagged CMYK output, and unchanged rejected repairs.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
