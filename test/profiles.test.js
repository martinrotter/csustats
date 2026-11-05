import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PartitionedCsvSource } from '../src/data/csv-source.js';
import { SourceRegistry } from '../src/data/sources.js';
import { DataCache } from '../src/data/cache.js';
import { bundleWorker } from '../scripts/lib/bundle.mjs';
import { createWorker } from './helpers/worker.js';
import { observations, chartProjection } from '../src/core/cube.js';

test('a second CSV profile uses nonmunicipal entities, different headers, quarters and generic reference metrics', async () => {
  const profile = {
    id: 'business',
    title: 'Produkty',
    source: 'CSV',
    provider: 'Testovací poskytovatel',
    code: 'PRODUCTS',
    catalogCacheKey: 'products-catalog',
    catalogs: {
      entities: { required: ['product_id', 'product_name'] },
      metrics: { required: ['code', 'name', 'unit'] },
    },
    metric: {
      id: 'measure',
      label: 'Veličina',
      catalog: 'metrics',
      code: 'code',
      name: 'name',
      unit: 'unit',
      default: 'SALES',
    },
    entity: {
      id: 'product',
      label: 'Produkt',
      role: 'category',
      catalog: 'entities',
      code: 'product_id',
      name: 'product_name',
    },
    time: {
      id: 'quarter',
      label: 'Čtvrtletí',
      items: [{ id: '2026-Q1', label: '1. čtvrtletí 2026', from: '2026-01-01', to: '2026-04-01' }],
    },
    file: {
      url: 'https://opendata.csu.gov.cz/fixture/{period}.csv',
      cacheKey: 'products-{period}',
      fields: { entity: 'product', metric: 'metric', time: 'quarter', value: 'amount' },
    },
    referenceMetrics: ['BASE'],
  };
  const cache = new DataCache({ indexedDB: undefined });
  await cache.put({
    key: 'products-catalog',
    savedAt: Date.now(),
    texts: {
      entities: 'product_id,product_name\nP-A,Produkt A\nP-B,Produkt B',
      metrics: 'code,name,unit\nSALES,Prodeje,Kč\nBASE,Základ,osoba',
    },
  });
  await cache.put({
    key: 'products-2026-Q1',
    blob: new Blob([
      'product,metric,quarter,amount,description\nP-A,SALES,2026-Q1,200,extra\nP-B,SALES,2026-Q1,0,extra\nP-A,BASE,2026-Q1,100,extra\nP-B,BASE,2026-Q1,20,extra',
    ]),
    savedAt: Date.now(),
  });
  const request = createWorker(await bundleWorker());
  const processor = {
    async request(message) {
      const result = await request(message);
      this.indexKey = result.indexKey;
      return result;
    },
  };
  const source = new PartitionedCsvSource({
    profile,
    cache,
    processor,
    client: {
      request() {
        throw new Error('Must use existing resources');
      },
    },
  });
  const descriptor = await source.descriptor();
  const cube = await source.load(descriptor, {
    measure: ['SALES'],
    product: ['P-A', 'P-B'],
    quarter: ['2026-Q1'],
  });
  assert.deepEqual(
    [...observations(cube)].map((row) => row.value),
    [200, 0],
  );
  assert.equal(descriptor.dimensions[2].categories[0].resourceKey, 'products-2026-Q1');
  const chart = chartProjection(cube, {
    x: 'product',
    metric: 'SALES',
    transform: 'ratio',
    denominator: 'BASE',
    scale: 1000,
  });
  assert.deepEqual(chart.series[0].values, [2000, 0]);
  assert.equal(chart.denominator, 'Základ');
  assert(source.files(descriptor, { quarter: ['2026-Q1'] }, await cache.entries())[0].cached);
});

test('shared application and chart code contains no dataset-ID branches or hardcoded municipal indicators', async () => {
  for (const folder of ['app', 'core', 'ui'])
    for (const file of await readdir(new URL(`../src/${folder}/`, import.meta.url))) {
      if (!file.endsWith('.js')) continue;
      const text = await readFile(new URL(`../src/${folder}/${file}`, import.meta.url), 'utf8');
      assert(!/(?:===|!==)\s*['"]mos['"]/.test(text), `${folder}/${file} branches on a dataset ID`);
      assert(
        !/['"](?:110900|010000)['"]/.test(text),
        `${folder}/${file} hardcodes a source indicator`,
      );
    }
  const registry = new SourceRegistry({});
  assert(registry.resolve('mos'));
  assert.equal(registry.resolve('https://evil.invalid'), null);
});
