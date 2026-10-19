import test from 'node:test';
import assert from 'node:assert/strict';
import { findDisclaimerInPDF } from '../src/utils/textDetector.js';

test('disclaimer detection keeps split text matching and does not log customer text', async t => {
  const log = t.mock.method(console, 'log');
  const result = await findDisclaimerInPDF({ getTextContent: async () => ({ items: [
    { str: 'Paid for', transform: [1, 0, 0, 1, 10, 20], width: 40, height: 8 },
    { str: 'by Customer', transform: [1, 0, 0, 1, 50, 20], width: 70, height: 8 }
  ] }) });
  assert.equal(result.text, 'Paid for by Customer');
  assert.equal(result.x, 10);
  assert.equal(result.width, 110);
  assert.equal(await findDisclaimerInPDF({ getTextContent: async () => ({ items: [] }) }), null);
  assert.equal(log.mock.callCount(), 0);
});
