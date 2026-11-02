import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { renderSite, replaceToken } from '../scripts/lib/site.mjs';

test('build emits a standalone HTML file with syntax-valid embedded scripts and licenses', async () => {
  const html = await renderSite();
  assert(!/<script[^>]+src\s*=/i.test(html));
  assert(!/<link[^>]+rel=["']stylesheet/i.test(html));
  assert(!/<!--\s*[A-Z_]+\s*-->/.test(html));
  assert(html.includes('Copyright (c) 2026 Martin Rotter'));
  assert(html.includes('Apache License'));
  assert(html.includes('The Apache Software Foundation'));
  assert(html.includes('BSD 3-Clause'));
  for (const [, attributes, script] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/type="(?:text\/plain|application\/json)"/.test(attributes)) new vm.Script(script);
  }
});

test('template insertion validates tokens and escapes closing script tags', () => {
  assert.equal(replaceToken('<!-- APP -->', 'APP', '</script>'), '<\\/script>');
  assert.throws(() => replaceToken('missing', 'APP', ''), /Expected one/);
  assert.throws(() => replaceToken('<!-- APP --><!-- APP -->', 'APP', ''), /Expected one/);
});

test('all static DOM references used by features exist in the template', async () => {
  const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  const ids = [...template.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate DOM IDs');
  for (const file of await readdir(new URL('../src/features/', import.meta.url))) {
    const source = await readFile(new URL('../src/features/' + file, import.meta.url), 'utf8');
    for (const [, id] of source.matchAll(/app\.\$\(['"]([a-z][\w-]*)['"]\)/g))
      assert(ids.includes(id), `${file} references absent #${id}`);
  }
});
