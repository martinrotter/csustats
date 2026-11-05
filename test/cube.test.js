import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonStat,
  makeCube,
  observations,
  chartProjection,
  coverage,
} from '../src/core/cube.js';
import { parseCsv, parseRecords, tableToCube, parseDataStatCsv } from '../src/data/tabular.js';
import { chartOptions, chartSubtitle } from '../src/ui/charts.js';
import { queryBody, validateSelection } from '../src/data/datastat.js';

const sample = () => ({
  class: 'dataset',
  version: '2.0',
  id: ['IndicatorType', 'geo', 'time'],
  size: [1, 2, 3],
  role: { metric: ['IndicatorType'], geo: ['geo'], time: ['time'] },
  dimension: {
    IndicatorType: {
      label: 'Ukazatel',
      category: {
        index: ['POP'],
        label: { POP: 'Obyvatelé' },
        unit: { POP: { label: 'osoba', decimals: 0 } },
      },
    },
    geo: {
      label: 'Obec',
      category: { index: { '001': 1, '002': 0 }, label: { '001': 'Obec A', '002': 'Obec B' } },
    },
    time: {
      label: 'Rok',
      category: {
        index: ['2023', '2024', '2025'],
        label: { 2023: '2023', 2024: '2024', 2025: '2025' },
      },
    },
  },
  value: [0, 5, null, 10, 15, 20],
  status: { 2: 'D' },
  extension: { status: { label: { D: 'Důvěrný údaj' } } },
});

test('JSON-stat honors category index, string codes, units, true zero and protected values', () => {
  const cube = parseJsonStat(sample());
  assert.equal(cube.dimensions[1].categories[0].id, '002');
  const rows = [...observations(cube)];
  assert.deepEqual(
    rows.map((row) => row.value),
    [0, 5, null, 10, 15, 20],
  );
  assert.equal(rows[2].status, 'D');
  assert.equal(rows[3].coordinates.geo.id, '001');
  assert.equal(rows[0].unit, 'osoba');
  assert.deepEqual(coverage(cube), { numeric: 5, missing: 1, total: 6, ratio: 5 / 6 });
});

test('sparse, dense, uniform statuses, legacy 1.x wrappers and inline collection produce equivalent cubes', () => {
  const dense = sample();
  const sparse = { ...sample(), value: { 0: 0, 1: 5, 3: 10, 4: 15, 5: 20 } };
  assert.deepEqual([...parseJsonStat(sparse).values], [...parseJsonStat(dense).values]);
  const old = sample();
  delete old.id;
  delete old.size;
  old.dimension.id = ['IndicatorType', 'geo', 'time'];
  old.dimension.size = [1, 2, 3];
  assert.equal(parseJsonStat({ legacy: old }).count, 6);
  assert.equal(parseJsonStat({ class: 'collection', link: { item: [sample()] } }).count, 6);
  const uniform = sample();
  uniform.status = 'P';
  assert.equal(parseJsonStat(uniform).statuses.size, 6);
  const array = sample();
  array.status = ['', '', 'D', '', '', ''];
  assert.equal(parseJsonStat(array).statuses.get(2), 'D');
});

test('malformed cube shape and invalid numerical values fail rather than corrupt charts', () => {
  const variants = [
    (data) => {
      data.value.pop();
    },
    (data) => {
      data.value[0] = 'NaN';
    },
    (data) => {
      data.value[0] = Infinity;
    },
    (data) => {
      data.dimension.geo.category.index = { A: 0, B: 0 };
    },
    (data) => {
      data.dimension.time.category.index = ['2023', '2023', '2025'];
    },
    (data) => {
      data.value = { 99: 5 };
    },
    (data) => {
      data.status = { 99: 'D' };
    },
  ];
  for (const change of variants) {
    const data = sample();
    change(data);
    assert.throws(() => parseJsonStat(data));
  }
  assert.throws(() => parseJsonStat('<html>error</html>'));
  assert.throws(() => parseJsonStat(sample(), 5), /limit/);
  const giant = sample();
  giant.size = [1, 2, 1_000_000_000];
  assert.throws(() => parseJsonStat(giant), /limit/);
});

test('identical municipality names are distinguishable in legends without changing original metadata', () => {
  const categories = [
    { id: '001', label: 'Doloplazy', district: 'Olomouc' },
    { id: '002', label: 'Doloplazy', district: 'Prostějov' },
  ];
  const cube = makeCube({ dimensions: [{ id: 'geo', categories }], values: [1, 2] });
  assert.equal(categories[0].label, 'Doloplazy');
  assert.notEqual(cube.dimensions[0].categories[0].label, cube.dimensions[0].categories[1].label);
});

test('projection never sums away extra dimensions and preserves gaps', () => {
  const cube = parseJsonStat(sample());
  const projection = chartProjection(cube, { x: 'time', series: 'geo', metric: 'POP' });
  assert.deepEqual(
    projection.series.map((item) => item.values),
    [
      [0, 5, null],
      [10, 15, 20],
    ],
  );
  const fixed = chartProjection(cube, { x: 'time', metric: 'POP', fixed: { geo: '001' } });
  assert.deepEqual(fixed.series[0].values, [10, 15, 20]);
  assert.equal(fixed.fixed.geo, '001');
});

test('index uses a shared nonzero base and missing values remain null', () => {
  const projection = chartProjection(parseJsonStat(sample()), {
    x: 'time',
    series: 'geo',
    metric: 'POP',
    transform: 'index',
  });
  assert.equal(projection.base, '2024');
  assert.deepEqual(
    projection.series.map((item) => item.values),
    [
      [0, 100, null],
      [(10 / 15) * 100, 100, (20 / 15) * 100],
    ],
  );
});

test('series cap is explicit, sorting keeps missing values last, and generic ratios require an available nonzero denominator', () => {
  const cube = parseJsonStat(sample());
  assert.equal(chartProjection(cube, { x: 'time', series: 'geo', limit: 1 }).omitted, 1);
  const sorted = chartProjection(cube, { x: 'geo', fixed: { time: '2024' }, sort: 'desc' });
  assert.deepEqual(
    sorted.categories.map((item) => item.id),
    ['001', '002'],
  );
  cube.metadata.references = {
    BASE: {
      label: 'Základ',
      unit: 'osoba',
      values: { '["001","2023"]': 100, '["001","2024"]': 0, '["001","2025"]': null },
    },
  };
  const normalized = chartProjection(cube, {
    x: 'time',
    fixed: { geo: '001' },
    transform: 'ratio',
    denominator: 'BASE',
    scale: 1000,
  });
  assert.deepEqual(normalized.series[0].values, [100, null, null]);
});

test('CSV parser covers BOM, commas, semicolons, tabs, quotes, Czech decimals and multiline fields', () => {
  const table = parseCsv('\uFEFFobec;rok;hodnota\r\n"Obec; A";2023;"1 234,5"\r\n"Obec\nB";2023;0');
  assert.equal(table.rows[1].obec, 'Obec\nB');
  const cube = tableToCube(table, {
    value: 'hodnota',
    dimensions: [{ id: 'obec' }, { id: 'rok', role: 'time' }],
    unit: 'Kč',
  });
  assert.deepEqual([...cube.values], [1234.5, 0]);
  assert.equal(parseCsv('code\tvalue\n001\t3').rows[0].code, '001');
  assert.equal(parseCsv('code,value\n"A, B",4').rows[0].code, 'A, B');
  assert.throws(() => parseCsv('a,a\n1,2'), /CSV/);
  assert.throws(() => parseCsv('a,b\n1,2,3'), /CSV/);
});

test('tabular JSON supports flat record arrays while nested objects and duplicate coordinates fail', () => {
  const table = parseRecords([
    { obec: '001', rok: '2024', hodnota: 0 },
    { obec: '002', rok: '2024', hodnota: 'i.d.' },
  ]);
  const cube = tableToCube(table, {
    value: 'hodnota',
    dimensions: [{ id: 'obec' }, { id: 'rok' }],
  });
  assert.equal(cube.values[0], 0);
  assert(Number.isNaN(cube.values[1]));
  assert.equal(cube.statuses.get(1), 'i.d.');
  assert.throws(() => parseRecords([{ nested: { key: 1 } }]), /ploché/);
  assert.throws(
    () =>
      tableToCube(
        parseRecords([
          { a: 'x', n: 1 },
          { a: 'x', n: 2 },
        ]),
        { value: 'n', dimensions: [{ id: 'a' }] },
      ),
    /Více řádků/,
  );
});

test('ČSÚ flat open-data CSV keeps code/text pairs and per-indicator units', () => {
  const cube = parseDataStatCsv(
    'ukazatel_kod,ukazatel_txt,cas_kod,cas_txt,uzemi_kod,uzemi_txt,hodnota,mj_txt\nPOP,Počet,2024,2024,001,Obec,42,osoba',
  );
  assert.equal(cube.dimensions[2].categories[0].id, '001');
  assert.equal(cube.units.POP.label, 'osoba');
  assert.equal(cube.values[0], 42);
});

test('DataStat requests enumerate dimensions and explicit hierarchy levels; invalid selections are rejected', () => {
  const descriptor = {
    dimensions: [
      { id: 'IndicatorType', role: 'metric', label: 'Ukazatel', categories: [{ id: 'POP' }] },
      {
        id: 'geo',
        label: 'Území',
        categories: [{ id: '001', level: 'OBEC' }],
        levels: [{ id: 'KRAJ' }, { id: 'OBEC' }],
      },
    ],
  };
  const selections = { IndicatorType: ['POP'], geo: ['001'] };
  assert.equal(validateSelection(descriptor, selections), 1);
  const body = queryBody(descriptor, selections);
  assert.deepEqual(body.radky, []);
  assert.deepEqual(body.filtryTabulky, []);
  assert.deepEqual(body.sloupce[1].filtr, [
    { urovenHierarchieKod: 'KRAJ', zobrazitPolozky: [] },
    { urovenHierarchieKod: 'OBEC', zobrazitPolozky: ['001'] },
  ]);
  assert.throws(() => queryBody(descriptor, { ...selections, geo: ['unknown'] }), /Neplatná/);
  assert.throws(() => queryBody(descriptor, { ...selections, geo: [] }), /Vyberte/);
  descriptor.constraints = { forbiddenPairs: [{ metric: 'POP', dimensions: ['geo'] }] };
  assert.throws(() => queryBody(descriptor, selections), /nelze kombinovat/);
});

test('all chart types preserve null gaps, units, legends and source; tooltip HTML is escaped', () => {
  const projection = chartProjection(parseJsonStat(sample()), { x: 'time', series: 'geo' });
  for (const type of ['line', 'bar', 'horizontal', 'area', 'stacked', 'heatmap']) {
    const options = chartOptions(projection, { type, title: 'Test', source: 'ČSÚ' });
    assert.equal(options.title.text, 'Test');
    assert.equal(options.graphic[0].style.text, 'ČSÚ');
    assert.equal(options.tooltip.confine, true);
    if (type !== 'heatmap') {
      assert.equal(options.series[0].data[2], null);
      assert.equal(options.series[0].connectNulls, false);
    } else assert.equal(options.series[0].data.length, 5);
    const tooltip = options.tooltip.formatter([
      {
        axisValueLabel: '<img src=x>',
        seriesName: '<script>',
        value: type === 'heatmap' ? [0, 0, 0] : 0,
        color: '#123456',
      },
    ]);
    assert(!tooltip.includes('<img'));
    assert(!tooltip.includes('<script>'));
  }
});

test('long chart titles and selected slices wrap at mobile widths and reserve plot space', () => {
  const projection = chartProjection(parseJsonStat(sample()), { x: 'time', series: 'geo' });
  const title = 'Mateřské školy: počet dětí podle pohlaví a státního občanství';
  const mobile = chartOptions(projection, {
    title,
    subtitle: 'Pohlaví: Celkem · Období: školní rok 2025/2026 · osoba',
    width: 320,
  });
  const desktop = chartOptions(projection, { title, width: 1200 });
  assert(mobile.title.text.includes('\n'));
  assert(mobile.grid.top > desktop.grid.top);
  assert(mobile.title.text.split('\n').every((line) => line.length <= 31));
});

test('chart heading identifies the measure once and keeps the scale clear of the heading', () => {
  const projection = chartProjection(parseJsonStat(sample()), {
    x: 'time',
    series: 'geo',
    transform: 'index',
  });
  const subtitle = chartSubtitle(projection, { transform: 'index' });
  assert.equal(subtitle, `Index · ${projection.base} = 100`);
  assert.equal((subtitle.match(/100/g) || []).length, 1);
  for (const type of ['line', 'bar', 'horizontal', 'heatmap']) {
    const options = chartOptions(projection, { type, title: 'Počet obyvatel', subtitle });
    assert.equal(options.title.subtext, subtitle);
    assert(!options.xAxis.name && !options.yAxis.name);
    assert(
      options.grid.top >=
        options.title.top +
          options.title.textStyle.lineHeight +
          options.title.itemGap +
          options.title.subtextStyle.lineHeight +
          24,
    );
  }
  assert.equal(chartSubtitle({ ...projection, unit: 'osoba' }), 'Jednotka: osoba');
});

test('picture exports show a wrapping legend without interactive pagination', () => {
  const projection = {
    categories: [{ id: '2025', label: '2025' }],
    series: Array.from({ length: 20 }, (_, index) => ({
      name: `Obec s dlouhým názvem ${index}`,
      values: [index],
    })),
    unit: 'osoba',
  };
  const interactive = chartOptions(projection, { width: 1200 });
  const exported = chartOptions(projection, { width: 1200, staticExport: true });
  assert.equal(interactive.legend.type, 'scroll');
  assert.equal(exported.legend.type, 'plain');
  assert(exported.grid.bottom > interactive.grid.bottom);
});

test('150,000-cell cubes are parsed and projected without changing dimensional identity', () => {
  const cube = makeCube({
    dimensions: [
      {
        id: 'category',
        label: 'Kategorie',
        categories: Array.from({ length: 5000 }, (_, index) => ({
          id: String(index),
          label: String(index),
        })),
      },
      {
        id: 'time',
        role: 'time',
        categories: Array.from({ length: 30 }, (_, index) => ({
          id: String(index),
          label: String(index),
        })),
      },
    ],
    values: Array.from({ length: 150000 }, (_, index) => index),
  });
  const projection = chartProjection(cube, { x: 'time', series: 'category', limit: 10 });
  assert.equal(projection.omitted, 4990);
  assert.equal(projection.series[9].values[29], 299);
});
