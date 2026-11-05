import { t } from '../i18n/index.js';
import { ratioTransform, ratioMeasures, formatNumber } from './cube.js';

export const MIN_PEERS = 5;
const quantile = (sorted, p) => {
  const position = (sorted.length - 1) * p,
    lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};
const add = (sum, value) => {
  const adjusted = value - sum.error,
    next = sum.value + adjusted;
  sum.error = next - sum.value - adjusted;
  sum.value = next;
};
const finite = (value) => (Number.isFinite(value) ? value : null);

export function comparisonRows(
  cube,
  originalRows,
  { transform, denominator, scale, aggregate = '' } = {},
) {
  const ratio = transform === 'ratio' ? ratioTransform(cube, { denominator, scale }) : null;
  const indexes = cube.dimensions.flatMap((dim, index) => (dim.role === 'metric' ? [] : [index]));
  const metricIndex = cube.dimensions.findIndex((dim) => dim.role === 'metric');
  let rows = originalRows.map((original) => {
    const metric = metricIndex < 0 ? '_value' : original[`c${metricIndex}`];
    const value = cube.metricTypes[metric] === 'category' ? null : original._value;
    const derived = ratio
      ? ratio.apply(
          value,
          indexes.map((index) => original[`c${index}`]),
        )
      : null;
    return {
      ...original,
      _derived: derived,
      _derivedUnit: ratio ? ratio.unit(metric) : '',
      _derivedStatus:
        ratio && derived == null ? t('Chybějící hodnota nebo chybějící či nulový jmenovatel') : '',
      _items: 1,
      _numeric: value == null ? 0 : 1,
      _derivedCount: derived == null ? 0 : 1,
    };
  });
  const aggregateIndex = cube.dimensions.findIndex(
    (dim) => dim.id === aggregate && dim.role !== 'metric',
  );
  if (aggregateIndex >= 0) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify([
        row._unit,
        ...cube.dimensions.flatMap((_, i) => (i === aggregateIndex ? [] : [row[`c${i}`]])),
      ]);
      if (!groups.has(key))
        groups.set(key, {
          row: { ...row, _items: 0, _numeric: 0, _derivedCount: 0 },
          sum: { value: 0, error: 0 },
          derived: { value: 0, error: 0 },
          labels: new Map(),
          statuses: new Set(),
        });
      const group = groups.get(key);
      group.row._items++;
      if (row._numeric) {
        add(group.sum, row._value);
        group.row._numeric++;
      }
      if (row._derived != null) {
        add(group.derived, row._derived);
        group.row._derivedCount++;
      }
      group.labels.set(row[`c${aggregateIndex}`], row[`d${aggregateIndex}`]);
      if (row._status) group.statuses.add(row._status);
    }
    rows = [...groups.values()].map((group, index) => ({
      ...group.row,
      _index: index,
      [`c${aggregateIndex}`]: [...group.labels.keys()].join(', '),
      [`d${aggregateIndex}`]: [...group.labels.values()].join(', '),
      _value: group.row._numeric ? finite(group.sum.value) : null,
      _derived: group.row._derivedCount ? finite(group.derived.value) : null,
      _status: [
        ...group.statuses,
        ...((group.row._numeric && !Number.isFinite(group.sum.value)) ||
        (group.row._derivedCount && !Number.isFinite(group.derived.value))
          ? [t('Součet nelze vyjádřit konečným číslem.')]
          : []),
      ].join('; '),
    }));
  }
  for (const row of rows) {
    row._coverage = t`${row._numeric} z ${row._items}`;
    row._derivedCoverage = ratio ? t`${row._derivedCount} z ${row._items}` : '';
    row._search = Object.values(row).join(' ');
  }
  return rows;
}

// Tukey fences compare peers only within the same measure, unit, period and remaining coordinates.
export function markOutliers(cube, rows, { compare = '', aggregate = '', transform } = {}) {
  const comparisonIndex = cube.dimensions.findIndex(
    (dim) => dim.id === compare && dim.role !== 'metric' && dim.id !== aggregate,
  );
  const groups = new Map();
  const categories =
    comparisonIndex < 0
      ? new Map()
      : new Map(cube.dimensions[comparisonIndex].categories.map((item) => [item.id, item]));
  for (const row of rows) {
    row._outlier = '';
    row._distance = 0;
    row._peerCount = 0;
    row._median = null;
    row._analysisValue =
      !row._numeric ||
      (aggregate &&
        (row._numeric < row._items || (transform === 'ratio' && row._derivedCount < row._items)))
        ? null
        : transform === 'ratio'
          ? row._derived
          : row._value;
    if (comparisonIndex < 0 || row._analysisValue == null || !row._numeric) continue;
    const key = JSON.stringify([
      transform === 'ratio' ? row._derivedUnit : row._unit,
      categories.get(row[`c${comparisonIndex}`])?.level || '',
      ...cube.dimensions.flatMap((dim, index) =>
        index === comparisonIndex || dim.id === aggregate ? [] : [row[`c${index}`]],
      ),
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const values = group.map((row) => row._analysisValue).sort((a, b) => a - b);
    const median = quantile(values, 0.5),
      q1 = quantile(values, 0.25),
      q3 = quantile(values, 0.75),
      iqr = q3 - q1;
    for (const row of group) {
      row._peerCount = values.length;
      row._median = median;
      if (values.length < MIN_PEERS) continue;
      row._outlier =
        row._analysisValue < q1 - 1.5 * iqr
          ? 'low'
          : row._analysisValue > q3 + 1.5 * iqr
            ? 'high'
            : '';
      // A constant peer population still has an explicit, finite ordering.
      row._distance =
        Math.abs(row._analysisValue - median) / (iqr || Math.max(Math.abs(median), 1));
    }
  }
  return rows;
}

export function outlierLabel(row) {
  return row._items > 1 &&
    (row._numeric < row._items || (row._derivedUnit && row._derivedCount < row._items))
    ? t('Neúplný součet')
    : row._outlier === 'high'
      ? t('Vysoká odlehlá hodnota')
      : row._outlier === 'low'
        ? t('Nízká odlehlá hodnota')
        : row._analysisValue == null
          ? t('Bez číselného údaje')
          : row._peerCount < MIN_PEERS
            ? t('Málo údajů pro srovnání')
            : t('Běžné rozmezí');
}

export function comparisonCsv(
  cube,
  rows,
  { transform, denominator = '', scale = 1000, aggregate = '' } = {},
) {
  const ratio = transform === 'ratio';
  const reference = ratio ? ratioMeasures(cube).find((item) => item.id === denominator) : null;
  return {
    fields: [
      ...cube.dimensions.flatMap((dim) => [dim.label, t`${dim.label} – kód`]),
      aggregate ? t('Součet původních hodnot') : t('Hodnota'),
      ...(ratio
        ? [
            aggregate ? t('Součet přepočtených hodnot') : t('Přepočtená hodnota'),
            t('Jednotka přepočtu'),
            t('Jmenovatel'),
            t('Jmenovatel – kód'),
            t('Měřítko poměru'),
          ]
        : []),
      t('Jednotka'),
      ...(aggregate
        ? [t('Pokrytí součtu'), ...(ratio ? [t('Pokrytí přepočteného součtu')] : [])]
        : []),
      t('Srovnání'),
      t('Počet srovnatelných údajů'),
      t('Medián skupiny'),
      t('Stav / poznámka'),
      t('Zdroj'),
    ],
    data: rows.map((row) => [
      ...cube.dimensions.flatMap((_, index) => [row[`d${index}`], row[`c${index}`]]),
      row._value,
      ...(ratio
        ? [row._derived, row._derivedUnit, reference?.label || '', denominator, Number(scale)]
        : []),
      row._unit,
      ...(aggregate ? [row._coverage, ...(ratio ? [row._derivedCoverage] : [])] : []),
      outlierLabel(row),
      row._peerCount,
      row._median,
      [row._status, row._derivedStatus].filter(Boolean).join('; '),
      cube.source,
    ]),
  };
}

export function peerDescription(row) {
  return t`Srovnatelných údajů: ${row._peerCount}. Medián: ${formatNumber(row._median)}.`;
}
