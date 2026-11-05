import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCube, observations, chartProjection } from '../src/core/cube.js';
import { comparisonRows, markOutliers, comparisonCsv, outlierLabel } from '../src/core/analysis.js';
import { chartOptions } from '../src/ui/charts.js';
import { alignSelection } from '../src/data/datastat.js';

function rowsOf(cube) {
  return [...observations(cube)].map((row) => ({
    _index: row.index,
    _value: row.value,
    _unit: row.unit,
    _status: row.status,
    ...Object.fromEntries(
      cube.dimensions.flatMap((dim, i) => [
        [`c${i}`, row.coordinates[dim.id].id],
        [`d${i}`, row.coordinates[dim.id].label],
      ]),
    ),
  }));
}
function sample() {
  const dimensions = [
    {
      id: 'measure',
      role: 'metric',
      categories: [
        { id: 'cost', label: 'Cost' },
        { id: 'base', label: 'Base' },
      ],
    },
    {
      id: 'product',
      role: 'category',
      categories: [
        { id: '001', label: 'A' },
        { id: '002', label: 'B' },
      ],
    },
    {
      id: 'quarter',
      role: 'time',
      categories: [
        { id: 'Q1', label: 'First' },
        { id: 'Q2', label: 'Second' },
      ],
    },
    {
      id: 'market',
      role: 'category',
      categories: [
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
      ],
    },
  ];
  return makeCube({
    dimensions,
    values: [100, 200, 300, 600, 0, null, 0, null, 10, 20, 100, 200, 20, 40, 20, 40],
    units: { cost: { label: 'EUR' }, base: { label: 'item' } },
  });
}

test('table ratios and chart ratios use every coordinate, preserve zeros and original values, and export unrounded calculations beside originals', () => {
  const cube = sample(),
    config = { transform: 'ratio', denominator: 'base', scale: 1000 };
  const table = comparisonRows(cube, rowsOf(cube), config);
  const chart = chartProjection(cube, {
    ...config,
    x: 'quarter',
    series: 'product',
    metric: 'cost',
    fixed: { market: 'west' },
  });
  assert.deepEqual(
    chart.series.map((s) => s.values),
    [[10000, 3000]],
  );
  // The second product has no numeric West data, and must never become a zero series.
  assert.equal(
    table.find((r) => r.c0 === 'cost' && r.c1 === '002' && r.c2 === 'Q1' && r.c3 === 'east')
      ._derived,
    0,
  );
  for (const item of chart.series)
    for (const [index, category] of chart.categories.entries()) {
      const row = table.find(
        (r) => r.c0 === 'cost' && r.c1 === item.id && r.c2 === category.id && r.c3 === 'west',
      );
      assert.equal(row._derived, item.values[index]);
    }
  const row = table[0];
  assert.equal(row._value, 100);
  assert.equal(row._derived, 10000);
  assert.equal(row._derivedUnit, 'EUR / item × 1 000');
  const csv = comparisonCsv(cube, table, config),
    original = csv.fields.indexOf('Hodnota');
  assert.equal(csv.fields[original + 1], 'Přepočtená hodnota');
  assert.equal(csv.data[0][original], 100);
  assert.equal(csv.data[0][original + 1], 10000);
  assert.equal(csv.data[0][csv.fields.indexOf('Jmenovatel – kód')], 'base');
  assert.equal(csv.data[0][csv.fields.indexOf('Měřítko poměru')], 1000);
  assert(csv.data.every((r) => r.length === csv.fields.length));
  assert.equal(cube.values[0], 100);
});

test('missing and zero reference denominators never create Infinity or synthetic zero; external reference profiles use the same calculation', () => {
  const cube = makeCube({
    dimensions: [{ id: 'items', categories: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }] }],
    values: [10, 10, 0, 1e308],
    metadata: {
      references: {
        ref: {
          label: 'Reference',
          unit: 'unit',
          values: { '["A"]': 0, '["B"]': null, '["C"]': 2, '["D"]': 1e-100 },
        },
      },
    },
  });
  const config = { transform: 'ratio', denominator: 'ref', scale: 1000 };
  assert.deepEqual(
    comparisonRows(cube, rowsOf(cube), config).map((r) => r._derived),
    [null, null, 0, null],
  );
  assert.deepEqual(chartProjection(cube, { ...config, x: 'items' }).series[0].values, [
    null,
    null,
    0,
    null,
  ]);
  assert.throws(() => comparisonRows(cube, rowsOf(cube), { ...config, denominator: 'unknown' }));
});

test('summaries retain metrics and other dimensions, sum annual ratios rather than divide sums, and expose partial coverage', () => {
  const cube = sample(),
    config = {
      transform: 'ratio',
      denominator: 'base',
      scale: 1000,
      aggregate: 'quarter',
      compare: 'product',
    };
  const summaries = markOutliers(cube, comparisonRows(cube, rowsOf(cube), config), config);
  assert.equal(summaries.length, 8);
  const row = summaries.find((r) => r.c0 === 'cost' && r.c1 === '001' && r.c3 === 'east');
  assert.equal(row._value, 400);
  assert.equal(row._derived, 13000);
  assert.notEqual(row._derived, (400 / 110) * 1000);
  assert.equal(row.c2, 'Q1, Q2');
  assert.equal(row._coverage, '2 z 2');
  const missing = summaries.find((r) => r.c0 === 'cost' && r.c1 === '002' && r.c3 === 'west');
  assert.equal(missing._value, null);
  assert.equal(missing._derived, null);
  assert.equal(missing._coverage, '0 z 2');
  assert.equal(outlierLabel(missing), 'Neúplný součet');
  assert.equal(missing._peerCount, 0);
  const originals = rowsOf(cube);
  originals[0]._value = null;
  const partial = markOutliers(cube, comparisonRows(cube, originals, config), config)[0];
  assert.equal(partial._value, 300);
  assert.equal(partial._coverage, '1 z 2');
  assert.equal(partial._analysisValue, null);
  const csv = comparisonCsv(cube, summaries, config);
  assert(csv.fields.includes('Součet přepočtených hodnot'));
  assert(csv.fields.includes('Pokrytí přepočteného součtu'));
  assert(csv.data.every((r) => r.length === csv.fields.length));
});

test('outlier cohorts never mix periods, other dimensions, units or hierarchy levels; small and constant cohorts are handled explicitly', () => {
  const cube = makeCube({
    dimensions: [
      {
        id: 'item',
        categories: Array.from({ length: 6 }, (_, i) => ({
          id: String(i),
          level: i === 5 ? 'TOTAL' : 'ITEM',
        })),
      },
      { id: 'period', role: 'time', categories: [{ id: 'A' }, { id: 'B' }] },
    ],
    values: [1, 10000, 2, 10000, 2, 10000, 3, 10000, 100, 10000, 1e6, 1e6],
  });
  const rows = markOutliers(cube, comparisonRows(cube, rowsOf(cube)), { compare: 'item' });
  assert.equal(rows[8]._outlier, 'high');
  assert.equal(rows[8]._peerCount, 5);
  assert.equal(rows[8]._median, 2);
  assert.equal(rows[9]._outlier, '');
  assert.equal(rows[10]._peerCount, 1);
  rows[8]._unit = 'other';
  markOutliers(cube, rows, { compare: 'item' });
  assert.equal(rows[0]._peerCount, 4);
  assert.equal(rows[8]._peerCount, 1);
  assert(rows.every((r) => !r._outlier));
  const low = rows
    .slice(0, 5)
    .map((r, i) => ({ ...r, c1: 'same', _value: i === 0 ? -100 : 1, _unit: 'unit' }));
  markOutliers(cube, low, { compare: 'item' });
  assert.equal(low[0]._outlier, 'low');
});

test('manual chart selection can include a series beyond the first fifty, and automatic ranks use calculated values with gaps last', () => {
  const cube = makeCube({
    dimensions: [
      { id: 'product', categories: Array.from({ length: 60 }, (_, i) => ({ id: `P${i}` })) },
      { id: 'time', role: 'time', categories: [{ id: 'Q1' }, { id: 'Q2' }] },
    ],
    values: Array.from({ length: 120 }, (_, i) => i),
    metadata: {
      references: {
        base: {
          unit: 'unit',
          values: Object.fromEntries(
            Array.from({ length: 120 }, (_, i) => [
              JSON.stringify([`P${Math.floor(i / 2)}`, i % 2 ? 'Q2' : 'Q1']),
              i >= 118 ? 10000 : 1,
            ]),
          ),
        },
      },
    },
  });
  const config = {
    x: 'time',
    series: 'product',
    transform: 'ratio',
    denominator: 'base',
    scale: 1,
    limit: 20,
  };
  assert.deepEqual(
    chartProjection(cube, { ...config, seriesIds: ['P59', 'P1'] }).series.map((s) => s.id),
    ['P59', 'P1'],
  );
  assert.deepEqual(chartProjection(cube, { ...config, seriesIds: [] }).series, []);
  assert.equal(
    chartProjection(cube, { ...config, seriesOrder: 'desc', limit: 1 }).series[0].id,
    'P58',
  );
  assert.equal(
    chartProjection(cube, {
      ...config,
      seriesOrder: 'outlier',
      seriesScores: { P32: 100 },
      limit: 1,
    }).series[0].id,
    'P32',
  );
  assert.deepEqual(
    chartProjection(cube, { ...config, categoryIds: ['Q2'] }).categories.map((c) => c.id),
    ['Q2'],
  );
  const sorted = chartProjection(cube, {
    ...config,
    x: 'product',
    series: '',
    fixed: { time: 'Q2' },
    sort: 'desc',
  });
  assert.equal(sorted.categories[0].id, 'P58');
});

test('outlier markers use the plotted value and survive static image options without changing series values', () => {
  const projection = {
    categories: [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
    ],
    series: [{ id: 'cost', name: 'Cost', values: [10, 100], outliers: [1] }],
    unit: 'EUR',
  };
  const options = chartOptions(projection, { type: 'horizontal', staticExport: true });
  assert.deepEqual(options.series[0].data, [10, 100]);
  assert.deepEqual(options.series[0].markPoint.data[0].coord, [100, 1]);
  assert.equal(options.series[0].markPoint.data[0].name, 'Odlehlá hodnota');
});

test('alignment retains catalog hierarchy levels even when the data payload only contains codes and translated labels', () => {
  const cube = makeCube({
    dimensions: [
      {
        id: 'territory',
        categories: [
          { id: 'region', label: 'Region' },
          { id: 'town', label: 'Town' },
        ],
      },
    ],
    values: [10000, 100],
  });
  const aligned = alignSelection(
    cube,
    {
      dimensions: [
        {
          id: 'territory',
          categories: [
            { id: 'region', label: 'Kraj', level: 'REGION' },
            { id: 'town', label: 'Obec', level: 'TOWN' },
          ],
        },
      ],
    },
    { territory: ['region', 'town'] },
  );
  assert.deepEqual(
    aligned.dimensions[0].categories.map((c) => c.level),
    ['REGION', 'TOWN'],
  );
  assert.deepEqual(
    aligned.dimensions[0].categories.map((c) => c.label),
    ['Region', 'Town'],
  );
});

test('overflowed sums are explicitly marked and never exported as Infinity or coerced to zero', () => {
  const cube = makeCube({
    dimensions: [{ id: 'time', role: 'time', categories: [{ id: 'A' }, { id: 'B' }] }],
    values: [1e308, 1e308],
  });
  const rows = comparisonRows(cube, rowsOf(cube), { aggregate: 'time' });
  assert.equal(rows[0]._value, null);
  assert.match(rows[0]._status, /konečným/);
});
