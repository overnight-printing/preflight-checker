// Run against `npm run preview`; Vite emits preload errors in production builds.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, cmyk } = require('pdf-lib');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([252, 144]).drawRectangle({ width: 252, height: 144, color: cmyk(1, 0, 0, 0) });
  const file = { name: 'recovery.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
  const out = path.resolve(process.env.PREFLIGHT_AUDIT_OUTPUT || 'output/audit');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.PREFLIGHT_PRODUCTION_URL || 'http://127.0.0.1:4173');
    const processor = '**/assets/pdfProcessor-*.js';
    await page.route(processor, route => route.abort());
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.getByRole('button', { name: 'Refresh app', exact: true }).waitFor();
    assert.equal(await page.getByText(/Unable to load artwork/).count(), 0);
    await page.unroute(processor);
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: 'Refresh app', exact: true }).click(),
    ]);
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.locator('.artwork-canvas canvas').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Refresh app', exact: true }).count(), 0);

    // A later lazy-load failure must retain the already loaded artwork.
    await page.route('**/assets/preflightChecker-*.js', route => route.abort());
    await page.getByRole('button', { name: 'Analyze PDF', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh app', exact: true }).waitFor();
    assert.equal(await page.locator('.artwork-canvas canvas').count(), 1);
    await page.getByRole('button', { name: 'Save Production File', exact: true }).waitFor({ state: 'visible' });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Production File', exact: true }).click();
    const result = await download;
    assert.match(result.suggestedFilename(), /\.pdf$/);
    await result.saveAs(out + '/module-recovery.pdf');
    await page.screenshot({ path: out + '/module-recovery.png', fullPage: true });
    console.log('Module recovery passed: failed upload gives refresh guidance, refresh restores PDF loading, and later failures retain artwork and allow production download.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
