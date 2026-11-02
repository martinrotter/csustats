import { CsuTransfers } from '../core/transfers.js';
import { Papa } from '../lib/browser-libraries.js';

export function createDownloads(app) {
  async function discoverFileSize(url, signal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, {
      once: true,
    });
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
      // HEAD reports the uncompressed CSV size on the ČSÚ server.
      return response.ok ? Number(response.headers.get('content-length')) || 0 : 0;
    } catch {
      return 0;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
  async function downloadBlob(url, rangeStart = 0, rangeEnd = 75) {
    app.checkAbort();
    let response;
    let timedOut = false;
    const requestController = new AbortController();
    const operationSignal = app.operationController?.signal;
    const onCancel = () => requestController.abort();
    operationSignal?.addEventListener('abort', onCancel, {
      once: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, 90000);
    try {
      let expectedSize = 0;
      if (/mos_data_\d{4}\.csv$/.test(url)) {
        app.transferStatus('checking');
        app.progress('Zjišťuji velikost souboru', null);
        expectedSize = await app.discoverFileSize(url, requestController.signal);
        app.checkAbort();
      }
      app.transferStatus('downloading');
      response = await fetch(url, {
        signal: requestController.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'Soubor pro tento rok není na ČSÚ dostupný.'
            : `Server ČSÚ odpověděl ${response.status}.`,
        );
      const total = expectedSize || Number(response.headers.get('content-length')) || 0;
      const modified = response.headers.get('last-modified');
      app.progress(
        'Stahuji přímo z ČSÚ',
        total ? rangeStart : null,
        total ? `0 MB / ${app.mb(total)}` : 'Čekám na první data…',
      );
      if (!response.body) {
        const blob = await response.blob();
        app.progress('Staženo, připravuji zpracování', rangeEnd, app.mb(blob.size));
        return {
          blob,
          modified,
        };
      }
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      let lastUpdate = 0;
      while (true) {
        app.checkAbort();
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        const now = performance.now();
        if (now - lastUpdate > 80) {
          const percent = CsuTransfers.fraction(loaded, total, rangeStart, rangeEnd);
          app.progress(
            'Stahuji přímo z ČSÚ',
            percent,
            percent != null ? `${app.mb(loaded)} / ${app.mb(total)}` : `${app.mb(loaded)} přijato`,
          );
          lastUpdate = now;
        }
      }
      app.progress('Staženo, připravuji zpracování', rangeEnd, app.mb(loaded));
      return {
        blob: new Blob(chunks, {
          type: 'text/csv;charset=utf-8',
        }),
        modified,
      };
    } catch (error) {
      if (timedOut) throw new Error('Server neodpověděl do 90 sekund.');
      throw error;
    } finally {
      clearTimeout(timeout);
      operationSignal?.removeEventListener('abort', onCancel);
    }
  }
  function parseCatalog(text, required) {
    const result = Papa.parse(text, {
      delimiter: ',',
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (value) =>
        value
          .replace(/^\uFEFF/, '')
          .trim()
          .toLowerCase(),
    });
    if (
      result.errors.length ||
      !result.data.length ||
      required.some((key) => !result.meta.fields.includes(key))
    )
      throw new Error('Číselník má neočekávanou strukturu.');
    return result.data;
  }
  function stopWorker(error = new Error('Zpracování bylo přerušeno.')) {
    app.worker?.terminate();
    app.worker = null;
    app.workerYear = null;
    for (const pending of app.workerPending.values()) pending.reject(error);
    app.workerPending.clear();
  }
  function getWorker() {
    if (app.worker) return app.worker;
    const source = app.$('worker-source').textContent;
    const url = URL.createObjectURL(
      new Blob([source], {
        type: 'text/javascript',
      }),
    );
    app.worker = new Worker(url);
    URL.revokeObjectURL(url);
    app.worker.onmessage = (event) => {
      const message = event.data;
      const pending = app.workerPending.get(message.id);
      if (!pending) return;
      if (message.type === 'progress') {
        app.transferStatus('processing');
        app.progress(
          'Zpracovávám a propojuji data',
          75 + message.value * 0.22,
          `${new Intl.NumberFormat('cs-CZ').format(message.rows)} řádků`,
        );
      } else {
        app.workerPending.delete(message.id);
        if (message.type === 'error') {
          app.workerYear = null;
          pending.reject(new Error(message.message));
        } else {
          app.workerYear = message.data.year;
          pending.resolve(message.data);
        }
      }
    };
    app.worker.onerror = (event) => {
      event.preventDefault();
      app.stopWorker(
        new Error(
          'Prohlížeč nemohl spustit zpracování dat na pozadí. Zkuste aktuální Firefox, Chrome nebo Edge.',
        ),
      );
    };
    return app.worker;
  }
  function workerRequest(message) {
    return new Promise((resolve, reject) => {
      const id = ++app.requestCounter;
      app.workerPending.set(id, {
        resolve,
        reject,
      });
      try {
        app.getWorker().postMessage({
          ...message,
          id,
        });
      } catch (error) {
        app.workerPending.delete(id);
        reject(error);
      }
    });
  }
  async function getYear(year, force = false) {
    app.checkAbort();
    app.startYearTransfer(year);
    const ready = app.validSlice(year);
    if (ready && !force) {
      app.transferStatus('done', 'Již připraveno · bez stahování');
      app.progress('Používám připravená data', 100);
      return ready;
    }
    app.progress('Hledám uložená data', null);
    if (!force && app.workerYear === year) {
      app.transferStatus('processing', 'Používám index v pracovní paměti');
      const data = await app.workerRequest({
        type: 'query',
        year,
        codes: [...app.state.places],
      });
      app.slices.set(year, data);
      app.sliceRevision++;
      app.transferStatus('done', 'Připraveno z pracovní paměti · bez stahování');
      app.progress('Hotovo', 100);
      return data;
    }
    let record = !force ? await app.cacheGet(`year-${year}`) : null;
    app.checkAbort();
    let fromNetwork = false;
    if (!record) {
      const url = `${app.BASE}mos_data_${year}.csv`;
      const { blob, modified } = await app.downloadBlob(url);
      record = {
        key: `year-${year}`,
        year,
        blob,
        size: blob.size,
        savedAt: Date.now(),
        modified,
        url,
      };
      fromNetwork = true;
    } else {
      app.transferStatus('processing', 'Uložený soubor · bez stahování');
      app.progress('Používám soubor z místní paměti', 75, app.mb(record.size));
    }
    app.checkAbort();
    let data;
    try {
      app.transferStatus('processing');
      data = await app.workerRequest({
        type: 'load',
        year,
        blob: record.blob,
        codes: [...app.state.places],
        knownCodes: [...app.territories.keys()],
      });
    } catch (error) {
      if (!fromNetwork && error.name !== 'AbortError') await app.cacheRemove(record.key);
      throw error;
    }
    app.checkAbort();
    if (fromNetwork) {
      app.transferStatus('saving');
      app.progress('Ukládám pro příští návštěvu', 98, app.mb(record.size));
      await app.cachePut(record);
    }
    app.slices.set(year, data);
    app.sliceRevision++;
    app.transferStatus(
      'done',
      `${app.mb(record.size)} · ${fromNetwork ? 'nově staženo' : 'z místní paměti'}`,
    );
    app.progress('Hotovo', 100, `${new Intl.NumberFormat('cs-CZ').format(data.rowCount)} řádků`);
    return data;
  }
  async function discoverLatest() {
    const candidate = new Date().getFullYear() - 1;
    if (candidate <= app.latest) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${app.BASE}mos_data_${candidate}.csv`, {
          method: 'HEAD',
          signal: controller.signal,
          credentials: 'omit',
        });
        if (response.ok) {
          app.latest = candidate;
          app.populateYears();
          app.$('latest-label').textContent = app.latest;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      /* A known published range remains usable offline. */
    }
  }
  async function initializeCatalog() {
    if (app.catalogPromise) return app.catalogPromise;
    app.catalogPromise = app.runOperation('Připravuji seznam obcí', async () => {
      if (!app.db) app.db = await app.openDatabase();
      let record = await app.cacheGet('catalog');
      app.checkAbort();
      const fresh = record && Date.now() - record.savedAt < 7 * 86400000;
      if (!fresh) {
        const texts = {};
        const files = [
          ['territories', 'mos_uzemi.csv'],
          ['indicators', 'mos_ukaz.csv'],
          ['topics', 'mos_okruhy.csv'],
        ];
        app.setTransferTasks(
          files.map(([key, name], index) => ({
            id: `catalog-${key}`,
            name,
            title: ['Seznam obcí', 'Ukazatele a metodika', 'Tematické okruhy'][index],
            status: 'queued',
            fraction: 0,
          })),
        );
        try {
          for (let index = 0; index < files.length; index++) {
            app.taskIndex = index;
            const [key, filename] = files[index];
            app.activeTransfer = `catalog-${key}`;
            app.$('loading-detail').textContent = [
              'Číselník obcí a jejich územní historie',
              'Ukazatele, jednotky a metodika',
              'Tematické okruhy',
            ][index];
            texts[key] = await (await app.downloadBlob(app.BASE + filename, 0, 95)).blob.text();
            app.transferStatus('done', 'Číselník stažen');
          }
          app.parseCatalog(texts.territories, ['koduzemi', 'obec', 'platiod', 'platido', 'okres']);
          app.parseCatalog(texts.indicators, ['kodukaz', 'nazev', 'mj', 'metodika']);
          app.parseCatalog(texts.topics, ['kod', 'nazev']);
          record = {
            key: 'catalog',
            texts,
            savedAt: Date.now(),
          };
          await app.cachePut(record);
        } catch (error) {
          if (error.name === 'AbortError' || !record) throw error;
          for (const task of app.transferTasks) {
            task.cached = true;
            task.status = 'cached';
            task.fraction = 1;
            task.detail = 'Používám uložený číselník';
          }
          app.renderTransfers();
          app.toast('Používám dříve uložené číselníky. Aktualizace nyní není dostupná.');
        }
      }
      app.territories = new Map();
      for (const item of app.parseCatalog(record.texts.territories, [
        'koduzemi',
        'obec',
        'platiod',
        'platido',
        'okres',
      ])) {
        if (!app.territories.has(item.koduzemi)) app.territories.set(item.koduzemi, []);
        app.territories.get(item.koduzemi).push(item);
      }
      app.indicators = new Map(
        app
          .parseCatalog(record.texts.indicators, ['kodukaz', 'nazev', 'mj', 'metodika'])
          .map((item) => [item.kodukaz, item]),
      );
      app.topics = new Map(
        app
          .parseCatalog(record.texts.topics, ['kod', 'nazev'])
          .map((item) => [item.kod, item.nazev]),
      );
      app.state.places = app.state.places.filter((code) => app.territories.has(code));
      if (!app.indicators.has(app.state.indicator)) app.state.indicator = app.POPULATION;
      const districts = [
        ...new Set([...app.territories.values()].flat().map((item) => item.okres)),
      ].sort((a, b) => a.localeCompare(b, 'cs'));
      app.$('district-filter').innerHTML =
        '<option value="">Všechny okresy</option>' +
        districts.map((name) => `<option>${app.esc(name)}</option>`).join('');
      app.$('topic-filter').innerHTML =
        '<option value="">Všechny tematické okruhy</option>' +
        [...app.topics]
          .map(([code, name]) => `<option value="${code}">${app.esc(name)}</option>`)
          .join('');
      app.populateYears();
      app.populateIndicators();
      app.$('places-count').textContent = new Intl.NumberFormat('cs-CZ').format(
        [...app.territories.keys()].filter((code) => app.validArea(code, app.state.year)).length,
      );
      app.$('indicators-count').textContent = app.indicators.size;
      for (const id of ['place-search', 'district-filter', 'year-select', 'bulk-places'])
        app.$(id).disabled = false;
      app.catalogReady = true;
      app.progress('Hotovo', 100);
      app.renderSelection();
      app.updateView();
    });
    await app.catalogPromise;
    app.catalogPromise = null;
    if (app.catalogReady) {
      await app.discoverLatest();
      await app.openYearPicker(true);
    }
  }
  async function loadCurrentYear(force = false) {
    if (!app.state.places.length || !app.catalogReady) return;
    await app.runOperation(
      force ? `Aktualizuji rok ${app.state.year}` : `Načítám rok ${app.state.year}`,
      async () => {
        app.activeSlice = await app.getYear(app.state.year, force);
        app.renderData();
        app.saveHash();
      },
      {
        tasks: CsuTransfers.plan([app.state.year], force ? [] : app.cacheEntries),
      },
    );
  }
  return {
    discoverFileSize,
    downloadBlob,
    parseCatalog,
    stopWorker,
    getWorker,
    workerRequest,
    getYear,
    discoverLatest,
    initializeCatalog,
    loadCurrentYear,
  };
}
