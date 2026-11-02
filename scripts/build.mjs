import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { outputFile, resolveProject } from './lib/project.mjs';
import { renderSite } from './lib/site.mjs';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check'))
  throw new Error('Usage: node scripts/build.mjs [--check]');
const html = await renderSite();
if (check) {
  let current = '';
  try {
    current = await readFile(outputFile, 'utf8');
  } catch {
    /* Missing artifact is stale. */
  }
  if (current !== html)
    throw new Error('docs/index.html is stale. Run npm run build and commit the output.');
  console.log('OK: docs/index.html matches the sources and verified vendor files.');
} else {
  await mkdir(resolveProject('docs/'), { recursive: true });
  await writeFile(outputFile, html);
  await writeFile(resolveProject('docs/.nojekyll'), '');
  console.log(`Built docs/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB).`);
}
