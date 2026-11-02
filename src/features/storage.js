export function createStorage(app) {
  function openDatabase() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('csustats-mos-v1', 1);
        let done = false;
        const timer = setTimeout(() => {
          done = true;
          resolve(null);
        }, 4000);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('files', {
            keyPath: 'key',
          });
        request.onsuccess = () => {
          clearTimeout(timer);
          if (done) {
            request.result.close();
            return;
          }
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        request.onblocked = () => {
          clearTimeout(timer);
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }
  function storeAction(mode, action) {
    if (!app.db) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const transaction = app.db.transaction('files', mode);
        const request = action(transaction.objectStore('files'));
        let result = null;
        request.onsuccess = () => {
          result = request.result;
        };
        transaction.oncomplete = () =>
          resolve({
            ok: true,
            value: result,
          });
        transaction.onerror = transaction.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  async function cacheGet(key) {
    const result = await app.storeAction('readonly', (store) => store.get(key));
    return result?.value ?? app.memoryCache.get(key) ?? null;
  }
  async function cachePut(record) {
    const result = await app.storeAction('readwrite', (store) => store.put(record));
    if (!result) {
      app.memoryCache.set(record.key, record);
      const years = [...app.memoryCache.keys()].filter((key) => key.startsWith('year-'));
      while (years.length > 2) app.memoryCache.delete(years.shift());
      if (!app.storageWarningShown) {
        app.storageWarningShown = true;
        app.toast('Trvalé uložení není dostupné. Data jsou dočasně v paměti této stránky.');
      }
    }
    await app.updateCacheSummary();
  }
  async function cacheRemove(key) {
    await app.storeAction('readwrite', (store) => store.delete(key));
    app.memoryCache.delete(key);
  }
  async function getCacheEntries() {
    const result = await app.storeAction('readonly', (store) => store.getAll());
    const merged = new Map((result?.value ?? []).map((record) => [record.key, record]));
    for (const [key, record] of app.memoryCache) merged.set(key, record);
    return [...merged.values()]
      .filter((record) => record.key.startsWith('year-'))
      .map(({ key, year, size, savedAt, modified }) => ({
        key,
        year,
        size,
        savedAt,
        modified,
      }))
      .sort((a, b) => b.year - a.year);
  }
  async function updateCacheSummary() {
    app.cacheEntries = await app.getCacheEntries();
    const bytes = app.cacheEntries.reduce((sum, entry) => sum + entry.size, 0);
    app.$('cache-summary').textContent = app.cacheEntries.length
      ? `${app.cacheEntries.length} ${app.cacheEntries.length === 1 ? 'rok' : app.cacheEntries.length < 5 ? 'roky' : 'roků'} · ${app.mb(bytes)}`
      : app.db
        ? 'Zatím žádné stažené roky'
        : 'Dočasná paměť stránky';
    app.updateYearHint();
  }
  return {
    openDatabase,
    storeAction,
    cacheGet,
    cachePut,
    cacheRemove,
    getCacheEntries,
    updateCacheSummary,
  };
}
