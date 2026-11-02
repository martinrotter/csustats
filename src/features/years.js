import { CsuTransfers } from '../core/transfers.js';

export function createYears(app) {
  function updateYearSelection() {
    const years = [...app.selectedYears];
    const saved = new Set(app.cacheEntries.map((entry) => entry.year));
    const cached = years.filter((year) => saved.has(year)).length;
    const fresh = years.length - cached;
    app.$('years-selection-count').textContent = `Vybráno: ${app.yearCount(years.length)}`;
    app.$('years-selection-detail').textContent =
      `${cached} již stažených · ${fresh} ke stažení${fresh ? ' (desítky MB za rok)' : ' · bez dalšího stahování'}`;
    app.$('download-years').disabled = !years.length;
    app.$('download-years-label').textContent = fresh
      ? `Stáhnout ${app.yearCount(fresh)} a pokračovat`
      : 'Použít vybrané roky';
    for (const checkbox of app.$('storage-list').querySelectorAll('[data-pick-year]')) {
      checkbox.checked = app.selectedYears.has(Number(checkbox.dataset.pickYear));
      checkbox.closest('.year-option').classList.toggle('selected', checkbox.checked);
    }
  }
  async function renderStorage() {
    await app.updateCacheSummary();
    const entries = new Map(app.cacheEntries.map((entry) => [entry.year, entry]));
    const cards = [];
    for (let year = app.latest; year >= 2000; year--) {
      const entry = entries.get(year);
      cards.push(
        `<div class="year-option${entry ? ' saved' : ''}${app.selectedYears.has(year) ? ' selected' : ''}"><label for="pick-year-${year}"><input id="pick-year-${year}" data-pick-year="${year}" type="checkbox" ${app.selectedYears.has(year) ? 'checked' : ''}><span class="year-option-content"><strong>${year}${year === app.latest ? '<small>nejnovější</small>' : ''}</strong><span class="year-status-badge">${entry ? '✓ Uloženo' : 'Ke stažení'}</span><span class="year-option-size">${entry ? `${app.mb(entry.size)} · ${app.date(entry.savedAt)}` : 'Načíst z ČSÚ'}</span></span></label>${entry ? `<button class="year-delete" data-delete-year="${year}" aria-label="Odstranit uložený rok ${year}" title="Odstranit uložený rok ${year}">×</button>` : ''}</div>`,
      );
    }
    app.$('storage-list').innerHTML = cards.join('');
    app.$('storage-total').textContent =
      `V tomto prohlížeči: ${app.yearCount(app.cacheEntries.length)} · ${app.mb(app.cacheEntries.reduce((sum, item) => sum + item.size, 0))}${app.db ? '' : ' · pouze dočasná paměť stránky'}`;
    app.$('clear-cache').disabled = !app.cacheEntries.length;
    app.updateYearSelection();
  }
  async function openYearPicker(startup = false) {
    if (!app.catalogReady || app.busy) return;
    if (startup || !app.selectedYears.size)
      app.selectedYears = new Set([...app.cacheEntries.map((entry) => entry.year), app.state.year]);
    app.startupPending = startup;
    app.$('skip-years').textContent = startup ? 'Teď přeskočit' : 'Zavřít';
    await app.renderStorage();
    if (!app.$('storage-dialog').open) app.$('storage-dialog').showModal();
  }
  async function finishStartup() {
    if (!app.startupPending) return;
    app.startupPending = false;
    if (app.state.places.length && app.cacheEntries.some((entry) => entry.year === app.state.year))
      await app.loadCurrentYear();
  }
  async function prepareSelectedYears() {
    if (app.busy || !app.selectedYears.size) return;
    const years = [...app.selectedYears].sort((a, b) => b - a);
    const saved = new Set(app.cacheEntries.map((entry) => entry.year));
    app.startupPending = false;
    app.$('storage-dialog').close();
    const result = await app.runOperation(
      'Připravuji vybrané roky',
      async () => {
        for (const year of years) {
          app.checkAbort();
          app.startYearTransfer(year);
          if (saved.has(year)) {
            app.transferStatus('cached', 'Již staženo · bez opakovaného přenosu');
            app.progress('Uložený soubor přeskakuji', 100);
          } else await app.getYear(year);
        }
        if (!app.selectedYears.has(app.state.year)) app.state.year = Math.max(...years);
        app.state.from = Math.min(...years);
        app.state.to = Math.max(...years);
        app.populateYears();
        app.activeSlice = app.state.places.length ? await app.getYear(app.state.year) : null;
        app.renderSelection();
        app.renderData();
        app.saveHash();
      },
      {
        tasks: CsuTransfers.plan(years, app.cacheEntries),
        retain: true,
      },
    );
    if (result?.ok && !app.state.places.length)
      app.$('loading-help').textContent =
        'Hotovo. Pokračujte k datům, vyberte jednu nebo více obcí a otevřete přehled roku. Již uložené soubory se znovu nestahují.';
  }
  async function removeYear(year) {
    await app.cacheRemove(`year-${year}`);
    app.slices.delete(year);
    if (app.workerYear === year) app.stopWorker();
    if (app.activeSlice?.year === year) {
      app.activeSlice = null;
      app.renderData();
    }
    await app.updateCacheSummary();
    await app.renderStorage();
    app.renderSelection();
    if (app.state.view === 'history' && app.activeSlice) app.renderHistory();
  }
  return {
    updateYearSelection,
    renderStorage,
    openYearPicker,
    finishStartup,
    prepareSelectedYears,
    removeYear,
  };
}
