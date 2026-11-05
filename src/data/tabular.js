import { t, getLocale } from '../i18n/index.js';
import Papa from '../../vendor/papaparse/papaparse.min.js';
import { makeCube, MAX_CELLS } from '../core/cube.js';

export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const text = String(input ?? '').trim();
  if (!text || /^(?:-|\.|i\.?\s*d\.?|null|n\/a)$/i.test(text)) return null;
  if (!/^[+-]?(?:\d[\d\s\u00a0\u202f]*)(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const value = Number(text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function parseCsv(text) {
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  if (
    parsed.errors.length ||
    !parsed.data.length ||
    parsed.meta.renamedHeaders ||
    !parsed.meta.fields?.length ||
    parsed.meta.fields.length > 100
  )
    throw new Error(t('CSV má neplatnou strukturu, duplicitní záhlaví nebo je prázdné.'));
  if (parsed.data.length > MAX_CELLS)
    throw new Error(t('Tabulka má příliš mnoho řádků. Připravte menší výřez.'));
  return { fields: parsed.meta.fields, rows: parsed.data, delimiter: parsed.meta.delimiter };
}

export function parseRecords(input) {
  const data = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : input;
  const rows = Array.isArray(data) ? data : data?.data;
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > MAX_CELLS ||
    rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new Error(t('JSON musí obsahovat pole záznamů nebo objekt s polem data.'));
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (
    !fields.length ||
    fields.length > 100 ||
    rows.some((row) =>
      Object.values(row).some((value) => value !== null && typeof value === 'object'),
    )
  )
    throw new Error(t('Podporované jsou ploché JSON záznamy s nejvýše 100 sloupci.'));
  return { fields, rows };
}

export function tableToCube(
  table,
  { value, dimensions, unit = '', status = '', title = t('Vlastní data') },
) {
  if (
    !table.fields.includes(value) ||
    !Array.isArray(dimensions) ||
    !dimensions.length ||
    new Set(dimensions.map((dim) => dim.id)).size !== dimensions.length ||
    dimensions.some((dim) => !table.fields.includes(dim.id) || dim.id === value)
  )
    throw new Error(t('Vyberte hodnotu a alespoň jednu odlišnou dimenzi.'));
  const dims = dimensions.map((definition) => {
    const unique = new Map();
    for (const row of table.rows) {
      const id = String(row[definition.id] ?? '');
      if (!id) throw new Error(t('Identifikátor dimenze nesmí být prázdný.'));
      if (!unique.has(id))
        unique.set(id, {
          id,
          label: definition.labelField ? String(row[definition.labelField] ?? id) : id,
        });
    }
    const categories = [...unique.values()];
    if (definition.role === 'time')
      categories.sort((a, b) => a.id.localeCompare(b.id, getLocale(), { numeric: true }));
    return {
      id: definition.id,
      label: definition.label || definition.id,
      role: definition.role || 'category',
      categories,
    };
  });
  const count = dims.reduce((size, dim) => size * dim.categories.length, 1);
  if (count > MAX_CELLS)
    throw new Error(t('Kombinace dimenzí tvoří příliš velkou tabulku. Vyberte méně dimenzí.'));
  const indexes = dims.map((dim) => new Map(dim.categories.map((item, index) => [item.id, index])));
  const values = {},
    statuses = {},
    seen = new Set();
  for (const row of table.rows) {
    let index = 0;
    dims.forEach((dim, dimIndex) => {
      index = index * dim.categories.length + indexes[dimIndex].get(String(row[dim.id]));
    });
    if (seen.has(index))
      throw new Error(
        t(
          'Více řádků má stejné dimenze. Přidejte rozlišující dimenzi; hodnoty automaticky nesčítáme.',
        ),
      );
    seen.add(index);
    const raw = row[value];
    values[index] = parseNumber(raw);
    if (
      values[index] === null &&
      String(raw ?? '').trim() &&
      !/^(?:-|\.|null|n\/a)$/i.test(String(raw).trim())
    )
      statuses[index] = String(raw);
    if (status && row[status]) statuses[index] = String(row[status]);
  }
  return makeCube({
    dimensions: dims,
    values,
    statuses,
    title,
    source: t('Místní soubor'),
    metadata: { generatedLocalSource: true },
    units: { _value: { label: unit } },
  });
}

export function parseDataStatCsv(text, title = t('ČSÚ DataStat')) {
  const table = parseCsv(text);
  // Flat open-data distributions use value + *_kod/*_txt pairs. Generic files
  // are mapped explicitly in the import dialog instead of guessing semantics.
  const value = table.fields.find((field) => /^(hodnota|value)$/i.test(field));
  const codes = table.fields.filter(
    (field) => /_kod$/i.test(field) && !/^(mj|merjed|jednotka)_/i.test(field),
  );
  if (!value || !codes.length) throw new Error(t('Toto CSV vyžaduje ruční přiřazení sloupců.'));
  const cube = tableToCube(table, {
    value,
    title,
    dimensions: codes.map((id) => ({
      id,
      label: id.replace(/_kod$/i, ''),
      labelField: table.fields.find((field) => field === id.replace(/_kod$/i, '_txt')),
      role: /cas|obdobi|rok/i.test(id)
        ? 'time'
        : /uzemi|vuzemi/i.test(id)
          ? 'geo'
          : /ukaz|stapro/i.test(id)
            ? 'metric'
            : 'category',
    })),
  });
  const metric = cube.dimensions.find((dim) => dim.role === 'metric');
  const unit = table.fields.find((field) => /^(mj|merjed|jednotka)_txt$/i.test(field));
  if (unit)
    for (const row of table.rows)
      cube.units[metric ? String(row[metric.id]) : '_value'] = { label: row[unit] };
  cube.source = t('ČSÚ DataStat');
  return cube;
}
