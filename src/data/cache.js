import { t } from '../i18n/index.js';
export class DataCache {
  constructor({
    indexedDB = globalThis.indexedDB,
    onWarning = () => {},
    maxMemoryBytes = 130 * 1024 * 1024,
  } = {}) {
    Object.assign(this, { indexedDB, onWarning, maxMemoryBytes });
    this.memory = new Map();
    this.db = null;
    this.warned = false;
  }
  async open() {
    this.db = await new Promise((resolve) => {
      let settled = false;
      const finish = (db) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(db);
        } else db?.close();
      };
      const timer = setTimeout(() => finish(null), 4000);
      try {
        // Keep the original MOS store and keys: existing yearly downloads remain usable.
        const request = this.indexedDB.open('csustats-mos-v1', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('files', { keyPath: 'key' });
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          finish(request.result);
        };
        request.onerror = request.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
    if (!this.db) this.warning();
    return this;
  }
  warning() {
    if (!this.warned) {
      this.warned = true;
      this.onWarning(t('Trvalá cache není dostupná. Používám omezenou paměť stránky.'));
    }
  }
  action(mode, fn) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('files', mode);
        const request = fn(tx.objectStore('files'));
        let result;
        request.onsuccess = () => {
          result = request.result;
        };
        tx.oncomplete = () => resolve({ value: result });
        tx.onerror = tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  async get(key) {
    return (
      (await this.action('readonly', (store) => store.get(key)))?.value ??
      this.memory.get(key) ??
      null
    );
  }
  async put(record) {
    const result = await this.action('readwrite', (store) => store.put(record));
    if (result) {
      this.memory.delete(record.key);
      return;
    }
    this.warning();
    this.memory.delete(record.key);
    this.memory.set(record.key, record);
    let size = [...this.memory.values()].reduce((sum, item) => sum + (item.size || 0), 0);
    for (const [key, item] of this.memory) {
      if (size <= this.maxMemoryBytes) break;
      this.memory.delete(key);
      size -= item.size || 0;
    }
  }
  async remove(key) {
    this.memory.delete(key);
    await this.action('readwrite', (store) => store.delete(key));
  }
  async entries() {
    // Cursor over values one at a time: do not clone hundreds of MB of cached CSV.
    const stored = await new Promise((resolve) => {
      if (!this.db) return resolve([]);
      const rows = [];
      try {
        const tx = this.db.transaction('files');
        const request = tx.objectStore('files').openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const { key, year, title, size = 0, savedAt, modified, kind } = cursor.value;
          rows.push({ key, year, title, size, savedAt, modified, kind });
          cursor.continue();
        };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = tx.onabort = () => resolve(rows);
      } catch {
        resolve(rows);
      }
    });
    const entries = new Map(stored.map((record) => [record.key, record]));
    for (const [key, { blob, data, texts, ...record }] of this.memory) entries.set(key, record);
    return [...entries.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
}

export async function cachedResource(
  cache,
  key,
  ttl,
  load,
  { signal, force = false, onCache = () => {}, onStale = () => {} } = {},
) {
  const record = await cache.get(key);
  if (signal?.aborted) throw new DOMException(t('Operace byla zrušena.'), 'AbortError');
  if (!force && record?.data && Date.now() - record.savedAt < ttl) {
    onCache(record);
    return record.data;
  }
  // Expired data are never silently presented as a fresh response.
  let data;
  try {
    data = await load();
  } catch (error) {
    if (!force && record?.data && error.name !== 'AbortError') {
      onStale(record, error);
      return record.data;
    }
    throw error;
  }
  if (signal?.aborted) throw new DOMException(t('Operace byla zrušena.'), 'AbortError');
  await cache.put({
    key,
    data,
    kind: 'metadata',
    title: key,
    savedAt: Date.now(),
    size: JSON.stringify(data).length * 2,
  });
  return data;
}
