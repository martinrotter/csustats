import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CsuTransfers } from '../src/core/transfers.js';
import { CsuCoverage } from '../src/core/coverage.js';
import { CsuPlaces } from '../src/core/places.js';
import { esc, fold, fmt } from '../src/core/format.js';

test('bulk selection keeps whole groups, deduplicates, and supports replacement', () => {
  const incoming = Array.from({ length: 500 }, (_, index) => String(500000 + index));
  assert.equal(CsuPlaces.merge(['500000', '599999'], incoming).length, 501);
  assert.deepEqual(CsuPlaces.merge(['599999'], incoming, true), incoming);
});

test('download plan skips stored years and does not duplicate a year', () => {
  const plan = CsuTransfers.plan([2025, 2024, 2025, 2023], [{ year: 2024, size: 43861928 }]);
  assert.equal(plan.length, 3);
  assert.equal(plan[1].status, 'cached');
  assert.equal(plan.filter((task) => !task.cached).length, 2);
});

test('progress remains honest with missing or compressed content lengths', () => {
  assert.equal(CsuTransfers.fraction(5, 20), 18.75);
  assert.equal(CsuTransfers.fraction(25, 20), null);
  assert.equal(CsuTransfers.fraction(5, 0), null);
  assert.equal(CsuTransfers.overall([{ fraction: 0.5 }, { cached: true, fraction: 0 }]), 75);
});

test('coverage counts zero, excludes confidential values, and marks sparse data', () => {
  const result = CsuCoverage.summarize([0, null, 'i.d.', undefined, 12]);
  assert.equal(result.count, 2);
  assert.equal(result.sparse, true);
  assert.equal(CsuCoverage.summarize([0]).sparse, false);
  assert.equal(CsuCoverage.summarize([1, null]).sparse, true);
  assert.equal(CsuCoverage.summarize([null, 'i.d.']).count, 0);
});

test('formatting distinguishes missing, protected, numeric, and untrusted text', () => {
  assert.equal(fmt(null), '—');
  assert.equal(fmt('i.d.'), 'i.d.');
  assert.equal(fmt(0), '0');
  assert.equal(fold('Svésedlice'), 'svesedlice');
  assert.equal(esc('<b>"&'), '&lt;b&gt;&quot;&amp;');
});

test('the regional catalog includes every Czech region and MOS name aliases', async () => {
  const catalog = JSON.parse(
    await readFile(new URL('../src/data/regions.json', import.meta.url), 'utf8'),
  );
  assert.equal(new Set(Object.values(catalog.districts)).size, 14);
  assert.equal(catalog.districts.Olomouc, 'Olomoucký kraj');
  assert.equal(catalog.districts['Jablonec n.Nisou'], 'Liberecký kraj');
});
