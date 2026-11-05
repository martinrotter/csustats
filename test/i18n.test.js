import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parsers } from 'prettier/plugins/acorn.mjs';
import english from '../src/i18n/en.json' with { type: 'json' };
import {
  t,
  ht,
  setLanguage,
  getLanguage,
  getLocale,
  preferredLanguage,
  messageKey,
  translateMessage,
  errorText,
} from '../src/i18n/index.js';
import {
  makeCube,
  chartProjection,
  formatNumber,
  localizeGeneratedLabels,
} from '../src/core/cube.js';
import { chartOptions, chartSubtitle } from '../src/ui/charts.js';
import { ApiClient, RateGate, HttpError } from '../src/core/http.js';
import { DataStatSource } from '../src/data/datastat.js';
import { DataCache } from '../src/data/cache.js';
import { bundleWorker } from '../scripts/lib/bundle.mjs';
import { createWorker } from './helpers/worker.js';

test('all authored static UI, accessibility attributes and translation calls have English messages with matching placeholders', async () => {
  const messages = new Set();
  const raw = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  const html = raw
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<select[^>]*data-i18n-skip[\s\S]*?<\/select>/g, '');
  for (const [, text] of html.matchAll(/>([^<>]+)</g))
    if (/[a-zA-Zá-ž]/.test(text)) messages.add(messageKey(text));
  for (const [, text] of html.matchAll(/(?:aria-label|placeholder|title)="([^"]+)"/g))
    messages.add(messageKey(text));
  for (const directory of ['app', 'ui', 'core', 'data', 'i18n'])
    for (const name of await readdir(new URL(`../src/${directory}/`, import.meta.url))) {
      if (!name.endsWith('.js')) continue;
      const source = await readFile(
        new URL(`../src/${directory}/${name}`, import.meta.url),
        'utf8',
      );
      const ast = await parsers.acorn.parse(source, {});
      function visit(node) {
        if (
          node.type === 'CallExpression' &&
          ['t', 'ht'].includes(node.callee?.name) &&
          typeof node.arguments[0]?.value === 'string'
        )
          messages.add(messageKey(node.arguments[0].value));
        if (node.type === 'TaggedTemplateExpression' && node.tag.name === 't')
          messages.add(
            messageKey(
              node.quasi.quasis
                .map(
                  (q, index) =>
                    q.value.cooked + (index < node.quasi.expressions.length ? `{${index}}` : ''),
                )
                .join(''),
            ),
          );
        for (const [key, value] of Object.entries(node))
          if (key !== 'comments') {
            if (value?.type) visit(value);
            else if (Array.isArray(value)) value.filter((child) => child?.type).forEach(visit);
          }
      }
      visit(ast);
    }
  for (const key of messages)
    assert(Object.hasOwn(english, key), `Missing English message: ${key}`);
  for (const [key, value] of Object.entries(english)) {
    assert.equal(typeof value, 'string');
    assert(value.trim(), `Empty translation: ${key}`);
    assert.deepEqual(
      [...key.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      `Placeholders: ${key}`,
    );
  }
});

test('initial language prefers shared links, then manual preference, then the first supported browser language, with Czech fallback', () => {
  const shared = (language) => '#view=' + encodeURIComponent(JSON.stringify({ language }));
  assert.equal(preferredLanguage(shared('cs'), 'en', ['en-US']), 'cs');
  assert.equal(preferredLanguage(shared('en'), 'cs', ['cs-CZ']), 'en');
  assert.equal(preferredLanguage('#language=en', 'cs', ['cs-CZ']), 'en');
  assert.equal(preferredLanguage('', 'cs', ['en-US']), 'cs');
  assert.equal(preferredLanguage('', 'en', ['cs-CZ']), 'en');
  assert.equal(preferredLanguage('', null, ['en-GB', 'cs-CZ']), 'en');
  assert.equal(preferredLanguage('', undefined, ['cs-CZ', 'en-US']), 'cs');
  assert.equal(preferredLanguage('', '', ['fr-FR', 'EN-us', 'cs']), 'en');
  assert.equal(preferredLanguage(shared('de'), 'invalid', ['cs-CZ', 'en']), 'cs');
  assert.equal(preferredLanguage('#view=broken', 'invalid', ['en-US']), 'en');
  assert.equal(preferredLanguage('', undefined, 'en-US'), 'en');
  assert.equal(preferredLanguage('', null, [null, 123, 'de-DE']), 'cs');
  assert.equal(preferredLanguage(), 'cs');
});

test('language selection validates values and preserves original source text and HTML-safe substitutions', () => {
  try {
    assert.equal(
      preferredLanguage('#view=' + encodeURIComponent(JSON.stringify({ language: 'en' })), 'cs'),
      'en',
    );
    assert.equal(preferredLanguage('', 'en'), 'en');
    assert.equal(preferredLanguage('#view=broken', 'en'), 'en');
    assert.equal(preferredLanguage('#language=javascript:alert(1)', 'invalid'), 'cs');
    setLanguage('en');
    assert.equal(getLocale(), 'en-GB');
    assert.equal(t('Hodnota'), 'Value');
    assert.equal(t`Vybráno ${2} z ${10} položek`, 'Selected 2 of 10 items');
    assert.equal(t('načteno ') + 'today', 'retrieved today');
    assert.equal(t`Výřez grafu: ${'Národní data'}`, 'Chart slice: Národní data');
    assert.equal(
      ht('Odebrat členění {0}', '&lt;img src=x&gt;'),
      'Remove breakdown: &lt;img src=x&gt;',
    );
    assert.equal(t('A user-provided label'), 'A user-provided label');
    const previous = new HttpError(429).message;
    setLanguage('cs');
    assert(translateMessage(previous).startsWith('Poskytovatel omezil'));
    assert.equal(t('Hodnota'), 'Hodnota');
    assert.equal(
      errorText(new SyntaxError('native browser message')),
      'Data nemají platný formát JSON.',
    );
    setLanguage('invalid');
    assert.equal(getLanguage(), 'cs');
  } finally {
    setLanguage('cs');
  }
});

test('numbers, chart captions and exports follow the language without altering values or category codes', () => {
  const cube = makeCube({
    dimensions: [
      {
        id: 'time',
        role: 'time',
        label: 'Custom label',
        categories: [{ id: '001', label: 'Original label' }],
      },
    ],
    values: [1234.5],
    units: { _value: { label: 'kg' } },
  });
  try {
    setLanguage('en');
    assert.equal(formatNumber(1234.5), '1,234.5');
    const projection = chartProjection(cube, { x: 'time' });
    const options = chartOptions(projection, { title: 'Original title', staticExport: true });
    assert.equal(options.title.subtext, 'Unit: kg');
    assert.equal(options.series[0].data[0], 1234.5);
    assert.equal(projection.categories[0].id, '001');
    assert.equal(options.title.text, 'Original title');
    assert.equal(
      chartSubtitle({ ...projection, base: '2023' }, { transform: 'index' }),
      'Index · 2023 = 100',
    );
    setLanguage('cs');
    assert.equal(formatNumber(1234.5), '1 234,5');
    assert.equal(chartOptions(projection).title.subtext, 'Jednotka: kg');
  } finally {
    setLanguage('cs');
  }
});

test('different-language requests share one rate gate but never deduplicate or change queued Accept-Language headers', async () => {
  let now = 100000;
  const starts = [],
    headers = [];
  const gate = new RateGate({
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    spacing: 1200,
  });
  const client = new ApiClient({
    gate,
    now: () => now,
    fetcher: async (_url, options) => {
      headers.push(options.headers['Accept-Language']);
      starts.push(now);
      return new Response(options.headers['Accept-Language']);
    },
  });
  const url = 'https://data.csu.gov.cz/api/katalog/v1/sady';
  try {
    setLanguage('cs');
    const cs = client.request(url);
    setLanguage('en');
    const en = client.request(url);
    setLanguage('cs');
    const responses = await Promise.all([cs, en]);
    assert.deepEqual(await Promise.all(responses.map((r) => r.blob.text())), ['cs', 'en']);
    assert.deepEqual(headers, ['cs', 'en']);
    assert(starts[1] - starts[0] >= 1200);
  } finally {
    setLanguage('cs');
  }
});

test('catalog and data caches are separated by language while numeric coordinates and request bodies stay identical', async () => {
  const cache = new DataCache({ indexedDB: undefined });
  const calls = [];
  const source = new DataStatSource({
    cache,
    client: {
      async request(url, options) {
        calls.push({ url, ...options });
        if (url.includes('/api/katalog/'))
          return {
            blob: new Blob([
              JSON.stringify([
                { kod: 'TEST', nazev: options.language === 'en' ? 'Population' : 'Obyvatelstvo' },
              ]),
            ]),
          };
        return { blob: new Blob(['valid']) };
      },
    },
    processor: {
      async request() {
        return makeCube({
          dimensions: [
            {
              id: 'IndicatorType',
              role: 'metric',
              categories: [{ id: 'POP', label: 'Population' }],
            },
            { id: 'geo', categories: [{ id: '001', label: 'Original' }] },
          ],
          values: [5],
        });
      },
    },
  });
  try {
    setLanguage('cs');
    assert.equal((await source.catalog())[0].title, 'Obyvatelstvo');
    setLanguage('en');
    assert.equal((await source.catalog())[0].title, 'Population');
    setLanguage('cs');
    assert.equal((await source.catalog())[0].title, 'Obyvatelstvo');
    assert.equal(calls.length, 2);
    const descriptor = {
      code: 'TEST',
      version: 1,
      dimensions: [
        { id: 'IndicatorType', role: 'metric', categories: [{ id: 'POP', label: 'Population' }] },
        { id: 'geo', categories: [{ id: '001', label: 'Original' }] },
      ],
    };
    const selections = { IndicatorType: ['POP'], geo: ['001'] };
    const cs = await source.load({ ...descriptor, language: 'cs' }, selections);
    const en = await source.load({ ...descriptor, language: 'en' }, selections);
    assert.deepEqual([...cs.values], [...en.values]);
    const posts = calls.filter((call) => call.method === 'POST');
    assert.deepEqual(
      posts.map((call) => call.language),
      ['cs', 'en'],
    );
    assert.deepEqual(posts[0].body, posts[1].body);
    await source.load({ ...descriptor, language: 'cs' }, selections);
    assert.equal(calls.length, 4);
    const keys = (await cache.entries()).map((item) => item.key);
    assert(
      keys.some((key) => key.startsWith('csu-meta:cs:')) &&
        keys.some((key) => key.startsWith('csu-meta:en:')),
    );
    assert(
      keys.some((key) => key.startsWith('csu-data:cs:')) &&
        keys.some((key) => key.startsWith('csu-data:en:')),
    );
    await cache.put({
      key: 'csu-meta:cs:/sady/UNAVAILABLE',
      savedAt: 0,
      data: { kod: 'UNAVAILABLE', nazev: 'Původní' },
    });
    const offline = new DataStatSource({
      cache,
      client: {
        async request() {
          throw new Error('offline');
        },
      },
    });
    await assert.rejects(offline.json('/sady/UNAVAILABLE', { language: 'en' }), /offline/);
    assert.equal((await offline.json('/sady/UNAVAILABLE', { language: 'cs' })).nazev, 'Původní');
  } finally {
    setLanguage('cs');
  }
});

test('only generated import labels are localized, including the reusable original cube and file provenance', () => {
  const cube = makeCube({
    dimensions: [
      { id: 'user', label: 'Ukazatel', categories: [{ id: '001', label: 'Hodnota' }] },
      {
        id: 'generated',
        label: 'Záznam',
        uiLabel: 'Záznam',
        categories: [{ id: 'value', label: 'Hodnota', uiLabel: 'Hodnota' }],
      },
    ],
    values: [0],
    metadata: { generatedLocalSource: true, localFileName: 'original.json' },
  });
  try {
    setLanguage('en');
    localizeGeneratedLabels(cube);
    assert.equal(cube.dimensions[0].label, 'Ukazatel');
    assert.equal(cube.dimensions[0].categories[0].label, 'Hodnota');
    assert.equal(cube.dimensions[1].label, 'Record');
    assert.equal(cube.dimensions[1].categories[0].label, 'Value');
    assert.equal(cube.source, 'Local file · original.json');
    setLanguage('cs');
    localizeGeneratedLabels(cube);
    assert.equal(cube.dimensions[1].label, 'Záznam');
    assert.equal(cube.source, 'Místní soubor · original.json');
    assert.equal(cube.values[0], 0);
  } finally {
    setLanguage('cs');
  }
});

test('the production worker localizes errors per message and keeps local CSV data unchanged', async () => {
  const worker = createWorker(await bundleWorker());
  await assert.rejects(
    worker({ type: 'parse-table', format: 'csv', text: '', language: 'en' }),
    /CSV structure/,
  );
  await assert.rejects(
    worker({ type: 'parse-table', format: 'csv', text: '', language: 'cs' }),
    /CSV má neplatnou/,
  );
  const table = await worker({
    type: 'parse-table',
    format: 'csv',
    text: 'code,value\n001,0\n002,12.5',
    language: 'en',
  });
  const cube = await worker({
    type: 'cube-table',
    table,
    mapping: { value: 'value', dimensions: [{ id: 'code' }] },
    language: 'en',
  });
  assert.equal(cube.source, 'Local file');
  assert.equal(cube.dimensions[0].categories[0].id, '001');
  assert.deepEqual([...cube.values], [0, 12.5]);
});

test('generated API indicator dimensions use the selected UI language rather than a fixed Czech label', async () => {
  try {
    setLanguage('en');
    const source = new DataStatSource({
      cache: new DataCache({ indexedDB: undefined }),
      client: {
        async request(url) {
          const data = url.endsWith('/vybery')
            ? []
            : {
                kod: 'TEST',
                nazev: 'Population',
                verze: 1,
                ukazatele: [{ kod: 'POP', nazev: 'Population' }],
                variantyDimenze: [],
              };
          return { blob: new Blob([JSON.stringify(data)]) };
        },
      },
    });
    const descriptor = await source.descriptor('TEST');
    assert.equal(descriptor.language, 'en');
    assert.equal(descriptor.dimensions[0].label, 'Indicator');
    assert.equal(descriptor.dimensions[0].categories[0].id, 'POP');
  } finally {
    setLanguage('cs');
  }
});
