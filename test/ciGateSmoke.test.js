import test from 'node:test';
import assert from 'node:assert/strict';

test('intentional CI gate failure; removed immediately after verifying the gate', () => {
  assert.fail('Deliberately broken commit: browser verification and auto-version must be skipped.');
});
