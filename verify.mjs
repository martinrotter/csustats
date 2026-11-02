// Meaningful data checks for the CSV worker; no browser or dependencies needed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('./', import.meta.url);
const parser = await readFile(new URL('vendor/papa.min.js', root), 'utf8');
const source = await readFile(new URL('src/worker.js', root), 'utf8');
const transferSource = await readFile(new URL('src/transfer.js', root), 'utf8');
const transferContext = vm.createContext({});
vm.runInContext(transferSource + '\nthis.transfers = CsuTransfers; this.coverage = CsuCoverage; this.places = CsuPlaces;', transferContext);
const incoming = Array.from({ length: 500 }, (_, index) => String(500000 + index));
assert.equal(transferContext.places.merge(['500000', '599999'], incoming).length, 501, 'Bulk addition must include the entire group without duplicates or a 20-place cap');
assert.equal(transferContext.places.merge(['599999'], incoming, true).length, 500, 'Replace mode must discard the previous selection');
const regionData = JSON.parse(await readFile(new URL('src/regions.json', root), 'utf8'));
assert.equal(new Set(Object.values(regionData.districts)).size, 14);
assert.equal(regionData.districts['Olomouc'], 'Olomoucký kraj');
assert.equal(regionData.districts['Jablonec n.Nisou'], 'Liberecký kraj', 'MOS district name aliases must match the official region catalog');
const transfers = transferContext.transfers;
const plan = transfers.plan([2025, 2024, 2025, 2023], [{ year: 2024, size: 43861928 }]);
assert.equal(plan.length, 3, 'A year is planned only once');
assert.equal(plan[1].status, 'cached', 'Previously downloaded files must be distinct from queued downloads');
assert.equal(plan.filter(task => !task.cached).length, 2, 'Only missing files belong to the download queue');
assert.equal(transfers.fraction(5, 20), 18.75, 'Byte progress uses the size obtained before downloading');
assert.equal(transfers.fraction(25, 20), null, 'Compressed or stale sizes must not claim false percentages');
assert.equal(transfers.fraction(5, 0), null, 'Unknown size uses the moving indeterminate state');
assert.equal(transfers.overall([{ fraction: .5 }, { cached: true, fraction: 0 }]), 75, 'Overall progress includes previously saved files');
const coverage = transferContext.coverage.summarize([0, null, 'i.d.', undefined, 12]);
assert.equal(coverage.count, 2, 'Zero is a numeric value; protected and missing entries are not');
assert.equal(coverage.sparse, true, 'Less than half the selected entries should be marked as sparse');
assert.equal(transferContext.coverage.summarize([0]).sparse, false, 'One complete municipality is not sparse');
assert.equal(transferContext.coverage.summarize([1, null]).sparse, true, 'A single available value in a comparison is sparse');
assert.equal(transferContext.coverage.summarize([null, 'i.d.']).count, 0, 'Protected-only indicators must not pass the numeric filter');
class FileReader {
  readAsText(blob) {
    blob.text().then(result => this.onload?.({ target: { result } })).catch(error => this.onerror?.({ target: { error } }));
  }
}
let pending;
const context = { Blob, Object, FileReader, console, setTimeout, clearTimeout, postMessage(message) {
  if (message.type === 'result') pending.resolve(message.data);
  if (message.type === 'error') pending.reject(new Error(message.message));
} };
context.self = context;
vm.createContext(context);
vm.runInContext(parser, context);
vm.runInContext(source, context);
function request(data) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker did not finish')), 10000);
    pending = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    context.self.onmessage({ data: { id: 1, ...data } });
  });
}
const fixture = 'rok,"kodukaz","koduzemi",hodnota \r\n2025,"110900","552429",0\r\n2025,"110900","568392",1307\r\n2025,"010300","552429",302.78\r\n2025,"121800","552429","i.d."\r\n2025,"113000","552429",\r\n2025,"999999","599999",-12.5\r\n';
const result = await request({ type: 'load', year: 2025, blob: new Blob([fixture]), knownCodes: ['552429', '568392'], codes: ['552429', '568392'] });
assert.equal(result.rowCount, 6);
assert.equal(result.values['110900'][0], 0, 'A real zero must remain zero');
assert.equal(result.values['110900'][1], 1307);
assert.equal(result.values['010300'][0], 302.78);
assert.equal(result.values['121800'][0], 'i.d.', 'Confidential values must remain distinct');
assert.equal(result.values['113000'][0], null, 'Empty values must never become zero');
assert.equal(result.values['010300'][1], null, 'Missing municipality/indicator combinations remain missing');
const queried = await request({ type: 'query', year: 2025, codes: ['599999', '552429'] });
assert.equal(queried.values['999999'][0], -12.5, 'Codes absent from the catalog are still indexed');
assert.equal(queried.values['110900'][1], 0, 'Query follows selection order');
await assert.rejects(request({ type: 'load', year: 2024, blob: new Blob([fixture]), knownCodes: [], codes: [] }), /nesprávný rok/);
await assert.rejects(request({ type: 'load', year: 2025, blob: new Blob(['<html>Server error</html>']), knownCodes: [], codes: [] }), /hlavička/);
// Multiple chunks must not discard a line split across the chunk boundary.
const longFixture = 'rok,"kodukaz","koduzemi",hodnota\r\n' + '2025,"110900","552429",306\r\n'.repeat(50000);
const chunked = await request({ type: 'load', year: 2025, blob: new Blob([longFixture]), knownCodes: ['552429'], codes: ['552429'] });
assert.equal(chunked.rowCount, 50000);
assert.equal(chunked.values['110900'][0], 306);
const html = await readFile(new URL('index.html', root), 'utf8');
assert(!/<script[^>]+src\s*=/i.test(html), 'Deliverable must not depend on remote scripts');
assert(!/<link[^>]+rel=["']stylesheet/i.test(html), 'Deliverable must not depend on external CSS');
assert(!/<!-- (?:APP|WORKER|PAPA|ECHARTS|TABULATOR|LICENSES|APP_CSS|VENDOR_CSS|DATA_UI_CSS|TRANSFER|REGIONS) -->/.test(html), 'All build placeholders must be replaced');
assert(html.includes('Apache License') && html.includes('The MIT License'), 'Standalone file must include third-party licenses');
console.log('OK: bulk selection and regions, download planning, byte/overall progress, numeric/sparse coverage, CSV validation, protected/missing/zero distinction, chunk boundaries, standalone HTML and licenses.');
