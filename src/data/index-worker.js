import { t, setLanguage } from '../i18n/index.js';
import Papa from '../../vendor/papaparse/papaparse.min.js';
import { parseJsonStat } from '../core/cube.js';
import { parseCsv, parseRecords, tableToCube, parseDataStatCsv, parseNumber } from './tabular.js';

let activeIndex = null,
  areaIndex = new Map(),
  columns = new Map(),
  flags = new Map(),
  rowCount = 0,
  capacity = 0;
const MAX_ENTITIES = 50000;
const MAX_INDEX_CELLS = 12000000;
function snapshot(codes, requested) {
  const values = Object.create(null);
  for (const indicator of requested || columns.keys()) {
    const column = columns.get(indicator),
      statuses = flags.get(indicator);
    values[indicator] = codes.map((code) => {
      const index = areaIndex.get(code);
      if (index === undefined) return null;
      if (statuses?.has(index)) return statuses.get(index);
      const value = column?.[index];
      return Number.isFinite(value) ? value : null;
    });
  }
  return { indexKey: activeIndex, codes, values, rowCount };
}
function grow(index) {
  if (index >= MAX_ENTITIES) throw new Error(t('Číselník překračuje kapacitu pracovního indexu.'));
  if (index < capacity) return;
  capacity = Math.min(MAX_ENTITIES, Math.max(index + 1, capacity * 2));
  if (columns.size * capacity > MAX_INDEX_CELLS)
    throw new Error(t('Pracovní index překračuje paměťový limit.'));
  for (const [key, old] of columns) {
    const column = new Float64Array(capacity).fill(NaN);
    column.set(old);
    columns.set(key, column);
  }
}
self.onmessage = ({ data: message }) => {
  setLanguage(message.language);
  const { id, type } = message;
  const result = (data) => self.postMessage({ id, type: 'result', data });
  const failure = (error) =>
    self.postMessage({ id, type: 'error', message: error.message, name: error.name });
  try {
    if (type === 'parse-jsonstat') {
      result(parseJsonStat(message.text));
      return;
    }
    if (type === 'parse-table') {
      result(message.format === 'csv' ? parseCsv(message.text) : parseRecords(message.text));
      return;
    }
    if (type === 'cube-table') {
      result(tableToCube(message.table, message.mapping));
      return;
    }
    if (type === 'parse-csu-csv') {
      result(parseDataStatCsv(message.text));
      return;
    }
    if (type === 'query-index' && message.indexKey === activeIndex) {
      result(snapshot(message.codes, message.indicators));
      return;
    }
    if (type !== 'index-csv') throw new Error(t('Požadovaný výřez není v pracovním indexu.'));
    const { schema, period, indexKey, blob, knownCodes = [], codes, indicators } = message;
    if (
      !schema ||
      !['time', 'metric', 'entity', 'value'].every((key) => typeof schema[key] === 'string') ||
      new Set(Object.values(schema)).size !== 4
    )
      throw new Error(t('Neplatný popis sloupců CSV.'));
    if (knownCodes.length > MAX_ENTITIES)
      throw new Error(t('Číselník překračuje kapacitu indexu.'));
    activeIndex = null;
    columns = new Map();
    flags = new Map();
    rowCount = 0;
    areaIndex = new Map(knownCodes.map((code, index) => [code, index]));
    capacity = Math.max(256, areaIndex.size);
    let positions = null,
      headerLength = 0,
      failed = false;
    Papa.parse(blob, {
      delimiter: message.delimiter || ',',
      skipEmptyLines: 'greedy',
      chunkSize: 1024 * 1024,
      chunk(parsed, parser) {
        try {
          if (parsed.errors.length) throw new Error(t('CSV má neplatnou strukturu.'));
          for (const row of parsed.data) {
            if (!positions) {
              const header = row.map((value) =>
                String(value)
                  .replace(/^\uFEFF/, '')
                  .trim()
                  .toLowerCase(),
              );
              if (
                new Set(header).size !== header.length ||
                Object.values(schema).some((field) => !header.includes(field.toLowerCase()))
              )
                throw new Error(t('Neočekávaná hlavička CSV.'));
              positions = Object.fromEntries(
                Object.entries(schema).map(([role, field]) => [
                  role,
                  header.indexOf(field.toLowerCase()),
                ]),
              );
              headerLength = header.length;
              continue;
            }
            if (
              row.length !== headerLength ||
              String(row[positions.time]).trim() !== String(period)
            )
              throw new Error(t('CSV obsahuje neplatný řádek nebo nesprávné období.'));
            const metric = String(row[positions.metric]).trim(),
              code = String(row[positions.entity]).trim();
            if (!metric || !code) throw new Error(t('Prázdný identifikátor položky CSV.'));
            if (!areaIndex.has(code)) areaIndex.set(code, areaIndex.size);
            const index = areaIndex.get(code);
            grow(index);
            if (!columns.has(metric)) {
              if ((columns.size + 1) * capacity > MAX_INDEX_CELLS)
                throw new Error(t('Pracovní index překračuje paměťový limit.'));
              columns.set(metric, new Float64Array(capacity).fill(NaN));
            }
            const raw = String(row[positions.value] ?? '').trim(),
              value = parseNumber(raw);
            const status = value === null && raw && !/^(?:-|\.|null|n\/a)$/i.test(raw) ? raw : '';
            const existing = columns.get(metric)[index],
              existingStatus = flags.get(metric)?.get(index);
            if (
              (Number.isFinite(existing) && existing !== value) ||
              (existingStatus && existingStatus !== status)
            )
              throw new Error(t('CSV obsahuje konfliktní hodnoty pro stejnou kombinaci dimenzí.'));
            if (value !== null) columns.get(metric)[index] = value;
            if (status) {
              if (!flags.has(metric)) flags.set(metric, new Map());
              flags.get(metric).set(index, status);
            }
            rowCount++;
          }
          self.postMessage({
            id,
            type: 'progress',
            value: Math.min(99, (parsed.meta.cursor / blob.size) * 100),
            rows: rowCount,
          });
        } catch (error) {
          failed = true;
          parser.abort();
          failure(error);
        }
      },
      complete() {
        if (failed) return;
        if (!positions || !rowCount) {
          failure(new Error(t('Datový soubor je prázdný.')));
          return;
        }
        activeIndex = indexKey;
        result(snapshot(codes, indicators));
      },
      error: failure,
    });
  } catch (error) {
    failure(error);
  }
};
