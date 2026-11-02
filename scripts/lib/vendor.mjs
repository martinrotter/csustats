import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveProject } from './project.mjs';

export async function vendorManifest() {
  return JSON.parse(await readFile(resolveProject('vendor/manifest.json'), 'utf8'));
}

export async function verifyVendor() {
  const manifest = await vendorManifest();
  for (const dependency of manifest.packages) {
    for (const file of dependency.files) {
      let bytes;
      try {
        bytes = await readFile(resolveProject(file.path));
      } catch {
        throw new Error(`Missing ${file.path}. Run npm run vendor:restore.`);
      }
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== file.sha256) throw new Error(`Integrity check failed: ${file.path}`);
    }
  }
  return manifest;
}
