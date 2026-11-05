import { getLocale, t } from '../i18n/index.js';
export const MAX_CELLS = 150000;
const numberFormats = new Map();
export const numberFormat = {
  format(value) {
    const locale = getLocale();
    if (!numberFormats.has(locale))
      numberFormats.set(locale, new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }));
    return numberFormats.get(locale).format(value);
  },
};
export const formatNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '—';
export const textKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(t`${label}: očekáván objekt.`);
  return value;
}

export function makeCube(
  {
    dimensions,
    values,
    statuses = {},
    title = '',
    source = '',
    updated = '',
    notes = [],
    units = {},
    metricTypes = {},
    metadata = {},
  },
  maxCells = MAX_CELLS,
) {
  if (!Array.isArray(dimensions) || !dimensions.length || dimensions.length > 20)
    throw new Error(t('Neplatný počet dimenzí.'));
  const ids = new Set();
  let count = 1;
  for (const dimension of dimensions) {
    if (
      !dimension.id ||
      ids.has(dimension.id) ||
      !Array.isArray(dimension.categories) ||
      !dimension.categories.length
    )
      throw new Error(t('Neplatná nebo duplicitní dimenze.'));
    ids.add(dimension.id);
    const categories = dimension.categories.map((item) => String(item.id));
    if (new Set(categories).size !== categories.length)
      throw new Error(t('Duplicitní položka dimenze.'));
    count *= categories.length;
    if (!Number.isSafeInteger(count) || count > maxCells)
      throw new Error(
        t`Výběr překračuje limit ${numberFormat.format(maxCells)} buněk. Omezte filtry.`,
      );
  }
  const numeric = new Float64Array(count).fill(NaN);
  const setValue = (index, value) => {
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error(t('Hodnota má neplatnou pozici v datové kostce.'));
    if (value === null || value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(t('Datová hodnota není konečné číslo.'));
    numeric[index] = value;
  };
  if (Array.isArray(values) || ArrayBuffer.isView(values)) {
    if (values.length !== count) throw new Error(t('Počet hodnot neodpovídá dimenzím.'));
    values.forEach((value, index) => setValue(index, value));
  } else {
    requireObject(values, t('Hodnoty'));
    for (const [key, value] of Object.entries(values)) {
      if (!/^\d+$/.test(key)) throw new Error(t('Neplatná pozice řídké hodnoty.'));
      setValue(Number(key), value);
    }
  }
  const flags = new Map();
  const flag = (key, value) => {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error(t('Neplatná pozice stavu údaje.'));
    if (value != null && value !== '') flags.set(index, String(value));
  };
  if (typeof statuses === 'string') {
    for (let index = 0; index < count; index++) flag(index, statuses);
  } else if (Array.isArray(statuses)) {
    if (statuses.length !== count) throw new Error(t('Počet stavů neodpovídá dimenzím.'));
    statuses.forEach((value, index) => flag(index, value));
  } else {
    for (const [key, value] of Object.entries(requireObject(statuses, t('Stavy'))))
      flag(key, value);
  }
  dimensions = dimensions.map((dim) => {
    const counts = new Map();
    for (const item of dim.categories) {
      const label = String(item.label ?? item.id);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return {
      ...dim,
      categories: dim.categories.map((item) => {
        const label = String(item.label ?? item.id);
        return {
          ...item,
          id: String(item.id),
          label:
            counts.get(label) > 1
              ? `${label} (${item.district ? item.district + ', ' : ''}${item.id})`
              : label,
        };
      }),
    };
  });
  const strides = dimensions.map((_, index) =>
    dimensions.slice(index + 1).reduce((product, dim) => product * dim.categories.length, 1),
  );
  return {
    dimensions,
    values: numeric,
    statuses: flags,
    count,
    strides,
    title,
    source,
    updated,
    notes: notes.filter(Boolean),
    units,
    metricTypes,
    metadata,
  };
}

export function parseJsonStat(input, maxCells = MAX_CELLS) {
  let data = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : input;
  requireObject(data, 'JSON-stat');
  if (data.class === 'collection') {
    const items = data.link?.item?.filter((item) => item.class === 'dataset');
    if (items?.length !== 1)
      throw new Error(t('Kolekce musí obsahovat právě jednu vloženou datovou sadu.'));
    data = items[0];
  } else if (!data.dimension) {
    const items = Object.values(data).filter(
      (item) => item && typeof item === 'object' && item.dimension,
    );
    if (items.length !== 1)
      throw new Error(t('Soubor neobsahuje jednu jednoznačnou datovou sadu JSON-stat.'));
    data = items[0];
  }
  const ids = data.id || data.dimension?.id;
  const sizes = data.size || data.dimension?.size;
  if (!Array.isArray(ids) || !Array.isArray(sizes) || ids.length !== sizes.length)
    throw new Error(t('JSON-stat nemá platný seznam dimenzí a velikostí.'));
  let cells = 1;
  for (const size of sizes) {
    if (!Number.isSafeInteger(size) || size < 1)
      throw new Error(t('JSON-stat má neplatnou velikost dimenze.'));
    cells *= size;
    if (!Number.isSafeInteger(cells) || cells > maxCells)
      throw new Error(t`Výběr překračuje limit ${numberFormat.format(maxCells)} buněk.`);
  }
  const units = {};
  const dimensions = ids.map((id, dimensionIndex) => {
    const definition = requireObject(data.dimension[id], t`Dimenze ${id}`);
    const category = requireObject(definition.category, t`Položky ${id}`);
    let index = category.index;
    if (!index && sizes[dimensionIndex] === 1) index = Object.keys(category.label || {});
    let ordered;
    if (Array.isArray(index)) ordered = index.map((key) => String(key));
    else {
      requireObject(index, t`Pořadí ${id}`);
      ordered = new Array(sizes[dimensionIndex]);
      for (const [key, position] of Object.entries(index)) {
        if (
          !Number.isInteger(position) ||
          position < 0 ||
          position >= ordered.length ||
          ordered[position] !== undefined
        )
          throw new Error(t('JSON-stat obsahuje neplatné pořadí kategorií.'));
        ordered[position] = key;
      }
    }
    if (
      !Number.isInteger(sizes[dimensionIndex]) ||
      sizes[dimensionIndex] < 1 ||
      ordered.length !== sizes[dimensionIndex] ||
      ordered.includes(undefined)
    )
      throw new Error(t('Velikost dimenze neodpovídá kategoriím.'));
    const role =
      data.role?.metric?.includes(id) || id === 'IndicatorType'
        ? 'metric'
        : data.role?.time?.includes(id)
          ? 'time'
          : data.role?.geo?.includes(id)
            ? 'geo'
            : 'category';
    if (role === 'metric') Object.assign(units, category.unit || {});
    return {
      id,
      label: definition.label || id,
      role,
      categories: ordered.map((key) => ({
        id: key,
        label: category.label?.[key] ?? key,
        note: category.note?.[key],
      })),
    };
  });
  if (dimensions.every((dim) => dim.role === 'metric')) {
    let id = '_record';
    while (ids.includes(id)) id += '_';
    dimensions.push({
      id,
      label: t('Záznam'),
      uiLabel: 'Záznam',
      role: 'category',
      categories: [{ id: 'value', label: t('Hodnota'), uiLabel: 'Hodnota' }],
    });
  }
  return makeCube(
    {
      dimensions,
      values: data.value,
      statuses: data.status || {},
      title: data.label,
      source: data.source,
      updated: data.updated,
      notes: Array.isArray(data.note) ? data.note : [data.note],
      units,
      metadata: {
        statusLabels: data.extension?.status?.label || {},
        extension: data.extension || {},
      },
    },
    maxCells,
  );
}

export function* observations(cube) {
  const metric = cube.dimensions.find((dimension) => dimension.role === 'metric');
  for (let index = 0; index < cube.count; index++) {
    const coordinates = Object.fromEntries(
      cube.dimensions.map((dimension, dimIndex) => [
        dimension.id,
        dimension.categories[
          Math.floor(index / cube.strides[dimIndex]) % dimension.categories.length
        ],
      ]),
    );
    const value = cube.values[index];
    const metricId = metric ? coordinates[metric.id].id : '_value';
    yield {
      index,
      coordinates,
      value: Number.isFinite(value) ? value : null,
      status: cube.statuses.get(index) || '',
      metricId,
      unit: cube.units[metricId]?.label || '',
    };
  }
}

export function coverage(cube) {
  let numeric = 0;
  for (const value of cube.values) if (Number.isFinite(value)) numeric++;
  return { numeric, missing: cube.count - numeric, total: cube.count, ratio: numeric / cube.count };
}

export function subsetCube(cube, selections) {
  const dimensions = cube.dimensions.map((dim) => {
    const selected = new Set(selections[dim.id] || []);
    const categories = dim.categories.filter((item) => selected.has(item.id));
    if (!categories.length) throw new Error(t`Vyberte alespoň jednu položku: ${dim.label}.`);
    return { ...dim, categories };
  });
  const indexes = dimensions.map(
    (dim) => new Map(dim.categories.map((item, index) => [item.id, index])),
  );
  const values = {},
    statuses = {};
  for (const row of observations(cube)) {
    let index = 0,
      included = true;
    dimensions.forEach((dim, i) => {
      const position = indexes[i].get(row.coordinates[dim.id].id);
      if (position === undefined) included = false;
      else index = index * dim.categories.length + position;
    });
    if (included) {
      values[index] = row.value;
      if (row.status) statuses[index] = row.status;
    }
  }
  return makeCube({ ...cube, dimensions, values, statuses });
}

export function ratioMeasures(cube) {
  const metrics = cube.dimensions.find((dim) => dim.role === 'metric');
  const measures = new Map(
    (metrics?.categories || [])
      .filter((item) => cube.metricTypes[item.id] !== 'category')
      .map((item) => [
        item.id,
        { id: item.id, label: item.label, unit: cube.units[item.id]?.label || '' },
      ]),
  );
  for (const [id, reference] of Object.entries(cube.metadata.references || {}))
    if (!measures.has(id)) measures.set(id, { id, label: reference.label, unit: reference.unit });
  return [...measures.values()];
}

// Both tables and charts use the same denominator at the complete dimensional coordinate.
export function ratioTransform(cube, { denominator = '', scale = 1000 } = {}) {
  const factor = Number(scale);
  const reference = ratioMeasures(cube).find((item) => item.id === denominator);
  if (!reference || !Number.isFinite(factor) || factor <= 0 || factor > 1e6)
    throw new Error(t('Vyberte jmenovatel a platné měřítko poměru.'));
  const coordinates = cube.dimensions.filter((dim) => dim.role !== 'metric');
  const values = new Map(Object.entries(cube.metadata.references?.[denominator]?.values || {}));
  for (const row of observations(cube))
    if (row.metricId === denominator)
      values.set(JSON.stringify(coordinates.map((dim) => row.coordinates[dim.id].id)), row.value);
  return {
    label: reference.label,
    unit: (metric) =>
      `${cube.units[metric]?.label || ''} / ${reference.unit || t('jednotka')} × ${formatNumber(factor)}`,
    apply(value, codes) {
      const divisor = values.get(JSON.stringify(codes));
      if (value == null || !Number.isFinite(divisor) || divisor === 0) return null;
      const result = (value / divisor) * factor;
      return Number.isFinite(result) ? result : null;
    },
  };
}

export function chartProjection(
  cube,
  {
    x,
    series = '',
    metric = '',
    fixed = {},
    limit = 20,
    sort = 'source',
    transform = 'absolute',
    denominator = '',
    scale = 1000,
    seriesIds = null,
    categoryIds = null,
    seriesOrder = 'source',
    seriesScores = {},
  },
) {
  const xDim = cube.dimensions.find((dim) => dim.id === x);
  if (!xDim) throw new Error(t('Vyberte dimenzi vodorovné osy.'));
  const metricDim = cube.dimensions.find((dim) => dim.role === 'metric');
  const metricId = metric || metricDim?.categories[0]?.id || '_value';
  const ratio = transform === 'ratio' ? ratioTransform(cube, { denominator, scale }) : null;
  const coordinateDims = cube.dimensions.filter((dim) => dim.id !== metricDim?.id);
  const seriesDim =
    series && series !== x && series !== metricDim?.id
      ? cube.dimensions.find((dim) => dim.id === series)
      : null;
  const rest = cube.dimensions.filter(
    (dim) => dim.id !== x && dim.id !== seriesDim?.id && dim.id !== metricDim?.id,
  );
  const locked = Object.fromEntries(
    rest.map((dim) => [dim.id, fixed[dim.id] || dim.categories[0].id]),
  );
  const matrix = new Map();
  const selectedSeries = seriesDim?.categories || [
    {
      id: metricId,
      label: metricDim?.categories.find((item) => item.id === metricId)?.label || t('Hodnota'),
    },
  ];
  for (const item of selectedSeries) matrix.set(item.id, new Map());
  for (const row of observations(cube)) {
    if (
      row.metricId !== metricId ||
      rest.some((dim) => row.coordinates[dim.id].id !== locked[dim.id])
    )
      continue;
    matrix.get(seriesDim ? row.coordinates[seriesDim.id].id : metricId)?.set(
      row.coordinates[x].id,
      ratio
        ? ratio.apply(
            row.value,
            coordinateDims.map((dim) => row.coordinates[dim.id].id),
          )
        : row.value,
    );
  }
  let categories = xDim.categories.filter(
    (item) => !Array.isArray(categoryIds) || categoryIds.includes(item.id),
  );
  if (sort !== 'source' && xDim.role !== 'time') {
    const key = matrix.get(selectedSeries[0].id);
    categories.sort((a, b) => {
      const av = key.get(a.id),
        bv = key.get(b.id);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return sort === 'asc' ? av - bv : bv - av;
    });
  }
  const allSeries = selectedSeries.filter((item) =>
    [...matrix.get(item.id).values()].some((value) => value != null),
  );
  let candidates = [...allSeries];
  if (Array.isArray(seriesIds)) {
    const positions = new Map(seriesIds.map((id, index) => [id, index]));
    candidates = candidates
      .filter((item) => positions.has(item.id))
      .sort((a, b) => positions.get(a.id) - positions.get(b.id));
  } else if (seriesOrder !== 'source') {
    const last = (item) =>
      [...categories]
        .reverse()
        .map((category) => matrix.get(item.id).get(category.id))
        .find((value) => value != null) ?? null;
    candidates.sort((a, b) => {
      const av = seriesOrder === 'outlier' ? seriesScores[a.id] || 0 : last(a);
      const bv = seriesOrder === 'outlier' ? seriesScores[b.id] || 0 : last(b);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return seriesOrder === 'asc' ? av - bv : bv - av;
    });
  }
  const shownSeries = Array.isArray(seriesIds)
    ? candidates
    : candidates.slice(0, limit === 0 ? candidates.length : limit);
  let base = null;
  if (transform === 'index')
    base = categories.find((category) =>
      shownSeries.every((item) => {
        const value = matrix.get(item.id).get(category.id);
        return value != null && value !== 0;
      }),
    );
  const plotted = shownSeries.map((item) => ({
    id: item.id,
    name: item.label,
    values: categories.map((category) => {
      const value = matrix.get(item.id).get(category.id) ?? null;
      if (value == null || transform === 'absolute') return value;
      if (transform === 'index')
        return base ? (value / matrix.get(item.id).get(base.id)) * 100 : null;
      return value;
    }),
  }));
  return {
    categories,
    series: plotted,
    omitted: allSeries.length - shownSeries.length,
    fixed: locked,
    base: base?.label,
    categorical: cube.metricTypes[metricId] === 'category',
    unit:
      transform === 'index'
        ? t('index (základ = 100)')
        : ratio
          ? ratio.unit(metricId)
          : cube.units[metricId]?.label || '',
    denominator: ratio?.label,
  };
}

export function localizeGeneratedLabels(cube) {
  if (!cube) return;
  if (cube.metadata.generatedLocalSource)
    cube.source = cube.metadata.localFileName
      ? t`Místní soubor · ${cube.metadata.localFileName}`
      : t('Místní soubor');
  for (const dimension of cube.dimensions) {
    if (dimension.uiLabel) dimension.label = t(dimension.uiLabel);
    for (const item of dimension.categories) if (item.uiLabel) item.label = t(item.uiLabel);
  }
}
