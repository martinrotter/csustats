import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DataCache, cachedResource } from '../src/data/cache.js';
import { PartitionedCsvSource } from '../src/data/csv-source.js';
import { DataStatSource, alignSelection } from '../src/data/datastat.js';
import { makeCube, observations, subsetCube } from '../src/core/cube.js';
import { bundleWorker } from '../scripts/lib/bundle.mjs';
import { createWorker } from './helpers/worker.js';

const csvProfile = JSON.parse(
  await readFile(new URL('../src/data/profiles.json', import.meta.url), 'utf8'),
)[0];
const makeCsvSource = (options) =>
  new PartitionedCsvSource({ ...options, profile: csvProfile, lookups: options.regions || {} });
const bundle = await bundleWorker();
const worker = () => {
  const request = createWorker(bundle);
  return {
    indexKey: null,
    async request(message) {
      const result = await request(message);
      if (result.indexKey) this.indexKey = result.indexKey;
      return result;
    },
  };
};
const memory = () => new DataCache({ indexedDB: undefined });
const fixture = await readFile(new URL('./fixtures/municipalities.csv', import.meta.url), 'utf8');

test('Czech metadata do not reuse previously cached browser-negotiated English names', async () => {
  const cache = memory();
  await cache.put({
    key: 'csu-meta:/sady',
    savedAt: Date.now(),
    data: [{ kod: 'TEST', nazev: 'Population' }],
  });
  let calls = 0;
  const source = new DataStatSource({
    cache,
    client: {
      async request() {
        calls++;
        return { blob: new Blob([JSON.stringify([{ kod: 'TEST', nazev: 'Obyvatelstvo' }])]) };
      },
    },
  });
  assert.equal((await source.catalog())[0].title, 'Obyvatelstvo');
  assert.equal((await source.catalog())[0].title, 'Obyvatelstvo');
  assert.equal(calls, 1);
});
const catalog = {
  territories:
    'koduzemi,obec,okres,platiod,platido\n552429,Svésedlice,Olomouc,2000,9999\n568392,Doloplazy,Olomouc,2000,9999',
  indicators:
    'kodukaz,nazev,mj,metodika,okruh\n110900,Počet obyvatel,osoba,Stav na konci roku,01\n121800,Chráněné,počet,Test,01\n010300,Plocha,ha,Výměra,01',
  topics: 'kod,nazev\n01,Obecná charakteristika',
};

test('MOS consumes the original catalog/year cache without a single network request', async () => {
  const cache = memory();
  await cache.put({ key: 'catalog', savedAt: Date.now(), texts: catalog });
  await cache.put({
    key: 'year-2025',
    year: 2025,
    savedAt: Date.now(),
    size: fixture.length,
    blob: new Blob([fixture]),
  });
  let calls = 0;
  const source = makeCsvSource({
    cache,
    processor: worker(),
    regions: { districts: { Olomouc: 'Olomoucký kraj' } },
    client: {
      request() {
        calls++;
        throw new Error('Network must not be used');
      },
    },
  });
  const descriptor = await source.descriptor();
  assert.equal(
    descriptor.dimensions[1].categories
      .find((item) => item.id === '552429')
      .groups.some((item) => item.label === 'Kraj: Olomoucký kraj'),
    true,
  );
  const selections = {
    IndicatorType: ['110900', '121800', '010300'],
    obec: ['552429', '568392'],
    rok: ['2025'],
  };
  const cube = await source.load(descriptor, selections);
  assert.equal(cube.count, 6);
  assert.deepEqual(
    [...observations(cube)].map((row) => row.value),
    [0, 1307, null, null, 302.78, null],
  );
  assert.equal(cube.statuses.get(2), 'i.d.');
  assert.equal(cube.metadata.references['110900'].values['["568392","2025"]'], 1307);
  await source.load(descriptor, selections);
  assert.equal(calls, 0);
});

test('invalid cached MOS CSV is removed instead of repeatedly poisoning future loads', async () => {
  const cache = memory();
  await cache.put({ key: 'catalog', savedAt: Date.now(), texts: catalog });
  await cache.put({ key: 'year-2025', year: 2025, blob: new Blob(['<html>bad gateway</html>']) });
  const source = makeCsvSource({
    cache,
    processor: worker(),
    regions: {},
    client: {
      request() {
        throw new Error('unexpected network');
      },
    },
  });
  const descriptor = await source.descriptor();
  await assert.rejects(
    source.load(descriptor, { IndicatorType: ['110900'], obec: ['552429'], rok: ['2025'] }),
    /hlavička/,
  );
  assert.equal(await cache.get('year-2025'), null);
});

test('cached metadata expire, force refresh bypasses cache, and fallback explicitly marks stale data', async () => {
  const cache = memory();
  let calls = 0,
    stale = false;
  await cache.put({ key: 'test', data: { n: 1 }, savedAt: Date.now() });
  assert.deepEqual(
    await cachedResource(cache, 'test', 10000, () => {
      calls++;
      return { n: 2 };
    }),
    { n: 1 },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await cachedResource(
      cache,
      'test',
      10000,
      async () => {
        calls++;
        return { n: 2 };
      },
      { force: true },
    ),
    { n: 2 },
  );
  assert.equal(calls, 1);
  const record = await cache.get('test');
  record.savedAt = 0;
  assert.deepEqual(
    await cachedResource(
      cache,
      'test',
      1,
      async () => {
        throw new Error('offline');
      },
      {
        onStale() {
          stale = true;
        },
      },
    ),
    { n: 2 },
  );
  assert(stale);
  await assert.rejects(
    cachedResource(cache, 'test', 1, async () => {
      throw new DOMException('abort', 'AbortError');
    }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    cachedResource(
      cache,
      'test',
      1,
      async () => {
        throw new Error('offline');
      },
      { force: true },
    ),
    /offline/,
  );
});

test('memory fallback is bounded and cache entry listings omit the raw data payload', async () => {
  let warnings = 0;
  const cache = new DataCache({
    indexedDB: undefined,
    maxMemoryBytes: 10,
    onWarning() {
      warnings++;
    },
  });
  await cache.open();
  await cache.put({ key: 'first', size: 6, blob: new Blob(['first']) });
  await cache.put({ key: 'second', size: 6, blob: new Blob(['second']) });
  assert.equal(await cache.get('first'), null);
  assert.equal(warnings, 1);
  const entries = await cache.entries();
  assert.equal(entries.length, 1);
  assert(!('blob' in entries[0]));
});

test('the production worker handles JSON-stat, CSV, tabular JSON and invalid payloads', async () => {
  const processor = worker();
  const json = {
    class: 'dataset',
    id: ['period'],
    size: [2],
    role: { time: ['period'] },
    dimension: { period: { label: 'Rok', category: { index: ['2024', '2025'] } } },
    value: [0, null],
  };
  const cube = await processor.request({ type: 'parse-jsonstat', text: JSON.stringify(json) });
  assert.equal(cube.values[0], 0);
  assert(Number.isNaN(cube.values[1]));
  const table = await processor.request({
    type: 'parse-table',
    format: 'csv',
    text: 'code;value\n001;"2,5"\n002;0',
  });
  const converted = await processor.request({
    type: 'cube-table',
    table,
    mapping: { value: 'value', dimensions: [{ id: 'code' }] },
  });
  assert.equal(converted.values[0], 2.5);
  assert.equal(converted.dimensions[0].categories[0].id, '001');
  const records = await processor.request({
    type: 'parse-table',
    format: 'json',
    text: '[{"a":"x","n":3}]',
  });
  assert.equal(records.rows[0].n, 3);
  await assert.rejects(processor.request({ type: 'parse-jsonstat', text: '{"error":"server"}' }));
});

test('response alignment follows requested dimensions and makes omitted categories genuinely missing', () => {
  const cube = makeCube({
    dimensions: [
      { id: 'time', categories: [{ id: '2025', label: '2025' }] },
      { id: 'place', categories: [{ id: '001', label: 'Obec' }] },
    ],
    values: [4],
  });
  const descriptor = {
    dimensions: [
      {
        id: 'place',
        categories: [
          { id: '001', label: 'Obec' },
          { id: '002', label: 'Chybí' },
        ],
      },
      {
        id: 'time',
        categories: [
          { id: '2024', label: '2024' },
          { id: '2025', label: '2025' },
        ],
      },
    ],
  };
  const aligned = alignSelection(cube, descriptor, {
    place: ['001', '002'],
    time: ['2024', '2025'],
  });
  assert.deepEqual(
    [...observations(aligned)].map((row) => row.value),
    [null, 4, null, null],
  );
  assert.throws(
    () => alignSelection(cube, descriptor, { place: ['002'], time: ['2025'] }),
    /mimo požadovaný/,
  );
  assert.deepEqual(
    [...observations(subsetCube(aligned, { place: ['001'], time: ['2025'] }))].map(
      (row) => row.value,
    ),
    [4],
  );
});

test('DataStat does not persist HTML/invalid metadata or cache an invalid JSON-stat response', async () => {
  const cache = memory();
  const processor = worker();
  const source = new DataStatSource({
    cache,
    processor,
    client: { request: async () => ({ blob: new Blob(['{"error":"bad"}']) }) },
  });
  await assert.rejects(source.catalog(), /metadata|metadat/);
  assert.equal((await cache.entries()).length, 0);
  const descriptor = {
    code: 'TEST',
    version: '1',
    title: 'Test',
    dimensions: [{ id: 'period', label: 'Období', categories: [{ id: '2024' }] }],
  };
  await assert.rejects(source.load(descriptor, { period: ['2024'] }));
  assert.equal((await cache.entries()).length, 0);
});

test('captured real DataStat monthly and school-year formats pass through the production worker', async () => {
  for (const [code, periods, values] of [
    ['kpr1', ['2026-08', '2026-09', '2026-10'], [100.5, 99.5, 97.9]],
    ['vzd01', ['SR2023', 'SR2024', 'SR2025'], [5398, 5410, 5409]],
  ]) {
    const text = await readFile(
      new URL(`./fixtures/datastat-${code}.json`, import.meta.url),
      'utf8',
    );
    const cube = await worker().request({ type: 'parse-jsonstat', text });
    assert.deepEqual(
      Array.from(cube.dimensions.find((dim) => dim.role === 'time').categories, (item) => item.id),
      periods,
    );
    assert.deepEqual(Array.from(cube.values), values);
    assert.equal(cube.source, 'DataStat – databáze ČSÚ');
  }
});

test('DataStat defaults use the official positive indicator filter and keep optional dimensions inactive', async () => {
  const source = new DataStatSource({});
  const variants = [
    { kod: 'TIME', nazev: 'Rok', typDimenzeKod: 'REF_CAS', verze: '1' },
    { kod: 'SEX', nazev: 'Pohlaví', typDimenzeKod: 'POHLAVI', verze: '1' },
  ];
  source.json = async (path) => {
    if (path === '/sady/TEST')
      return {
        kod: 'TEST',
        nazev: 'Test',
        ukazatele: [
          { kod: 'COUNT', nazev: 'Počet škol' },
          { kod: 'CHILDREN', nazev: 'Děti' },
        ],
        variantyDimenze: variants,
        pravidlaVyberu: { povinneDimenze: ['REF_CAS'] },
      };
    if (path === '/sady/TEST/vybery') return [{ kod: 'PRESET' }];
    if (path === '/vybery/PRESET')
      return {
        vyber: {
          variantyDimenze: [variants[0]],
          obsahVyberu: {
            sloupce: [{ kodDimenze: 'IndicatorType', filtr: [{ zobrazitPolozky: ['CHILDREN'] }] }],
          },
        },
      };
    return [{ kod: '2024', nazev: '2024' }];
  };
  const descriptor = await source.descriptor('TEST');
  const selection = await source.populateDimensions(descriptor);
  assert.deepEqual(selection.IndicatorType, ['CHILDREN']);
  assert.deepEqual(
    descriptor.dimensions.map((dim) => dim.id),
    ['IndicatorType', 'TIME'],
  );
  assert(descriptor.variants.has('POHLAVI'));
});
