(() => {
  'use strict';
  const BASE = 'https://opendata.csu.gov.cz/soubory/od/od_mos01/';
  const POPULATION = '110900';
  const COLORS = ['#176b57', '#bd8151', '#6b8ea5', '#a08ab1', '#a2a451', '#5b9b92', '#c16d78', '#69845b', '#a49a86', '#557794', '#ae6651', '#8a76a5', '#7f9651', '#42928a', '#c59741', '#597356', '#958078', '#5c8aa0', '#ad81a1', '#93a271'];
  const $ = id => document.getElementById(id);
  const regionCatalog = JSON.parse($('region-data').textContent);
  const placeColor = index => COLORS[index % COLORS.length];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fmt = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(value) : value === 'i.d.' ? 'i.d.' : '—';
  const mb = bytes => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(bytes / 1000000)} MB`;
  const date = time => new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(time));
  const placeCount = count => `${count} ${count === 1 ? 'obec' : count >= 2 && count <= 4 ? 'obce' : 'obcí'}`;
  const yearCount = count => `${count} ${count === 1 ? 'rok' : count >= 2 && count <= 4 ? 'roky' : 'roků'}`;
  const state = { year: 2025, places: [], indicator: POPULATION, view: 'overview', from: 2021, to: 2025, mode: 'absolute', normalize: 'absolute' };
  let latest = 2025;
  let territories = new Map();
  let indicators = new Map();
  let topics = new Map();
  let db = null;
  let catalogReady = false;
  let catalogPromise = null;
  let cacheEntries = [];
  let memoryCache = new Map();
  let worker = null;
  let workerYear = null;
  let requestCounter = 0;
  let workerPending = new Map();
  let slices = new Map();
  let activeSlice = null;
  let historyYears = [];
  let busy = false;
  let operationController = null;
  let overviewTable = null;
  let compareTable = null;
  let historyTable = null;
  let overviewRows = [];
  let compareRows = [];
  let historyRows = [];
  let compareChart = null;
  let historyChart = null;
  let toastTimer;
  let taskIndex = 0;
  let taskTotal = 1;
  let storageWarningShown = false;
  let renderVersion = 0;
  let transferTasks = [];
  let activeTransfer = null;
  let selectedYears = new Set();
  let startupPending = false;
  let sliceRevision = 0;
  const availabilityCache = new Map();
  let visiblePlaceLimit = 12;
  let bulkSelected = new Set();
  let bulkGroups = new Map();
  let displayPlaceNames = new Map();
  const transferLabels = { queued: 'Čeká', cached: 'Již staženo', checking: 'Zjišťuji velikost', downloading: 'Stahuji', processing: 'Zpracovávám', saving: 'Ukládám', done: 'Připraveno', error: 'Chyba', canceled: 'Zrušeno' };

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 5000);
  }
  function notice(message, error = false, retry = false) {
    $('notice').replaceChildren();
    if (!message) { $('notice').classList.add('hidden'); return; }
    const text = document.createElement('span');
    text.textContent = message;
    $('notice').append(text);
    $('notice').className = `notice${error ? ' error' : ''}`;
    if (retry) {
      const button = document.createElement('button');
      button.className = 'button'; button.textContent = 'Zkusit znovu';
      button.onclick = () => initializeCatalog();
      $('notice').append(button);
    }
  }
  function abortError() { return new DOMException('Načítání bylo zrušeno.', 'AbortError'); }
  function checkAbort() { if (operationController?.signal.aborted) throw abortError(); }
  function setTransferTasks(tasks) {
    transferTasks = tasks;
    activeTransfer = null;
    taskTotal = tasks.length || 1;
    $('transfer-section').classList.toggle('hidden', !tasks.length);
    $('transfer-list').innerHTML = tasks.map(task => `<div class="transfer-file" data-transfer-id="${esc(task.id)}"><span class="file-state-icon" aria-hidden="true"></span><div class="file-description"><b>${esc(task.year ? `Rok ${task.year}` : task.title || task.name)}</b><small>${esc(task.name)}</small><span class="file-detail"></span></div><div class="file-state"><span class="file-status"></span><div class="file-meter"><i></i></div></div></div>`).join('');
    renderTransfers();
  }
  function renderTransfers() {
    for (const task of transferTasks) {
      const element = $('transfer-list').querySelector(`[data-transfer-id="${task.id}"]`);
      if (!element) continue;
      element.className = `transfer-file ${task.status}${task.id === activeTransfer ? ' current' : ''}`;
      element.querySelector('.file-state-icon').textContent = ['cached', 'done'].includes(task.status) ? '✓' : task.status === 'error' ? '!' : task.status === 'canceled' ? '−' : '';
      element.querySelector('.file-status').textContent = transferLabels[task.status];
      element.querySelector('.file-detail').textContent = task.detail || (task.cached && task.size ? `${mb(task.size)} · v tomto prohlížeči` : '');
      element.querySelector('.file-meter i').style.width = `${Math.max(0, task.fraction) * 100}%`;
    }
    const ready = transferTasks.filter(task => task.cached || task.status === 'done').length;
    const overall = Math.floor(CsuTransfers.overall(transferTasks));
    $('transfer-summary').textContent = `${ready} z ${transferTasks.length} k dispozici`;
    $('overall-percent').textContent = `${overall} %`;
    $('overall-fill').style.width = `${overall}%`;
    $('overall-progress').setAttribute('aria-valuenow', overall);
    const current = $('transfer-list').querySelector('.transfer-file.current');
    const active = transferTasks.find(task => task.id === activeTransfer);
    if (current && active && active.lastHeight !== current.offsetHeight) {
      active.lastHeight = current.offsetHeight;
      current.scrollIntoView({ block: 'nearest' });
    }
  }
  function transferStatus(status, detail) {
    const task = transferTasks.find(item => item.id === activeTransfer);
    if (!task) return;
    task.status = status;
    if (detail !== undefined) task.detail = detail;
    if (['cached', 'done'].includes(status)) task.fraction = 1;
    renderTransfers();
  }
  function startYearTransfer(year) {
    const changed = activeTransfer !== `year-${year}`;
    activeTransfer = `year-${year}`;
    taskIndex = Math.max(0, transferTasks.findIndex(task => task.id === activeTransfer));
    $('loading-detail').textContent = `Roční statistika ${year}${state.places.length ? ` · ${placeCount(state.places.length)}` : ' · všechny obce'}`;
    renderTransfers();
    if (changed) $('transfer-list').querySelector(`[data-transfer-id="${activeTransfer}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function progress(stage, percent, bytes = '') {
    $('loading-stage').textContent = stage;
    $('loading-bytes').textContent = bytes;
    $('loading-task').textContent = taskTotal > 1 ? `Soubor ${taskIndex + 1} z ${taskTotal}` : '';
    if (percent == null) {
      $('loading-progress').removeAttribute('value');
      $('loading-percent').textContent = '';
      $('progress-track').classList.add('indeterminate');
    } else {
      $('loading-progress').value = percent;
      $('loading-percent').textContent = `${Math.min(100, Math.floor(percent))} %`;
      $('progress-track').classList.remove('indeterminate');
      $('progress-fill').style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
    const task = transferTasks.find(item => item.id === activeTransfer);
    if (task) {
      if (percent != null) task.fraction = Math.max(task.fraction || 0, percent / 100);
      if (bytes) task.detail = bytes;
      renderTransfers();
    }
  }
  async function runOperation(title, callback, options = {}) {
    if (busy) return;
    busy = true;
    operationController = new AbortController();
    taskIndex = 0;
    setTransferTasks(options.tasks || []);
    $('cancel-loading').textContent = 'Zrušit načítání';
    $('cancel-loading').classList.remove('primary');
    $('loading-help').textContent = 'Již stažené soubory se použijí z prohlížeče. Nové se stahují přímo z ČSÚ.';
    $('loading-title').textContent = title;
    $('loading-detail').textContent = 'Připravuji načtení…';
    progress('Připojuji se…', null);
    if (!$('loading-dialog').open) $('loading-dialog').showModal();
    let result = { ok: false, canceled: false };
    try {
      await callback();
      checkAbort();
      notice('');
      result.ok = true;
    } catch (error) {
      result.canceled = error.name === 'AbortError';
      result.error = error;
      transferStatus(result.canceled ? 'canceled' : 'error', error.message);
      if (result.canceled) toast('Načítání zrušeno. Dokončené soubory zůstávají uložené.');
      else {
        console.error(error);
        notice(`Data se nepodařilo načíst: ${error.message} Zkontrolujte připojení a zkuste to znovu.`, true, !catalogReady);
      }
    } finally {
      operationController = null;
      busy = false;
      await updateCacheSummary();
      renderSelection();
      if (options.retain && !result.canceled) {
        if (result.ok) {
          $('loading-title').textContent = 'Vybrané roky jsou připravené';
          $('loading-detail').textContent = 'Uložené roky jsme přeskočili. Nově stažené soubory jsou připravené k prohlížení.';
          activeTransfer = null;
          progress('Hotovo', 100);
          $('cancel-loading').textContent = 'Pokračovat k datům';
          $('cancel-loading').classList.add('primary');
        } else {
          $('loading-title').textContent = 'Načítání se nepodařilo dokončit';
          $('loading-detail').textContent = result.error.message;
          $('cancel-loading').textContent = 'Zavřít';
        }
        $('loading-help').textContent = 'Dokončené soubory zůstávají uložené v prohlížeči. Výběr roků můžete znovu otevřít v levém panelu.';
        renderTransfers();
      } else $('loading-dialog').close();
    }
    return result;
  }
  function cancelOperation() {
    if (!busy) { $('loading-dialog').close(); return; }
    operationController?.abort();
    if (workerPending.size) stopWorker(abortError());
  }
  function openDatabase() {
    return new Promise(resolve => {
      try {
        const request = indexedDB.open('csustats-mos-v1', 1);
        let done = false;
        const timer = setTimeout(() => { done = true; resolve(null); }, 4000);
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' });
        request.onsuccess = () => {
          clearTimeout(timer);
          if (done) { request.result.close(); return; }
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => { clearTimeout(timer); resolve(null); };
        request.onblocked = () => { clearTimeout(timer); resolve(null); };
      } catch { resolve(null); }
    });
  }
  function storeAction(mode, action) {
    if (!db) return Promise.resolve(null);
    return new Promise(resolve => {
      try {
        const transaction = db.transaction('files', mode);
        const request = action(transaction.objectStore('files'));
        let result = null;
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => resolve({ ok: true, value: result });
        transaction.onerror = transaction.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async function cacheGet(key) {
    const result = await storeAction('readonly', store => store.get(key));
    return result?.value ?? memoryCache.get(key) ?? null;
  }
  async function cachePut(record) {
    const result = await storeAction('readwrite', store => store.put(record));
    if (!result) {
      memoryCache.set(record.key, record);
      const years = [...memoryCache.keys()].filter(key => key.startsWith('year-'));
      while (years.length > 2) memoryCache.delete(years.shift());
      if (!storageWarningShown) {
        storageWarningShown = true;
        toast('Trvalé uložení není dostupné. Data jsou dočasně v paměti této stránky.');
      }
    }
    await updateCacheSummary();
  }
  async function cacheRemove(key) {
    await storeAction('readwrite', store => store.delete(key));
    memoryCache.delete(key);
  }
  async function getCacheEntries() {
    const result = await storeAction('readonly', store => store.getAll());
    const merged = new Map((result?.value ?? []).map(record => [record.key, record]));
    for (const [key, record] of memoryCache) merged.set(key, record);
    return [...merged.values()].filter(record => record.key.startsWith('year-')).map(({ key, year, size, savedAt, modified }) => ({ key, year, size, savedAt, modified })).sort((a, b) => b.year - a.year);
  }
  async function updateCacheSummary() {
    cacheEntries = await getCacheEntries();
    const bytes = cacheEntries.reduce((sum, entry) => sum + entry.size, 0);
    $('cache-summary').textContent = cacheEntries.length ? `${cacheEntries.length} ${cacheEntries.length === 1 ? 'rok' : cacheEntries.length < 5 ? 'roky' : 'roků'} · ${mb(bytes)}` : db ? 'Zatím žádné stažené roky' : 'Dočasná paměť stránky';
    updateYearHint();
  }
  async function discoverFileSize(url, signal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      // HEAD reports the uncompressed CSV size on the ČSÚ server.
      return response.ok ? Number(response.headers.get('content-length')) || 0 : 0;
    } catch { return 0; }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  }
  async function downloadBlob(url, rangeStart = 0, rangeEnd = 75) {
    checkAbort();
    let response;
    let timedOut = false;
    const requestController = new AbortController();
    const operationSignal = operationController?.signal;
    const onCancel = () => requestController.abort();
    operationSignal?.addEventListener('abort', onCancel, { once: true });
    const timeout = setTimeout(() => { timedOut = true; requestController.abort(); }, 90000);
    try {
      let expectedSize = 0;
      if (/mos_data_\d{4}\.csv$/.test(url)) {
        transferStatus('checking');
        progress('Zjišťuji velikost souboru', null);
        expectedSize = await discoverFileSize(url, requestController.signal);
        checkAbort();
      }
      transferStatus('downloading');
      response = await fetch(url, { signal: requestController.signal, cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error(response.status === 404 ? 'Soubor pro tento rok není na ČSÚ dostupný.' : `Server ČSÚ odpověděl ${response.status}.`);
      const total = expectedSize || Number(response.headers.get('content-length')) || 0;
      const modified = response.headers.get('last-modified');
      progress('Stahuji přímo z ČSÚ', total ? rangeStart : null, total ? `0 MB / ${mb(total)}` : 'Čekám na první data…');
      if (!response.body) {
        const blob = await response.blob();
        progress('Staženo, připravuji zpracování', rangeEnd, mb(blob.size));
        return { blob, modified };
      }
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      let lastUpdate = 0;
      while (true) {
        checkAbort();
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.byteLength;
        const now = performance.now();
        if (now - lastUpdate > 80) {
          const percent = CsuTransfers.fraction(loaded, total, rangeStart, rangeEnd);
          progress('Stahuji přímo z ČSÚ', percent, percent != null ? `${mb(loaded)} / ${mb(total)}` : `${mb(loaded)} přijato`);
          lastUpdate = now;
        }
      }
      progress('Staženo, připravuji zpracování', rangeEnd, mb(loaded));
      return { blob: new Blob(chunks, { type: 'text/csv;charset=utf-8' }), modified };
    } catch (error) {
      if (timedOut) throw new Error('Server neodpověděl do 90 sekund.');
      throw error;
    } finally { clearTimeout(timeout); operationSignal?.removeEventListener('abort', onCancel); }
  }
  function parseCatalog(text, required) {
    const result = Papa.parse(text, { delimiter: ',', header: true, skipEmptyLines: 'greedy', transformHeader: value => value.replace(/^\uFEFF/, '').trim().toLowerCase() });
    if (result.errors.length || !result.data.length || required.some(key => !result.meta.fields.includes(key))) throw new Error('Číselník má neočekávanou strukturu.');
    return result.data;
  }
  function area(code, year = state.year) {
    const records = territories.get(code) || [];
    return records.find(record => Number(record.platiod) <= year && Number(record.platido) >= year) || records.at(-1) || { koduzemi: code, obec: code, okres: 'Neznámý okres', soorp: '' };
  }
  function placeLabel(code, year = state.year) { return area(code, year).obec; }
  function displayPlace(code) { return displayPlaceNames.get(code) || placeLabel(code); }
  function qualifiedPlace(code, year = state.year) {
    const record = area(code, year);
    return `${record.obec} (${record.okres}, ${code})`;
  }
  function validArea(code, year) { return (territories.get(code) || []).some(record => Number(record.platiod) <= year && Number(record.platido) >= year); }
  function signature(codes = state.places) { return codes.join(','); }
  function validSlice(year) {
    const slice = slices.get(Number(year));
    return slice && signature(slice.codes) === signature() ? slice : null;
  }
  function rawValue(slice, indicator, code) {
    if (!slice) return null;
    slice.codeIndex ||= new Map(slice.codes.map((item, index) => [item, index]));
    const index = slice.codeIndex.get(code);
    return index === undefined ? null : slice.values[indicator]?.[index] ?? null;
  }
  function numeric(value) { return typeof value === 'number' && Number.isFinite(value); }
  function canNormalize(indicator) {
    const item = indicators.get(indicator);
    return !!item && /^(osoba|počet|tis\.?\s*Kč|Kč)$/i.test(item.mj.trim()) && indicator !== '010000' && !/průměr|podíl|index|míra|procent|hustot|na\s+(1|100|tisíc)/i.test(item.nazev);
  }
  function transformedValue(slice, indicator, code, mode = 'absolute') {
    const raw = rawValue(slice, indicator, code);
    if (mode !== 'per1000' || !numeric(raw)) return raw;
    const population = rawValue(slice, POPULATION, code);
    return numeric(population) && population > 0 ? raw / population * 1000 : null;
  }
  function unitLabel(indicator, mode = 'absolute') {
    const unit = indicators.get(indicator)?.mj || 'hodnota';
    return mode === 'per1000' ? `${unit} / 1 000 obyvatel` : mode === 'index' ? 'index (základ = 100)' : unit;
  }
  function stopWorker(error = new Error('Zpracování bylo přerušeno.')) {
    worker?.terminate(); worker = null; workerYear = null;
    for (const pending of workerPending.values()) pending.reject(error);
    workerPending.clear();
  }
  function getWorker() {
    if (worker) return worker;
    const source = `${$('parser-lib').textContent}\n${$('worker-source').textContent}`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = event => {
      const message = event.data;
      const pending = workerPending.get(message.id);
      if (!pending) return;
      if (message.type === 'progress') {
        transferStatus('processing');
        progress('Zpracovávám a propojuji data', 75 + message.value * .22, `${new Intl.NumberFormat('cs-CZ').format(message.rows)} řádků`);
      } else {
        workerPending.delete(message.id);
        if (message.type === 'error') { workerYear = null; pending.reject(new Error(message.message)); }
        else { workerYear = message.data.year; pending.resolve(message.data); }
      }
    };
    worker.onerror = event => { event.preventDefault(); stopWorker(new Error('Prohlížeč nemohl spustit zpracování dat na pozadí. Zkuste aktuální Firefox, Chrome nebo Edge.')); };
    return worker;
  }
  function workerRequest(message) {
    return new Promise((resolve, reject) => {
      const id = ++requestCounter;
      workerPending.set(id, { resolve, reject });
      try { getWorker().postMessage({ ...message, id }); }
      catch (error) { workerPending.delete(id); reject(error); }
    });
  }
  async function getYear(year, force = false) {
    checkAbort();
    startYearTransfer(year);
    const ready = validSlice(year);
    if (ready && !force) { transferStatus('done', 'Již připraveno · bez stahování'); progress('Používám připravená data', 100); return ready; }
    progress('Hledám uložená data', null);
    if (!force && workerYear === year) {
      transferStatus('processing', 'Používám index v pracovní paměti');
      const data = await workerRequest({ type: 'query', year, codes: [...state.places] });
      slices.set(year, data);
      sliceRevision++;
      transferStatus('done', 'Připraveno z pracovní paměti · bez stahování'); progress('Hotovo', 100);
      return data;
    }
    let record = !force ? await cacheGet(`year-${year}`) : null;
    checkAbort();
    let fromNetwork = false;
    if (!record) {
      const url = `${BASE}mos_data_${year}.csv`;
      const { blob, modified } = await downloadBlob(url);
      record = { key: `year-${year}`, year, blob, size: blob.size, savedAt: Date.now(), modified, url };
      fromNetwork = true;
    } else { transferStatus('processing', 'Uložený soubor · bez stahování'); progress('Používám soubor z místní paměti', 75, mb(record.size)); }
    checkAbort();
    let data;
    try {
      transferStatus('processing');
      data = await workerRequest({ type: 'load', year, blob: record.blob, codes: [...state.places], knownCodes: [...territories.keys()] });
    } catch (error) {
      if (!fromNetwork && error.name !== 'AbortError') await cacheRemove(record.key);
      throw error;
    }
    checkAbort();
    if (fromNetwork) {
      transferStatus('saving');
      progress('Ukládám pro příští návštěvu', 98, mb(record.size));
      await cachePut(record);
    }
    slices.set(year, data);
    sliceRevision++;
    transferStatus('done', `${mb(record.size)} · ${fromNetwork ? 'nově staženo' : 'z místní paměti'}`);
    progress('Hotovo', 100, `${new Intl.NumberFormat('cs-CZ').format(data.rowCount)} řádků`);
    return data;
  }
  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const year = Number(params.get('year'));
    if (Number.isInteger(year) && year >= 2000 && year <= new Date().getFullYear()) state.year = year;
    state.places = [...new Set((params.get('places') || '').split(',').filter(code => /^\d{6}$/.test(code)))];
    if (/^\d{6}$/.test(params.get('indicator') || '')) state.indicator = params.get('indicator');
    if (['overview', 'compare', 'history'].includes(params.get('view'))) state.view = params.get('view');
    for (const key of ['from', 'to']) {
      const value = Number(params.get(key));
      if (Number.isInteger(value) && value >= 2000 && value <= new Date().getFullYear()) state[key] = value;
    }
    if (['absolute', 'per1000', 'index'].includes(params.get('mode'))) state.mode = params.get('mode');
    if (['absolute', 'per1000'].includes(params.get('normalize'))) state.normalize = params.get('normalize');
  }
  function saveHash() {
    const params = new URLSearchParams({ year: state.year, places: signature(), indicator: state.indicator, view: state.view, from: state.from, to: state.to, mode: state.mode, normalize: state.normalize });
    try { history.replaceState(null, '', `#${params}`); }
    catch { /* Some file-origin browsers restrict history writes; functionality is unaffected. */ }
  }
  async function discoverLatest() {
    const candidate = new Date().getFullYear() - 1;
    if (candidate <= latest) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${BASE}mos_data_${candidate}.csv`, { method: 'HEAD', signal: controller.signal, credentials: 'omit' });
        if (response.ok) { latest = candidate; populateYears(); $('latest-label').textContent = latest; }
      } finally { clearTimeout(timeout); }
    } catch { /* A known published range remains usable offline. */ }
  }
  function populateYears() {
    const options = [];
    for (let year = latest; year >= 2000; year--) options.push(`<option value="${year}">${year}</option>`);
    for (const id of ['year-select', 'history-from', 'history-to']) $(id).innerHTML = options.join('');
    state.year = Math.min(latest, Math.max(2000, state.year));
    state.from = Math.min(latest, Math.max(2000, state.from));
    state.to = Math.min(latest, Math.max(state.from, state.to));
    $('year-select').value = state.year; $('history-from').value = state.from; $('history-to').value = state.to;
  }
  async function initializeCatalog() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = runOperation('Připravuji seznam obcí', async () => {
      if (!db) db = await openDatabase();
      let record = await cacheGet('catalog');
      checkAbort();
      const fresh = record && Date.now() - record.savedAt < 7 * 86400000;
      if (!fresh) {
        const texts = {};
        const files = [['territories', 'mos_uzemi.csv'], ['indicators', 'mos_ukaz.csv'], ['topics', 'mos_okruhy.csv']];
        setTransferTasks(files.map(([key, name], index) => ({ id: `catalog-${key}`, name, title: ['Seznam obcí', 'Ukazatele a metodika', 'Tematické okruhy'][index], status: 'queued', fraction: 0 })));
        try {
          for (let index = 0; index < files.length; index++) {
            taskIndex = index;
            const [key, filename] = files[index];
            activeTransfer = `catalog-${key}`;
            $('loading-detail').textContent = ['Číselník obcí a jejich územní historie', 'Ukazatele, jednotky a metodika', 'Tematické okruhy'][index];
            texts[key] = await (await downloadBlob(BASE + filename, 0, 95)).blob.text();
            transferStatus('done', 'Číselník stažen');
          }
          parseCatalog(texts.territories, ['koduzemi', 'obec', 'platiod', 'platido', 'okres']);
          parseCatalog(texts.indicators, ['kodukaz', 'nazev', 'mj', 'metodika']);
          parseCatalog(texts.topics, ['kod', 'nazev']);
          record = { key: 'catalog', texts, savedAt: Date.now() };
          await cachePut(record);
        } catch (error) {
          if (error.name === 'AbortError' || !record) throw error;
          for (const task of transferTasks) { task.cached = true; task.status = 'cached'; task.fraction = 1; task.detail = 'Používám uložený číselník'; }
          renderTransfers();
          toast('Používám dříve uložené číselníky. Aktualizace nyní není dostupná.');
        }
      }
      territories = new Map();
      for (const item of parseCatalog(record.texts.territories, ['koduzemi', 'obec', 'platiod', 'platido', 'okres'])) {
        if (!territories.has(item.koduzemi)) territories.set(item.koduzemi, []);
        territories.get(item.koduzemi).push(item);
      }
      indicators = new Map(parseCatalog(record.texts.indicators, ['kodukaz', 'nazev', 'mj', 'metodika']).map(item => [item.kodukaz, item]));
      topics = new Map(parseCatalog(record.texts.topics, ['kod', 'nazev']).map(item => [item.kod, item.nazev]));
      state.places = state.places.filter(code => territories.has(code));
      if (!indicators.has(state.indicator)) state.indicator = POPULATION;
      const districts = [...new Set([...territories.values()].flat().map(item => item.okres))].sort((a, b) => a.localeCompare(b, 'cs'));
      $('district-filter').innerHTML = '<option value="">Všechny okresy</option>' + districts.map(name => `<option>${esc(name)}</option>`).join('');
      $('topic-filter').innerHTML = '<option value="">Všechny tematické okruhy</option>' + [...topics].map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join('');
      populateYears();
      populateIndicators();
      $('places-count').textContent = new Intl.NumberFormat('cs-CZ').format([...territories.keys()].filter(code => validArea(code, state.year)).length);
      $('indicators-count').textContent = indicators.size;
      for (const id of ['place-search', 'district-filter', 'year-select', 'bulk-places']) $(id).disabled = false;
      catalogReady = true;
      progress('Hotovo', 100);
      renderSelection();
      updateView();
    });
    await catalogPromise;
    catalogPromise = null;
    if (catalogReady) {
      await discoverLatest();
      await openYearPicker(true);
    }
  }
  function populateIndicators() {
    renderIndicatorOptions('compare');
    renderIndicatorOptions('history');
    $('compare-normalize').value = state.normalize;
    $('history-mode').value = state.mode;
  }
  function indicatorAvailability(view) {
    const years = view === 'compare' ? [state.year] : requestedHistoryYears();
    const loaded = years.filter(year => validSlice(year));
    const key = `${sliceRevision}|${signature()}|${years.join(',')}|${loaded.join(',')}`;
    if (availabilityCache.get(view)?.key === key) return availabilityCache.get(view);
    const pending = loaded.length < years.length;
    const coverage = new Map();
    const loadedSlices = loaded.map(year => validSlice(year));
    const empty = new Array(state.places.length).fill(null);
    for (const code of indicators.keys()) {
      const values = [];
      let coveredYears = 0;
      for (const slice of loadedSlices) {
        const yearly = slice.values[code] || empty;
        if (yearly.some(numeric)) coveredYears++;
        values.push(...yearly);
      }
      const item = CsuCoverage.summarize(values);
      item.coveredYears = coveredYears;
      item.expected = years.length * state.places.length;
      if (!pending && years.length > 1 && coveredYears === 1 && item.count > 0) item.sparse = true;
      coverage.set(code, item);
    }
    const result = { key, coverage, pending, years, loaded };
    availabilityCache.set(view, result);
    return result;
  }
  function renderIndicatorOptions(view) {
    const info = indicatorAvailability(view);
    const showEmpty = $(`${view}-show-empty`).checked;
    const query = fold($(`${view}-indicator-search`).value.trim());
    const visible = [...indicators.values()].filter(item => {
      const coverage = info.coverage.get(item.kodukaz);
      return (showEmpty || info.pending || coverage.count > 0) && (!query || fold(`${item.nazev} ${item.kodukaz} ${topics.get(item.okruh) || ''}`).includes(query));
    });
    function option(item) {
      const coverage = info.coverage.get(item.kodukaz);
      const availability = !coverage.count ? info.pending ? 'dostupnost zatím neověřena' : 'bez číselných údajů' : view === 'compare' ? `${coverage.count}/${state.places.length} obcí` : `${coverage.count}/${coverage.expected} hodnot · ${coverage.coveredYears}/${info.years.length} let`;
      return `<option value="${item.kodukaz}">${esc(item.nazev)}${item.mj ? ` · ${esc(item.mj)}` : ''} [${item.kodukaz}] — ${coverage.sparse ? '⚠ málo dat · ' : ''}${availability}</option>`;
    }
    const selected = indicators.get(state.indicator);
    const keepSelected = selected && !visible.some(item => item.kodukaz === state.indicator);
    const groups = [...topics].map(([topic, name]) => {
      const items = visible.filter(item => item.okruh === topic);
      return items.length ? `<optgroup label="${esc(name)} (${items.length})">${items.map(option).join('')}</optgroup>` : '';
    }).join('');
    $(`${view}-indicator`).innerHTML = (keepSelected ? `<optgroup label="Aktuálně vybraný ukazatel">${option(selected)}</optgroup>` : '') + groups;
    $(`${view}-indicator`).value = state.indicator;
    const limited = visible.filter(item => info.coverage.get(item.kodukaz).sparse).length;
    const hidden = !info.pending && !showEmpty ? [...info.coverage.values()].filter(item => !item.count).length : 0;
    const message = `Zobrazeno <b>${visible.length}${keepSelected ? ' + vybraný' : ''}</b> z ${indicators.size} ukazatelů${hidden ? ` · ${hidden} bez číselných údajů skryto` : ''}${limited ? ` · <span class="limited-count">${limited} s malým počtem údajů (⚠)</span>` : ''}.`;
    $(`${view}-availability`).innerHTML = `Pro vybrané obce${view === 'compare' ? ` v roce ${state.year}` : ` v období ${state.from}–${state.to}`}: ` + message + (view === 'history' && info.pending ? ` <b>Načteno ${info.loaded.length}/${info.years.length} let.</b> Zatím neověřené ukazatele zůstávají ve výběru do načtení celého období.` : '') + (keepSelected && !info.pending && !info.coverage.get(state.indicator)?.count ? ' Vybraný ukazatel nemá číselné údaje; je ponechán pro zobrazení jeho metodiky.' : '');
  }
  function renderSearch() {
    if (!catalogReady) return;
    const query = fold($('place-search').value.trim());
    const district = $('district-filter').value;
    if (!query && !district) { $('place-results').classList.add('hidden'); $('place-search').setAttribute('aria-expanded', 'false'); return; }
    const results = [];
    for (const code of territories.keys()) {
      if (state.places.includes(code) || !validArea(code, state.year)) continue;
      const item = area(code);
      if (district && item.okres !== district) continue;
      if (query && !fold(`${item.obec} ${code}`).includes(query)) continue;
      results.push({ code, ...item });
    }
    results.sort((a, b) => {
      const aExact = fold(a.obec).startsWith(query) ? 0 : 1;
      const bExact = fold(b.obec).startsWith(query) ? 0 : 1;
      return aExact - bExact || a.obec.localeCompare(b.obec, 'cs') || a.okres.localeCompare(b.okres, 'cs');
    });
    $('place-results').innerHTML = results.length ? results.slice(0, 35).map(item => `<button class="place-result" data-code="${item.code}"><b>${esc(item.obec)} <span class="muted">+</span></b><small>okres ${esc(item.okres)} · ${item.code}</small></button>`).join('') + (results.length > 35 ? '<p class="no-results">Zobrazeno prvních 35 výsledků. Upřesněte hledání.</p>' : '') : '<p class="no-results">Žádná další obec neodpovídá hledání pro tento rok.</p>';
    $('place-results').classList.remove('hidden');
    $('place-search').setAttribute('aria-expanded', 'true');
  }
  function renderBulkGroups() {
    const scope = document.querySelector('[name="bulk-scope"]:checked').value;
    bulkGroups = new Map();
    for (const code of territories.keys()) {
      if (!validArea(code, state.year)) continue;
      const record = area(code);
      const name = scope === 'district' ? record.okres : regionCatalog.districts[record.okres] || 'Nezařazeno';
      if (!bulkGroups.has(name)) bulkGroups.set(name, []);
      bulkGroups.get(name).push(code);
    }
    const query = fold($('bulk-search').value.trim());
    const existing = new Set(state.places);
    const groups = [...bulkGroups].filter(([name]) => !query || fold(name).includes(query)).sort(([a], [b]) => a.localeCompare(b, 'cs'));
    $('bulk-options').innerHTML = groups.map(([name, codes]) => `<label class="bulk-option${bulkSelected.has(name) ? ' selected' : ''}"><input type="checkbox" data-bulk-group="${esc(name)}" ${bulkSelected.has(name) ? 'checked' : ''}><span><b>${esc(name)}</b><small>${placeCount(codes.length)} · ${codes.filter(code => existing.has(code)).length} již ve výběru</small></span></label>`).join('') || '<p class="no-results">Žádný územní celek neodpovídá hledání.</p>';
    updateBulkSummary();
  }
  function bulkIncoming() {
    return [...new Set([...bulkSelected].flatMap(name => bulkGroups.get(name) || []))].sort((a, b) => placeLabel(a).localeCompare(placeLabel(b), 'cs') || a.localeCompare(b));
  }
  function updateBulkSummary() {
    const incoming = bulkIncoming();
    const replace = $('bulk-action').value === 'replace';
    const next = CsuPlaces.merge(state.places, incoming, replace);
    const existing = new Set(state.places);
    const added = incoming.filter(code => !existing.has(code)).length;
    const groupCount = `${bulkSelected.size} ${bulkSelected.size === 1 ? 'celek' : bulkSelected.size >= 2 && bulkSelected.size <= 4 ? 'celky' : 'celků'}`;
    $('bulk-summary').textContent = `Vybráno ${groupCount} · ${placeCount(incoming.length)}${replace ? ` · nový výběr: ${placeCount(next.length)}` : ` · ${added} nových · celkem ${placeCount(next.length)}`}.`;
    $('bulk-apply').disabled = !incoming.length || (!replace && !added);
    $('bulk-apply').textContent = !incoming.length ? 'Vyberte územní celek' : !replace && !added ? 'Obce už jsou ve výběru' : replace ? `Nahradit výběr · ${placeCount(next.length)}` : `Přidat ${placeCount(added)}`;
    for (const checkbox of $('bulk-options').querySelectorAll('[data-bulk-group]')) checkbox.closest('.bulk-option').classList.toggle('selected', checkbox.checked);
  }
  function openBulkPicker() {
    bulkSelected = new Set();
    $('bulk-search').value = '';
    $('bulk-action').value = 'append';
    document.querySelector('[name="bulk-scope"][value="district"]').checked = true;
    if ($('district-filter').value) bulkSelected.add($('district-filter').value);
    $('bulk-year-hint').textContent = `Vyberte jeden nebo více celků. Přidají se všechny jejich obce podle číselníku MOS pro rok ${state.year}; již vybrané se neduplikují.`;
    renderBulkGroups();
    $('bulk-dialog').showModal();
  }
  function renderSelection() {
    const names = new Map();
    for (const code of state.places) { const name = placeLabel(code); names.set(name, (names.get(name) || 0) + 1); }
    displayPlaceNames = new Map(state.places.map(code => [code, names.get(placeLabel(code)) > 1 ? `${placeLabel(code)} (${area(code).okres})` : placeLabel(code)]));
    $('selected-places').innerHTML = state.places.slice(0, visiblePlaceLimit).map((code, index) => `<div class="place-chip"><span class="place-color" style="--place-color:${placeColor(index)}"></span><span class="place-chip-name">${esc(placeLabel(code))}<small>okres ${esc(area(code).okres)}${validArea(code, state.year) ? '' : ' · mimo platnost v tomto roce'}</small></span><button class="remove-place" data-remove="${code}" title="Odebrat ${esc(placeLabel(code))}" aria-label="Odebrat ${esc(placeLabel(code))}">×</button></div>`).join('');
    $('selection-toolbar').classList.toggle('hidden', !state.places.length);
    $('selection-count').textContent = `Vybráno ${placeCount(state.places.length)}`;
    $('more-places').classList.toggle('hidden', state.places.length <= visiblePlaceLimit);
    $('more-places').textContent = `Zobrazit dalších ${Math.min(50, state.places.length - visiblePlaceLimit)} obcí`;
    $('selection-hint').textContent = state.places.length > visiblePlaceLimit ? `Zobrazeno ${visiblePlaceLimit} z ${state.places.length}. Tabulky zahrnují všechny vybrané obce.` : 'Obce lze přidávat jednotlivě nebo po územních celcích.';
    $('load-year').disabled = !catalogReady || !state.places.length;
    $('refresh-year').disabled = !activeSlice;
    $('year-display').textContent = state.year;
    $('year-status').textContent = validSlice(state.year) ? 'data připravena' : 'čeká na načtení';
    const summaryPlaces = state.places.length > 5 ? state.places.slice(0, 3) : state.places;
    $('active-summary').innerHTML = state.places.length ? summaryPlaces.map((code, index) => `<span class="summary-chip"><span class="place-color" style="--place-color:${placeColor(index)}"></span>${esc(placeLabel(code))}</span>`).join('<span class="summary-separator">/</span>') + (state.places.length > 5 ? `<span class="summary-count">+ ${state.places.length - 3} dalších obcí</span>` : '') + `<span class="muted">· ${state.year}</span>` : '<span class="muted">Vyberte obec a načtěte roční data.</span>';
    updateYearHint();
  }
  function updateYearHint() {
    const entry = cacheEntries.find(item => item.year === state.year);
    $('year-hint').textContent = entry ? `Uloženo v prohlížeči · ${mb(entry.size)} · ${date(entry.savedAt)}` : 'První načtení stáhne celý roční soubor (desítky MB).';
  }
  async function changePlaces(next) {
    if (busy) return;
    state.places = [...new Set(next)];
    activeSlice = null;
    $('place-search').value = '';
    $('place-results').classList.add('hidden');
    $('place-search').setAttribute('aria-expanded', 'false');
    renderSelection(); saveHash(); renderData();
    if (state.places.length && (slices.has(state.year) || cacheEntries.some(entry => entry.year === state.year))) await loadCurrentYear();
  }
  async function loadCurrentYear(force = false) {
    if (!state.places.length || !catalogReady) return;
    await runOperation(force ? `Aktualizuji rok ${state.year}` : `Načítám rok ${state.year}`, async () => {
      activeSlice = await getYear(state.year, force);
      renderData(); saveHash();
    }, { tasks: CsuTransfers.plan([state.year], force ? [] : cacheEntries) });
  }
  function valueFormatter(cell) {
    return valueHTML(cell.getValue());
  }
  function valueHTML(value) {
    return value === 'i.d.' ? '<span class="data-protected" title="Individuální důvěrný údaj">i.d.</span>' : value == null ? '<span class="data-missing" title="Údaj není k dispozici">—</span>' : esc(fmt(value));
  }
  function nameFormatter(cell) {
    const item = cell.getRow().getData();
    const coverage = item.coverage;
    const kind = !coverage.count ? 'none' : coverage.sparse ? 'sparse' : coverage.count < coverage.total ? 'partial' : 'complete';
    return `<div class="indicator-content"><span class="indicator-name">${esc(item.name)}</span><span class="indicator-meta"><span class="indicator-topic">${esc(item.topic)}</span><span class="indicator-code">${item.code}</span><span class="coverage-badge ${kind}" title="Číselné údaje pro ${coverage.count} z ${coverage.total} vybraných obcí">${coverage.sparse ? '⚠ ' : ''}${coverage.count}/${coverage.total} obcí</span></span></div><span class="indicator-open" aria-hidden="true">↗</span>`;
  }
  function numberSorter(a, b) {
    const aNum = numeric(a), bNum = numeric(b);
    return aNum && bNum ? a - b : aNum ? -1 : bNum ? 1 : String(a ?? '').localeCompare(String(b ?? ''));
  }
  function makeTable(element, columns, rows, extra = {}) {
    return new Tabulator(element, { data: rows, columns, layout: 'fitColumns', columnDefaults: { vertAlign: 'middle', headerWordWrap: true, resizable: true }, placeholder: 'Pro tento výběr nejsou dostupné údaje.', renderVertical: 'virtual', renderHorizontal: 'virtual', headerSortElement: '<span style="font-size:9px;color:#a2ae9d">↕</span>', ...extra });
  }
  function renderCards() {
    const first = state.places[0];
    const definitions = [
      { code: POPULATION, label: 'Obyvatelé', unit: 'obyvatel' },
      { code: '113000', label: 'Průměrný věk', unit: 'let' },
      { code: '010300', label: 'Rozloha', unit: 'ha' },
      { code: '121800', label: 'Dokončené byty', unit: 'bytů' },
    ];
    $('stat-cards').innerHTML = definitions.map(item => `<div class="stat-card"><div class="stat-card-label">${item.label} <span class="muted">· ${item.unit}</span></div><strong>${fmt(rawValue(activeSlice, item.code, first))}</strong><small><b>${esc(placeLabel(first))}</b> · ${state.year}</small><div class="mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>`).join('');
  }
  function filterOverview() {
    if (!overviewTable) return;
    const query = fold($('indicator-search').value.trim());
    const topic = $('topic-filter').value;
    const available = $('available-only').checked;
    overviewTable.setFilter(row => (!query || fold(`${row.name} ${row.code} ${row.topic} ${row.unit}`).includes(query)) && (!topic || row.topicCode === topic) && (!available || row.coverage.count > 0));
    $('row-count').textContent = `${overviewTable.getDataCount('active')} ukazatelů · ${placeCount(state.places.length)}`;
  }
  function renderOverview() {
    renderCards();
    const empty = new Array(state.places.length).fill(null);
    overviewRows = [...indicators.values()].map(item => {
      const row = { code: item.kodukaz, name: item.nazev, topic: topics.get(item.okruh) || '', topicCode: item.okruh, unit: item.mj || '—' };
      row.coverage = CsuCoverage.summarize(activeSlice.values[item.kodukaz] || empty);
      return row;
    });
    const columns = [
      { title: 'Ukazatel / tematický okruh', field: 'name', cssClass: 'indicator-cell', formatter: nameFormatter, minWidth: 300, widthGrow: 3, variableHeight: true, frozen: window.innerWidth > 650, tooltip: false },
      { title: 'Jednotka', field: 'unit', width: 92, headerSort: false, cssClass: 'unit-cell' },
      ...state.places.map((code, index) => ({ title: esc(displayPlace(code)), field: `v${code}`, minWidth: 125, widthGrow: 1, hozAlign: 'right', headerHozAlign: 'right', formatter: cell => valueHTML(rawValue(activeSlice, cell.getRow().getData().code, code)), sorter: (_, __, a, b) => numberSorter(rawValue(activeSlice, a.getData().code, code), rawValue(activeSlice, b.getData().code, code)), titleFormatter: () => `<span class="table-color" style="background:${placeColor(index)}"></span>${esc(displayPlace(code))}`, headerTooltip: qualifiedPlace(code) })),
    ];
    overviewTable?.destroy();
    overviewTable = makeTable($('overview-table'), columns, overviewRows, { height: 555, index: 'code' });
    overviewTable.on('tableBuilt', filterOverview);
    overviewTable.on('rowClick', (_, row) => { selectIndicator(row.getData().code); switchView('compare'); });
    overviewTable.on('renderComplete', () => {
      for (const row of overviewTable.getRows('visible')) {
        row.getElement().tabIndex = 0;
        row.getElement().setAttribute('aria-label', `${row.getData().name}. Enter: zobrazit porovnání.`);
        row.getElement().onkeydown = event => { if (event.key === 'Enter') { selectIndicator(row.getData().code); switchView('compare'); } };
      }
    });
  }
  function selectIndicator(code) {
    if (!indicators.has(code)) return;
    state.indicator = code;
    if (!canNormalize(code)) { state.normalize = 'absolute'; if (state.mode === 'per1000') state.mode = 'absolute'; }
    $('compare-indicator').value = code; $('history-indicator').value = code;
    $('compare-normalize').value = state.normalize; $('history-mode').value = state.mode;
    saveHash();
    if (state.view === 'compare') renderCompare();
    if (state.view === 'history') renderHistory();
  }
  function normalizationControls() {
    const enabled = canNormalize(state.indicator);
    $('compare-normalize').querySelector('[value="per1000"]').disabled = !enabled;
    $('history-mode').querySelector('[value="per1000"]').disabled = !enabled;
    if (!enabled) {
      if (state.normalize === 'per1000') state.normalize = 'absolute';
      if (state.mode === 'per1000') state.mode = 'absolute';
      $('compare-normalize').value = state.normalize;
      $('history-mode').value = state.mode;
    }
  }
  function renderMethod(target) {
    const item = indicators.get(state.indicator);
    if (!item) { $(target).replaceChildren(); return; }
    $(target).innerHTML = `<details><summary>Co přesně tento ukazatel znamená?</summary><p>${esc(item.metodika || 'Podrobnější metodika není v číselníku uvedena.').replace(/\r?\n/g, '<br>')}</p><div class="method-meta"><span><b>Zdroj:</b> ${esc(item.zdroj)}</span><span><b>Kód:</b> ${item.kodukaz}</span><span><b>Jednotka:</b> ${esc(item.mj || 'neuvedena')}</span><span><b>Platnost:</b> ${item.platiod}–${item.platido === '9999' ? 'dosud' : item.platido}</span></div><p class="tiny">Hodnoty vycházejí z územního vymezení v příslušném roce. U sčítání a jednorázových šetření může roční soubor obsahovat údaj ze staršího referenčního období uvedeného v názvu či metodice.</p></details>`;
  }
  function chartBase() {
    return { backgroundColor: '#ffffff', color: COLORS, animationDuration: 350, textStyle: { fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 11, color: '#6c806e' }, aria: { enabled: true }, grid: { left: 12, right: 28, top: 25, bottom: 20, containLabel: true }, tooltip: { trigger: 'axis', confine: true, valueFormatter: value => fmt(value) }, xAxis: { axisLine: { lineStyle: { color: '#dce5d8' } }, axisTick: { show: false }, axisLabel: { color: '#7e8e7a' } }, yAxis: { splitLine: { lineStyle: { color: '#edf1e9', type: 'dashed' } }, axisLabel: { formatter: value => fmt(value), color: '#7e8e7a' } } };
  }
  function warning(target, messages) {
    $(target).textContent = messages.join(' ');
    $(target).classList.toggle('hidden', !messages.length);
  }
  function renderCompare() {
    if (!activeSlice) return;
    renderIndicatorOptions('compare');
    normalizationControls();
    const item = indicators.get(state.indicator);
    const unit = unitLabel(state.indicator, state.normalize);
    $('compare-title').textContent = item.nazev;
    $('compare-subtitle').textContent = `${state.year} · ${unit}${state.places.length > 9 ? ` · výřez z ${state.places.length} obcí (graf lze posouvat)` : ''}`;
    compareRows = state.places.map((code, index) => ({ code, name: placeLabel(code), displayName: displayPlace(code), district: area(code).okres, color: placeColor(index), value: transformedValue(activeSlice, state.indicator, code, state.normalize), original: rawValue(activeSlice, state.indicator, code) }));
    compareChart ||= echarts.init($('compare-chart'), null, { renderer: 'svg' });
    const option = chartBase();
    option.grid = { left: 12, right: 55, top: 10, bottom: state.places.length > 9 ? 45 : 10, containLabel: true };
    option.tooltip = { ...option.tooltip, axisPointer: { type: 'shadow' } };
    option.xAxis = { ...option.xAxis, type: 'value', axisLabel: { ...option.xAxis.axisLabel, formatter: value => fmt(value) }, splitLine: { lineStyle: { color: '#edf1e9', type: 'dashed' } } };
    option.yAxis = { type: 'category', inverse: true, data: compareRows.map(row => row.displayName), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#647c66', width: 150, overflow: 'truncate' } };
    option.series = [{ type: 'bar', name: unit, barMaxWidth: 28, itemStyle: { borderRadius: [0, 5, 5, 0] }, label: { show: true, position: 'right', color: '#526c56', fontSize: 11, formatter: params => fmt(params.value) }, data: compareRows.map(row => ({ value: numeric(row.value) ? row.value : null, itemStyle: { color: row.color } })) }];
    option.graphic = compareRows.some(row => numeric(row.value)) ? [] : [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Pro tento ukazatel nejsou dostupné číselné údaje.', fill: '#8b9b86', fontSize: 12 } }];
    if (state.places.length > 9) option.dataZoom = [{ type: 'slider', yAxisIndex: 0, right: 0, width: 12, start: 0, end: Math.min(100, 9 / state.places.length * 100), showDetail: false }];
    compareChart.setOption(option, true);
    const warnings = [];
    if (compareRows.some(row => !numeric(row.value))) warnings.push('Chybějící a chráněné údaje se v grafu nevykreslují; stav najdete v tabulce.');
    if (state.normalize === 'per1000') warnings.push('Přepočet používá obyvatelstvo k 31. 12. stejného roku. Bez dostupného kladného počtu obyvatel se hodnota nevypočítá.');
    if (state.indicator === '010000') warnings.push('Tento ukazatel je kategoriální kód. Číslo označuje druh obce, nikoliv její velikost; význam kódů najdete v metodice.');
    warning('compare-warning', warnings);
    compareTable?.destroy();
    compareTable = makeTable($('compare-table'), [
      { title: 'Obec', field: 'name', minWidth: 180, widthGrow: 2, formatter: cell => `<span class="table-color" style="background:${cell.getRow().getData().color}"></span>${esc(cell.getRow().getData().displayName)}` },
      { title: 'Okres', field: 'district', minWidth: 110 },
      { title: esc(unit), field: 'value', hozAlign: 'right', minWidth: 140, formatter: valueFormatter, sorter: numberSorter },
    ], compareRows, state.places.length > 12 ? { height: 480 } : {});
    renderMethod('compare-method');
  }
  async function loadHistory() {
    if (!state.places.length) { toast('Nejdříve vyberte alespoň jednu obec.'); return; }
    state.from = Number($('history-from').value); state.to = Number($('history-to').value);
    if (state.from > state.to) { toast('Počáteční rok musí být menší nebo stejný jako koncový.'); return; }
    const years = Array.from({ length: state.to - state.from + 1 }, (_, index) => state.from + index);
    await runOperation('Načítám časovou řadu', async () => {
      taskTotal = years.length;
      for (let index = 0; index < years.length; index++) { taskIndex = index; await getYear(years[index]); }
      historyYears = years;
      renderHistory(); saveHash();
    }, { tasks: CsuTransfers.plan(years, cacheEntries) });
  }
  function requestedHistoryYears() {
    return Array.from({ length: Math.max(0, state.to - state.from + 1) }, (_, index) => state.from + index);
  }
  function historyCoverage() {
    const years = requestedHistoryYears();
    const pending = years.filter(year => !validSlice(year));
    const uncached = pending.filter(year => !cacheEntries.some(entry => entry.year === year));
    $('history-load-hint').textContent = pending.length ? `${yearCount(years.length)} v období · ${uncached.length} ke stažení, ostatní v místní paměti. Každý nový soubor má desítky MB.` : 'Všechny roky tohoto období jsou připravené pro vybrané obce.';
    return { years, pending };
  }
  function renderHistory() {
    renderIndicatorOptions('history');
    normalizationControls();
    const { years, pending } = historyCoverage();
    historyYears = years;
    const item = indicators.get(state.indicator);
    const unit = unitLabel(state.indicator, state.mode);
    $('history-title').textContent = item.nazev;
    $('history-subtitle').textContent = `${state.from}–${state.to} · ${unit}`;
    let baseYear = null;
    if (state.mode === 'index') baseYear = years.find(year => {
      const slice = validSlice(year);
      return state.places.every(code => { const value = rawValue(slice, state.indicator, code); return numeric(value) && value !== 0; });
    });
    const baseSlice = validSlice(baseYear);
    historyRows = years.map(year => {
      const slice = validSlice(year);
      const row = { year, loaded: !!slice };
      for (const code of state.places) {
        let value = transformedValue(slice, state.indicator, code, state.mode);
        if (state.mode === 'index') {
          const base = rawValue(baseSlice, state.indicator, code);
          value = !numeric(value) ? value : baseYear != null && numeric(base) && base !== 0 ? value / base * 100 : null;
        }
        row[`v${code}`] = value;
      }
      return row;
    });
    historyChart ||= echarts.init($('history-chart'), null, { renderer: 'svg' });
    const option = chartBase();
    option.grid = { left: 12, right: 20, top: 52, bottom: years.length > 10 ? 55 : 15, containLabel: true };
    option.legend = { type: 'scroll', top: 0, textStyle: { color: '#648067', fontSize: 10 } };
    option.xAxis = { ...option.xAxis, type: 'category', boundaryGap: false, data: years };
    option.yAxis = { ...option.yAxis, type: 'value', scale: true };
    const limit = $('history-series-limit').value;
    const plotted = state.places.length > 20 && limit !== 'all' ? state.places.slice(0, Number(limit)) : state.places;
    $('history-series-control').classList.toggle('hidden', state.places.length <= 20);
    $('history-series-hint').classList.toggle('hidden', state.places.length <= 20);
    $('history-series-hint').textContent = `Graf zobrazuje ${placeCount(plotted.length)} z ${state.places.length}. Tabulka a CSV obsahují všechny vybrané obce. Rozsah grafu můžete změnit výše.`;
    if (plotted.length < state.places.length) $('history-subtitle').textContent += ` · v grafu ${plotted.length}/${state.places.length} obcí`;
    option.series = plotted.map((code, index) => ({ name: qualifiedPlace(code), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 6, smooth: false, lineStyle: { width: 2.5 }, itemStyle: { color: placeColor(index) }, data: historyRows.map(row => numeric(row[`v${code}`]) ? row[`v${code}`] : null) }));
    if (years.length > 10) option.dataZoom = [{ type: 'slider', height: 16, bottom: 0, borderColor: '#e3e9de', fillerColor: '#176b5720' }, { type: 'inside' }];
    const hasNumbers = historyRows.some(row => plotted.some(code => numeric(row[`v${code}`])));
    option.graphic = hasNumbers ? [] : [{ type: 'text', left: 'center', top: 'middle', style: { text: pending.length ? 'Vyberte období a klikněte na „Načíst období“.' : 'Pro tento ukazatel nejsou v období dostupné číselné údaje.', fill: '#8b9b86', fontSize: 12 } }];
    historyChart.setOption(option, true);
    const warnings = [];
    if (pending.length) warnings.push(`Chybí ${pending.length} ${pending.length === 1 ? 'rok' : 'roků'} pro aktuální výběr. Načtěte období; mezery v grafu představují i dosud nenačtená data.`);
    if (state.mode === 'index') warnings.push(baseYear != null ? `Základ indexu: rok ${baseYear} = 100 pro všechny vybrané obce.${pending.length ? ' Základ se může změnit po načtení chybějících let.' : ''}` : 'Index nelze spočítat: nebyl nalezen společný rok s dostupnou nenulovou hodnotou.');
    if (state.mode === 'per1000') warnings.push('Přepočet používá obyvatelstvo k 31. 12. každého roku.');
    warnings.push('Chybějící a chráněné údaje nejsou spojovány čarou. Území obcí a metodika se mohou v čase měnit.');
    if (state.places.some(code => years.some(year => !validArea(code, year)))) warnings.push('Některá z obcí nemá v části období platný záznam v číselníku území.');
    if (state.indicator === '010000') warnings.push('Jde o kategoriální kód druhu obce; spojnice nevyjadřuje růst ani pokles velikosti.');
    warning('history-warning', warnings);
    historyTable?.destroy();
    historyTable = makeTable($('history-table'), [{ title: 'Rok', field: 'year', width: 80, frozen: true }, ...state.places.map((code, index) => ({ title: esc(displayPlace(code)), field: `v${code}`, minWidth: 140, hozAlign: 'right', formatter: valueFormatter, sorter: numberSorter, titleFormatter: () => `<span class="table-color" style="background:${placeColor(index)}"></span>${esc(displayPlace(code))}` })), { title: 'Stav', field: 'loaded', width: 110, formatter: cell => cell.getValue() ? 'Načteno' : '<span class="data-missing">Nenačteno</span>', headerSort: false }], historyRows, { maxHeight: 400 });
    renderMethod('history-method');
  }
  function updateView() {
    for (const button of document.querySelectorAll('[data-view]')) {
      const selected = button.dataset.view === state.view;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected);
      button.tabIndex = selected ? 0 : -1;
    }
    for (const id of ['overview', 'compare', 'history']) $(`view-${id}`).classList.toggle('hidden', id !== state.view);
  }
  function switchView(view) {
    state.view = view; updateView(); saveHash();
    if (activeSlice) {
      if (view === 'compare') renderCompare();
      else if (view === 'history') renderHistory();
      else requestAnimationFrame(() => overviewTable?.redraw(true));
    }
  }
  function renderData() {
    const version = ++renderVersion;
    const visible = !!activeSlice && !!state.places.length && signature(activeSlice.codes) === signature() && activeSlice.year === state.year;
    $('data-content').classList.toggle('hidden', !visible);
    $('empty-state').classList.toggle('hidden', visible);
    if (!visible) return;
    updateView();
    // Build visible tables after layout is committed; hidden charts are built on activation.
    requestAnimationFrame(() => {
      if (version !== renderVersion) return;
      renderOverview();
      if (state.view === 'compare') renderCompare();
      if (state.view === 'history') renderHistory();
      renderSelection();
    });
  }
  function saveDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function exportCSV(rows, filename) {
    if (!rows.length) { toast('Nejdříve načtěte data.'); return; }
    const csv = Papa.unparse(rows, { delimiter: ';', newline: '\r\n', escapeFormulae: true });
    saveDownload(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), filename);
    toast('Export CSV je připravený ke stažení.');
  }
  function exportOverview() {
    if (!overviewTable) return;
    const rows = overviewTable.getData('active').map(row => {
      const result = { Rok: state.year, 'Kód ukazatele': row.code, Ukazatel: row.name, Okruh: row.topic, Jednotka: row.unit };
      state.places.forEach(code => { result[qualifiedPlace(code)] = rawValue(activeSlice, row.code, code) ?? ''; });
      result.Zdroj = 'ČSÚ – databáze MOS';
      return result;
    });
    exportCSV(rows, `csustats-prehled-${state.year}.csv`);
  }
  function exportCompare() {
    exportCSV(compareRows.map(row => ({ Rok: state.year, 'Kód obce': row.code, Obec: row.name, Okres: row.district, 'Kód ukazatele': state.indicator, Ukazatel: indicators.get(state.indicator).nazev, Hodnota: row.value ?? '', Jednotka: unitLabel(state.indicator, state.normalize), 'Původní hodnota': row.original ?? '', Zdroj: 'ČSÚ – databáze MOS' })), `csustats-porovnani-${state.year}-${state.indicator}.csv`);
  }
  function exportHistory() {
    const rows = [];
    for (const row of historyRows) for (const code of state.places) rows.push({ Rok: row.year, 'Kód obce': code, Obec: placeLabel(code, row.year), 'Kód ukazatele': state.indicator, Ukazatel: indicators.get(state.indicator).nazev, Hodnota: row[`v${code}`] ?? '', Jednotka: unitLabel(state.indicator, state.mode), Stav: row.loaded ? 'Načteno' : 'Nenačteno', Zdroj: 'ČSÚ – databáze MOS' });
    exportCSV(rows, `csustats-vyvoj-${state.from}-${state.to}-${state.indicator}.csv`);
  }
  async function downloadChart(chart, filename, title, subtitle) {
    if (!chart) return;
    try {
      // Include the context in the exported image, not only the plot.
      const svg = chart.renderToSVGString();
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
        const width = chart.getWidth(); const height = chart.getHeight();
        const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = (height + 104) * 2;
        const context = canvas.getContext('2d'); context.scale(2, 2); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height + 104);
        context.fillStyle = '#243c2f'; context.font = '600 16px Segoe UI, Arial'; context.fillText(title, 18, 28, width - 36);
        context.fillStyle = '#75866c'; context.font = '11px Segoe UI, Arial'; context.fillText(subtitle, 18, 50, width - 36);
        context.drawImage(image, 0, 65, width, height);
        context.fillText('Zdroj: ČSÚ · databáze MOS | CsuStats', 18, height + 91);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Export obrázku není dostupný.');
        saveDownload(blob, filename); toast('Graf je připravený ke stažení.');
      } finally { URL.revokeObjectURL(url); }
    } catch { toast('Graf se nepodařilo exportovat. Zkuste export tabulky do CSV.'); }
  }
  function updateYearSelection() {
    const years = [...selectedYears];
    const saved = new Set(cacheEntries.map(entry => entry.year));
    const cached = years.filter(year => saved.has(year)).length;
    const fresh = years.length - cached;
    $('years-selection-count').textContent = `Vybráno: ${yearCount(years.length)}`;
    $('years-selection-detail').textContent = `${cached} již stažených · ${fresh} ke stažení${fresh ? ' (desítky MB za rok)' : ' · bez dalšího stahování'}`;
    $('download-years').disabled = !years.length;
    $('download-years-label').textContent = fresh ? `Stáhnout ${yearCount(fresh)} a pokračovat` : 'Použít vybrané roky';
    for (const checkbox of $('storage-list').querySelectorAll('[data-pick-year]')) {
      checkbox.checked = selectedYears.has(Number(checkbox.dataset.pickYear));
      checkbox.closest('.year-option').classList.toggle('selected', checkbox.checked);
    }
  }
  async function renderStorage() {
    await updateCacheSummary();
    const entries = new Map(cacheEntries.map(entry => [entry.year, entry]));
    const cards = [];
    for (let year = latest; year >= 2000; year--) {
      const entry = entries.get(year);
      cards.push(`<div class="year-option${entry ? ' saved' : ''}${selectedYears.has(year) ? ' selected' : ''}"><label for="pick-year-${year}"><input id="pick-year-${year}" data-pick-year="${year}" type="checkbox" ${selectedYears.has(year) ? 'checked' : ''}><span class="year-option-content"><strong>${year}${year === latest ? '<small>nejnovější</small>' : ''}</strong><span class="year-status-badge">${entry ? '✓ Uloženo' : 'Ke stažení'}</span><span class="year-option-size">${entry ? `${mb(entry.size)} · ${date(entry.savedAt)}` : 'Načíst z ČSÚ'}</span></span></label>${entry ? `<button class="year-delete" data-delete-year="${year}" aria-label="Odstranit uložený rok ${year}" title="Odstranit uložený rok ${year}">×</button>` : ''}</div>`);
    }
    $('storage-list').innerHTML = cards.join('');
    $('storage-total').textContent = `V tomto prohlížeči: ${yearCount(cacheEntries.length)} · ${mb(cacheEntries.reduce((sum, item) => sum + item.size, 0))}${db ? '' : ' · pouze dočasná paměť stránky'}`;
    $('clear-cache').disabled = !cacheEntries.length;
    updateYearSelection();
  }
  async function openYearPicker(startup = false) {
    if (!catalogReady || busy) return;
    if (startup || !selectedYears.size) selectedYears = new Set([...cacheEntries.map(entry => entry.year), state.year]);
    startupPending = startup;
    $('skip-years').textContent = startup ? 'Teď přeskočit' : 'Zavřít';
    await renderStorage();
    if (!$('storage-dialog').open) $('storage-dialog').showModal();
  }
  async function finishStartup() {
    if (!startupPending) return;
    startupPending = false;
    if (state.places.length && cacheEntries.some(entry => entry.year === state.year)) await loadCurrentYear();
  }
  async function prepareSelectedYears() {
    if (busy || !selectedYears.size) return;
    const years = [...selectedYears].sort((a, b) => b - a);
    const saved = new Set(cacheEntries.map(entry => entry.year));
    startupPending = false;
    $('storage-dialog').close();
    const result = await runOperation('Připravuji vybrané roky', async () => {
      for (const year of years) {
        checkAbort(); startYearTransfer(year);
        if (saved.has(year)) {
          transferStatus('cached', 'Již staženo · bez opakovaného přenosu');
          progress('Uložený soubor přeskakuji', 100);
        } else await getYear(year);
      }
      if (!selectedYears.has(state.year)) state.year = Math.max(...years);
      state.from = Math.min(...years); state.to = Math.max(...years);
      populateYears();
      activeSlice = state.places.length ? await getYear(state.year) : null;
      renderSelection(); renderData(); saveHash();
    }, { tasks: CsuTransfers.plan(years, cacheEntries), retain: true });
    if (result?.ok && !state.places.length) $('loading-help').textContent = 'Hotovo. Pokračujte k datům, vyberte jednu nebo více obcí a otevřete přehled roku. Již uložené soubory se znovu nestahují.';
  }
  async function removeYear(year) {
    await cacheRemove(`year-${year}`);
    slices.delete(year);
    if (workerYear === year) stopWorker();
    if (activeSlice?.year === year) { activeSlice = null; renderData(); }
    await updateCacheSummary(); await renderStorage(); renderSelection();
    if (state.view === 'history' && activeSlice) renderHistory();
  }
  function bindEvents() {
    document.querySelector('.skip-link').onclick = event => { event.preventDefault(); $('main').focus(); $('main').scrollIntoView(); };
    $('brand').onclick = event => { event.preventDefault(); switchView('overview'); };
    $('about-button').onclick = () => $('about-dialog').showModal();
    $('storage-button').onclick = () => openYearPicker();
    $('storage-mobile').onclick = $('storage-button').onclick;
    $('bulk-places').onclick = openBulkPicker;
    $('clear-places').onclick = () => { visiblePlaceLimit = 12; changePlaces([]); };
    $('more-places').onclick = () => { visiblePlaceLimit += 50; renderSelection(); };
    for (const input of document.querySelectorAll('[name="bulk-scope"]')) input.onchange = () => { bulkSelected.clear(); $('bulk-search').value = ''; renderBulkGroups(); };
    $('bulk-search').oninput = renderBulkGroups;
    $('bulk-options').onchange = event => {
      const input = event.target.closest('[data-bulk-group]');
      if (!input) return;
      if (input.checked) bulkSelected.add(input.dataset.bulkGroup); else bulkSelected.delete(input.dataset.bulkGroup);
      updateBulkSummary();
    };
    $('bulk-action').onchange = updateBulkSummary;
    $('bulk-select-visible').onclick = () => { for (const checkbox of $('bulk-options').querySelectorAll('[data-bulk-group]')) bulkSelected.add(checkbox.dataset.bulkGroup); renderBulkGroups(); };
    $('bulk-clear').onclick = () => { bulkSelected.clear(); renderBulkGroups(); };
    $('bulk-apply').onclick = () => {
      const next = CsuPlaces.merge(state.places, bulkIncoming(), $('bulk-action').value === 'replace');
      $('bulk-dialog').close();
      visiblePlaceLimit = 12;
      changePlaces(next);
    };
    $('skip-years').onclick = () => $('storage-dialog').close();
    $('storage-dialog').addEventListener('close', finishStartup);
    $('download-years').onclick = prepareSelectedYears;
    for (const button of document.querySelectorAll('[data-years-preset]')) button.onclick = () => {
      const preset = button.dataset.yearsPreset;
      selectedYears = new Set(preset === 'saved' ? cacheEntries.map(entry => entry.year) : preset === 'recent' ? Array.from({ length: Math.min(5, latest - 1999) }, (_, index) => latest - index) : preset === 'all' ? Array.from({ length: latest - 1999 }, (_, index) => latest - index) : []);
      updateYearSelection();
    };
    $('storage-list').onchange = event => {
      const input = event.target.closest('[data-pick-year]');
      if (!input) return;
      const year = Number(input.dataset.pickYear);
      if (input.checked) selectedYears.add(year); else selectedYears.delete(year);
      updateYearSelection();
    };
    for (const button of document.querySelectorAll('.close-dialog')) button.onclick = () => button.closest('dialog').close();
    for (const dialog of document.querySelectorAll('dialog:not(#loading-dialog)')) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    $('cancel-loading').onclick = cancelOperation;
    $('loading-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelOperation(); });
    $('start-button').onclick = () => { $('place-search').focus(); $('place-search').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $('place-search').addEventListener('input', renderSearch);
    $('place-search').addEventListener('focus', renderSearch);
    $('place-search').addEventListener('keydown', event => {
      if (event.key === 'Escape') { $('place-results').classList.add('hidden'); $('place-search').setAttribute('aria-expanded', 'false'); }
      if (event.key === 'ArrowDown') { event.preventDefault(); $('place-results').querySelector('button')?.focus(); }
      if (event.key === 'Enter') { event.preventDefault(); $('place-results').querySelector('button')?.click(); }
    });
    $('place-results').addEventListener('keydown', event => {
      const buttons = [...$('place-results').querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); buttons[Math.min(buttons.length - 1, index + 1)]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) $('place-search').focus(); else buttons[index - 1]?.focus(); }
      if (event.key === 'Escape') { $('place-search').focus(); $('place-results').classList.add('hidden'); $('place-search').setAttribute('aria-expanded', 'false'); }
    });
    $('district-filter').onchange = renderSearch;
    $('place-results').onclick = event => { const button = event.target.closest('[data-code]'); if (button) changePlaces([...state.places, button.dataset.code]); };
    $('selected-places').onclick = event => { const button = event.target.closest('[data-remove]'); if (button) changePlaces(state.places.filter(code => code !== button.dataset.remove)); };
    $('year-select').onchange = () => {
      state.year = Number($('year-select').value);
      activeSlice = validSlice(state.year);
      renderSelection(); renderSearch(); renderData(); saveHash();
    };
    $('load-year').onclick = () => loadCurrentYear();
    $('refresh-year').onclick = () => loadCurrentYear(true);
    for (const button of document.querySelectorAll('[data-view]')) {
      button.onclick = () => switchView(button.dataset.view);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...document.querySelectorAll('[data-view]')];
        const index = buttons.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
      };
    }
    $('indicator-search').oninput = filterOverview;
    $('topic-filter').onchange = filterOverview;
    $('available-only').onchange = filterOverview;
    for (const view of ['compare', 'history']) {
      $(`${view}-indicator-search`).oninput = () => renderIndicatorOptions(view);
      $(`${view}-show-empty`).onchange = () => renderIndicatorOptions(view);
    }
    $('compare-indicator').onchange = () => selectIndicator($('compare-indicator').value);
    $('history-indicator').onchange = () => selectIndicator($('history-indicator').value);
    $('compare-normalize').onchange = () => { state.normalize = $('compare-normalize').value; saveHash(); renderCompare(); };
    $('history-mode').onchange = () => { state.mode = $('history-mode').value; saveHash(); renderHistory(); };
    $('history-series-limit').onchange = renderHistory;
    $('history-from').onchange = $('history-to').onchange = () => { state.from = Number($('history-from').value); state.to = Number($('history-to').value); saveHash(); if (state.view === 'history' && activeSlice) renderHistory(); };
    $('load-history').onclick = loadHistory;
    $('export-overview').onclick = exportOverview;
    $('export-compare').onclick = exportCompare;
    $('export-history').onclick = exportHistory;
    $('download-compare').onclick = () => downloadChart(compareChart, `csustats-${state.year}-${state.indicator}.png`, $('compare-title').textContent, $('compare-subtitle').textContent);
    $('download-history').onclick = () => downloadChart(historyChart, `csustats-${state.from}-${state.to}-${state.indicator}.png`, $('history-title').textContent, $('history-subtitle').textContent);
    $('share-button').onclick = async () => {
      saveHash();
      try { await navigator.clipboard.writeText(location.href); toast(location.protocol === 'file:' ? 'Adresa zkopírována. Příjemce potřebuje vlastní kopii HTML; přeneste část adresy od #.' : 'Odkaz s aktuálním výběrem zkopírován.'); }
      catch { toast('Zkopírujte adresu stránky z adresního řádku; obsahuje váš výběr.'); }
    };
    $('storage-list').onclick = async event => { const button = event.target.closest('[data-delete-year]'); if (button) await removeYear(Number(button.dataset.deleteYear)); };
    $('clear-cache').onclick = async () => {
      for (const entry of await getCacheEntries()) await cacheRemove(entry.key);
      slices.clear(); activeSlice = null; stopWorker();
      await updateCacheSummary(); await renderStorage(); renderData(); renderSelection(); toast('Stažené roky byly odstraněny. Číselníky a výběr obcí zůstávají.');
    };
    window.addEventListener('resize', () => { compareChart?.resize(); historyChart?.resize(); });
    window.addEventListener('hashchange', () => {
      if (busy) return;
      readHash();
      state.places = state.places.filter(code => territories.has(code));
      if (!indicators.has(state.indicator)) state.indicator = POPULATION;
      populateYears(); populateIndicators(); renderSelection(); updateView();
      activeSlice = validSlice(state.year); renderData();
      if (!activeSlice && state.places.length) loadCurrentYear();
    });
  }
  readHash(); populateYears(); bindEvents(); updateView();
  initializeCatalog();
})();
