/* CSV parsing and indexing stay off the UI thread. One full year is kept in RAM. */
let activeYear = null;
let areaIndex = new Map();
let columns = new Map();
let rowCount = 0;
const CAPACITY = 12000;
function numberValue(raw) {
  const text = String(raw ?? '').trim();
  if (/^i\.?\s*d\.?$/i.test(text)) return -Infinity;
  if (!text || text === '-' || text === '.') return NaN;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : NaN;
}
function snapshot(codes) {
  const values = {};
  for (const [indicator, column] of columns) {
    values[indicator] = codes.map(code => {
      const index = areaIndex.get(code);
      const value = index === undefined ? NaN : column[index];
      return value === -Infinity ? 'i.d.' : Number.isFinite(value) ? value : null;
    });
  }
  return { year: activeYear, codes, values, rowCount };
}
self.onmessage = event => {
  const { id, type, year, blob, codes, knownCodes } = event.data;
  try {
    if (type === 'query' && year === activeYear) {
      self.postMessage({ id, type: 'result', data: snapshot(codes) });
      return;
    }
    if (type !== 'load') throw new Error('Rok není v pracovní paměti.');
    activeYear = null;
    columns = new Map();
    areaIndex = new Map(knownCodes.map((code, index) => [code, index]));
    rowCount = 0;
    let validHeader = false;
    let failures = 0;
    self.Papa.parse(blob, {
      delimiter: ',',
      skipEmptyLines: 'greedy',
      chunkSize: 1024 * 1024,
      chunk(result, parser) {
        try {
          if (result.errors.length) throw new Error('CSV má neplatnou strukturu.');
          for (const row of result.data) {
            if (!validHeader) {
              const header = row.map(value => String(value).replace(/^\uFEFF/, '').trim().toLowerCase());
              if (header.join(',') !== 'rok,kodukaz,koduzemi,hodnota') throw new Error('Neočekávaná hlavička CSV.');
              validHeader = true;
              continue;
            }
            if (row.length !== 4 || Number(row[0]) !== year || !/^\d{6}$/.test(row[1]) || !/^\d{6}$/.test(row[2])) {
              throw new Error('Soubor obsahuje neplatný řádek nebo nesprávný rok.');
            }
            const indicator = row[1];
            const code = row[2];
            if (!areaIndex.has(code)) areaIndex.set(code, areaIndex.size);
            const area = areaIndex.get(code);
            if (area >= CAPACITY) throw new Error('Soubor přesahuje kapacitu číselníku obcí.');
            if (!columns.has(indicator)) columns.set(indicator, new Float64Array(CAPACITY).fill(NaN));
            columns.get(indicator)[area] = numberValue(row[3]);
            rowCount++;
          }
          self.postMessage({ id, type: 'progress', value: Math.min(99, result.meta.cursor / blob.size * 100), rows: rowCount });
        } catch (error) {
          failures++;
          parser.abort();
          self.postMessage({ id, type: 'error', message: error.message });
        }
      },
      complete() {
        if (failures) return;
        if (!validHeader || !rowCount) {
          self.postMessage({ id, type: 'error', message: 'Datový soubor je prázdný.' });
          return;
        }
        activeYear = year;
        self.postMessage({ id, type: 'result', data: snapshot(codes) });
      },
      error(error) { self.postMessage({ id, type: 'error', message: error.message }); },
    });
  } catch (error) { self.postMessage({ id, type: 'error', message: error.message }); }
};
