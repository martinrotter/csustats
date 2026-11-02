import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { vendorManifest, verifyVendor } from './lib/vendor.mjs';
import { resolveProject } from './lib/project.mjs';

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && redirects < 5) {
        response.resume();
        resolve(download(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Download timed out.')));
  });
}

const restore = process.argv.includes('--restore');
if (process.argv.slice(2).some((argument) => argument !== '--restore'))
  throw new Error('Usage: node scripts/vendor.mjs [--restore]');
if (restore) {
  for (const dependency of (await vendorManifest()).packages) {
    for (const file of dependency.files) {
      const target = resolveProject(file.path);
      try {
        await readFile(target);
        continue;
      } catch {
        /* Restore missing files only. */
      }
      const bytes = await download(file.url);
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
        throw new Error(`Downloaded file did not match the pinned hash: ${file.path}`);
      await mkdir(dirname(fileURLToPath(target)), { recursive: true });
      await writeFile(target, bytes);
      console.log(`Restored ${file.path}`);
    }
  }
}
await verifyVendor();
console.log('OK: all pinned vendor assets and licenses match their SHA-256 hashes.');
