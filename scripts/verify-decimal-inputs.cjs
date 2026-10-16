const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, cmyk } = require('pdf-lib');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([252, 144]).drawRectangle({ width: 252, height: 144, color: cmyk(1, 0, 0, 0) });
  const out = path.resolve(process.env.PREFLIGHT_AUDIT_OUTPUT || 'output/audit');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.PREFLIGHT_PRODUCTION_URL || 'http://127.0.0.1:4175');
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'decimal-inputs.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
    });
    await page.locator('.artwork-canvas canvas').waitFor();
    const save = page.getByRole('button', { name: 'Save Production File', exact: true });
    const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Save Production File' && !button.disabled));
    const type = async (input, text) => {
      await input.fill('');
      await input.evaluate(element => { window.testDecimalInput = element; });
      for (const character of text) {
        await input.pressSequentially(character, { delay: 40 });
        assert.equal(await input.evaluate(element => element === window.testDecimalInput && element === document.activeElement && !element.disabled), true);
      }
      assert.equal(await input.inputValue(), text);
    };

    await page.getByRole('button', { name: 'Stamper Settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Add mirror bleed', exact: true }).check();
    await ready();
    const bleed = page.getByLabel('Bleed size', { exact: true });
    await type(bleed, '.250');
    await bleed.evaluate(element => element.setSelectionRange(2, 3));
    await bleed.pressSequentially('1');
    assert.equal(await bleed.inputValue(), '.210');
    assert.equal(await bleed.evaluate(element => element.selectionStart), 3);
    await bleed.press('Enter');
    assert.equal(await bleed.inputValue(), '0.210');
    await ready();
    await page.getByRole('button', { name: 'Use 0.125"', exact: true }).click();
    await ready();
    assert.equal(await bleed.inputValue(), '0.125');
    await type(bleed, '.');
    await bleed.press('Tab');
    assert.equal(await bleed.inputValue(), '0.125');

    await page.getByRole('checkbox', { name: 'Crop to trim box', exact: true }).check();
    await ready();
    const crop = page.getByLabel('Manual inset', { exact: true });
    await type(crop, '0.020');
    await crop.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Increase crop inset', exact: true }).evaluate(element => element === document.activeElement), true);
    await ready();
    await page.getByRole('button', { name: 'Increase crop inset', exact: true }).click();
    await ready();
    assert.equal(await crop.inputValue(), '0.021');
    await page.getByRole('button', { name: 'Decrease crop inset', exact: true }).click();
    await ready();
    assert.equal(await crop.inputValue(), '0.020');
    await type(crop, '-2');
    await crop.press('Tab');
    assert.equal(await crop.inputValue(), '0.020');
    await type(crop, '1.25');
    await crop.press('Escape');
    assert.equal(await crop.inputValue(), '0.020');
    await type(crop, '20.000');
    await crop.press('Enter');
    await page.getByText('The crop inset removes the entire page. Reduce the manual inset.', { exact: true }).first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.tool-controls').disabled);
    await type(crop, '0.020');
    await crop.press('Enter');
    await page.locator('.artwork-canvas canvas').waitFor();
    await ready();
    const safe = page.getByLabel('Safe zone inset in inches', { exact: true });
    await type(safe, '0.15');
    await safe.press('Tab');
    assert.equal(await safe.inputValue(), '0.1500');
    await page.screenshot({ path: out + '/decimal-inputs.png', fullPage: true });

    await page.getByRole('button', { name: 'Preflight', exact: true }).click();
    await page.getByText('Job requirements', { exact: true }).click();
    await page.getByLabel('Finished order size', { exact: true }).selectOption('custom');
    await page.getByRole('button', { name: 'Analyze PDF', exact: true }).click();
    await page.getByRole('button', { name: 'Re-analyze', exact: true }).waitFor();
    const width = page.getByLabel('Order width in inches', { exact: true });
    await type(width, '3.5');
    await width.press('Enter');
    const height = page.getByLabel('Order height in inches', { exact: true });
    await type(height, '2.0');
    await height.press('Tab');
    await ready();
    const download = page.waitForEvent('download');
    await save.click();
    await (await download).saveAs(out + '/decimal-inputs.pdf');
    const output = await PDFDocument.load(fs.readFileSync(out + '/decimal-inputs.pdf'));
    const box = output.getPage(0).getMediaBox();
    assert.ok(Math.abs(box.width - 267.12) < 0.001);
    assert.ok(Math.abs(box.height - 159.12) < 0.001);
    assert.deepEqual(errors, []);
    console.log('Decimal inputs passed: continuous typing, caret edits, Enter/Tab, invalid drafts, Escape, steppers, preset sync, safe zone, order dimensions, and crop/bleed export.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
