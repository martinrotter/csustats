import { mkdir, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(root, 'vendor');
await mkdir(vendor, { recursive: true });
const dependencies = [
  ['papa.min.js', 'https://cdn.jsdelivr.net/npm/papaparse@5.5.3/papaparse.min.js'],
  ['echarts.min.js', 'https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js'],
  ['tabulator.min.js', 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/js/tabulator.min.js'],
  ['tabulator.min.css', 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/css/tabulator.min.css'],
  ['papaparse.LICENSE', 'https://cdn.jsdelivr.net/npm/papaparse@5.5.3/LICENSE'],
  ['echarts.LICENSE', 'https://cdn.jsdelivr.net/npm/echarts@6.0.0/LICENSE'],
  ['tabulator.LICENSE', 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/LICENSE'],
];
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 30000 }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && redirects < 5) {
        response.resume();
        resolve(download(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${response.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error(`Timeout: ${url}`)));
  });
}
for (const [name, url] of dependencies) {
  try { await readFile(path.join(vendor, name)); }
  catch {
    console.log(`Stahuji ${name}`);
    let content;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { content = await download(url); break; }
      catch (error) { if (attempt === 2) throw error; }
    }
    await writeFile(path.join(vendor, name), content);
  }
}
let html = await readFile(path.join(root, 'src', 'template.html'), 'utf8');
for (const [token, location] of Object.entries({
  VENDOR_CSS: 'vendor/tabulator.min.css',
  APP_CSS: 'src/styles.css',
  DATA_UI_CSS: 'src/data-ui.css',
  PAPA: 'vendor/papa.min.js',
  ECHARTS: 'vendor/echarts.min.js',
  TABULATOR: 'vendor/tabulator.min.js',
  WORKER: 'src/worker.js',
  TRANSFER: 'src/transfer.js',
  REGIONS: 'src/regions.json',
  APP: 'src/app.js',
})) {
  const source = await readFile(path.join(root, location), 'utf8');
  const safe = token.endsWith('CSS') ? source.replace(/<\/style/gi, '<\\/style') : source.replace(/<\/script/gi, '<\\/script');
  html = html.replace(`<!-- ${token} -->`, () => safe);
}
const licenses = await Promise.all(['papaparse.LICENSE', 'echarts.LICENSE', 'tabulator.LICENSE'].map(async name => `${name}\n${await readFile(path.join(vendor, name), 'utf8')}`));
html = html.replace('<!-- LICENSES -->', () => licenses.join('\n\n').replace(/<\/script/gi, '<\\/script'));
await writeFile(path.join(root, 'index.html'), html);
console.log(`Hotovo: index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB). Žádné runtime závislosti na CDN.`);
