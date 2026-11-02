import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bundleWorker } from '../scripts/lib/bundle.mjs';
import { createWorker } from './helpers/worker.js';

const source = await bundleWorker();
const fixture = await readFile(new URL('./fixtures/municipalities.csv', import.meta.url), 'utf8');
const requestData = {
  type: 'load',
  year: 2025,
  knownCodes: ['552429', '568392'],
  codes: ['552429', '568392'],
};

test('the production worker preserves zero, confidential, empty, and decimal values', async () => {
  const request = createWorker(source);
  const result = await request({ ...requestData, blob: new Blob([fixture]) });
  assert.equal(result.rowCount, 6);
  assert.equal(result.values['110900'][0], 0);
  assert.equal(result.values['110900'][1], 1307);
  assert.equal(result.values['010300'][0], 302.78);
  assert.equal(result.values['121800'][0], 'i.d.');
  assert.equal(result.values['113000'][0], null);
  assert.equal(result.values['010300'][1], null);
  const changed = await request({ type: 'query', year: 2025, codes: ['599999', '552429'] });
  assert.equal(changed.values['999999'][0], -12.5);
  assert.equal(changed.values['110900'][1], 0);
});

test('the worker rejects mismatched years and HTML error pages', async () => {
  await assert.rejects(
    createWorker(source)({ ...requestData, year: 2024, blob: new Blob([fixture]) }),
    /nesprávný rok/,
  );
  await assert.rejects(
    createWorker(source)({ ...requestData, blob: new Blob(['<html>Server error</html>']) }),
    /hlavička/,
  );
});

test('CSV records split across streaming chunks are retained', async () => {
  const csv =
    'rok,"kodukaz","koduzemi",hodnota\r\n' + '2025,"110900","552429",306\r\n'.repeat(50000);
  const result = await createWorker(source)({ ...requestData, blob: new Blob([csv]) });
  assert.equal(result.rowCount, 50000);
  assert.equal(result.values['110900'][0], 306);
});
