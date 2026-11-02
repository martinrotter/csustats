import { CsuCoverage } from '../core/coverage.js';

export function createIndicators(app) {
  function populateIndicators() {
    app.renderIndicatorOptions('compare');
    app.renderIndicatorOptions('history');
    app.$('compare-normalize').value = app.state.normalize;
    app.$('history-mode').value = app.state.mode;
  }
  function indicatorAvailability(view) {
    const years = view === 'compare' ? [app.state.year] : app.requestedHistoryYears();
    const loaded = years.filter((year) => app.validSlice(year));
    const key = `${app.sliceRevision}|${app.signature()}|${years.join(',')}|${loaded.join(',')}`;
    if (app.availabilityCache.get(view)?.key === key) return app.availabilityCache.get(view);
    const pending = loaded.length < years.length;
    const coverage = new Map();
    const loadedSlices = loaded.map((year) => app.validSlice(year));
    const empty = new Array(app.state.places.length).fill(null);
    for (const code of app.indicators.keys()) {
      const values = [];
      let coveredYears = 0;
      for (const slice of loadedSlices) {
        const yearly = slice.values[code] || empty;
        if (yearly.some(app.numeric)) coveredYears++;
        values.push(...yearly);
      }
      const item = CsuCoverage.summarize(values);
      item.coveredYears = coveredYears;
      item.expected = years.length * app.state.places.length;
      if (!pending && years.length > 1 && coveredYears === 1 && item.count > 0) item.sparse = true;
      coverage.set(code, item);
    }
    const result = {
      key,
      coverage,
      pending,
      years,
      loaded,
    };
    app.availabilityCache.set(view, result);
    return result;
  }
  function renderIndicatorOptions(view) {
    const info = app.indicatorAvailability(view);
    const showEmpty = app.$(`${view}-show-empty`).checked;
    const query = app.fold(app.$(`${view}-indicator-search`).value.trim());
    const visible = [...app.indicators.values()].filter((item) => {
      const coverage = info.coverage.get(item.kodukaz);
      return (
        (showEmpty || info.pending || coverage.count > 0) &&
        (!query ||
          app
            .fold(`${item.nazev} ${item.kodukaz} ${app.topics.get(item.okruh) || ''}`)
            .includes(query))
      );
    });
    function option(item) {
      const coverage = info.coverage.get(item.kodukaz);
      const availability = !coverage.count
        ? info.pending
          ? 'dostupnost zatím neověřena'
          : 'bez číselných údajů'
        : view === 'compare'
          ? `${coverage.count}/${app.state.places.length} obcí`
          : `${coverage.count}/${coverage.expected} hodnot · ${coverage.coveredYears}/${info.years.length} let`;
      return `<option value="${item.kodukaz}">${app.esc(item.nazev)}${item.mj ? ` · ${app.esc(item.mj)}` : ''} [${item.kodukaz}] — ${coverage.sparse ? '⚠ málo dat · ' : ''}${availability}</option>`;
    }
    const selected = app.indicators.get(app.state.indicator);
    const keepSelected = selected && !visible.some((item) => item.kodukaz === app.state.indicator);
    const groups = [...app.topics]
      .map(([topic, name]) => {
        const items = visible.filter((item) => item.okruh === topic);
        return items.length
          ? `<optgroup label="${app.esc(name)} (${items.length})">${items.map(option).join('')}</optgroup>`
          : '';
      })
      .join('');
    app.$(`${view}-indicator`).innerHTML =
      (keepSelected
        ? `<optgroup label="Aktuálně vybraný ukazatel">${option(selected)}</optgroup>`
        : '') + groups;
    app.$(`${view}-indicator`).value = app.state.indicator;
    const limited = visible.filter((item) => info.coverage.get(item.kodukaz).sparse).length;
    const hidden =
      !info.pending && !showEmpty
        ? [...info.coverage.values()].filter((item) => !item.count).length
        : 0;
    const message = `Zobrazeno <b>${visible.length}${keepSelected ? ' + vybraný' : ''}</b> z ${app.indicators.size} ukazatelů${hidden ? ` · ${hidden} bez číselných údajů skryto` : ''}${limited ? ` · <span class="limited-count">${limited} s malým počtem údajů (⚠)</span>` : ''}.`;
    app.$(`${view}-availability`).innerHTML =
      `Pro vybrané obce${view === 'compare' ? ` v roce ${app.state.year}` : ` v období ${app.state.from}–${app.state.to}`}: ` +
      message +
      (view === 'history' && info.pending
        ? ` <b>Načteno ${info.loaded.length}/${info.years.length} let.</b> Zatím neověřené ukazatele zůstávají ve výběru do načtení celého období.`
        : '') +
      (keepSelected && !info.pending && !info.coverage.get(app.state.indicator)?.count
        ? ' Vybraný ukazatel nemá číselné údaje; je ponechán pro zobrazení jeho metodiky.'
        : '');
  }
  function selectIndicator(code) {
    if (!app.indicators.has(code)) return;
    app.state.indicator = code;
    if (!app.canNormalize(code)) {
      app.state.normalize = 'absolute';
      if (app.state.mode === 'per1000') app.state.mode = 'absolute';
    }
    app.$('compare-indicator').value = code;
    app.$('history-indicator').value = code;
    app.$('compare-normalize').value = app.state.normalize;
    app.$('history-mode').value = app.state.mode;
    app.saveHash();
    if (app.state.view === 'compare') app.renderCompare();
    if (app.state.view === 'history') app.renderHistory();
  }
  function normalizationControls() {
    const enabled = app.canNormalize(app.state.indicator);
    app.$('compare-normalize').querySelector('[value="per1000"]').disabled = !enabled;
    app.$('history-mode').querySelector('[value="per1000"]').disabled = !enabled;
    if (!enabled) {
      if (app.state.normalize === 'per1000') app.state.normalize = 'absolute';
      if (app.state.mode === 'per1000') app.state.mode = 'absolute';
      app.$('compare-normalize').value = app.state.normalize;
      app.$('history-mode').value = app.state.mode;
    }
  }
  function renderMethod(target) {
    const item = app.indicators.get(app.state.indicator);
    if (!item) {
      app.$(target).replaceChildren();
      return;
    }
    app.$(target).innerHTML =
      `<details><summary>Co přesně tento ukazatel znamená?</summary><p>${app.esc(item.metodika || 'Podrobnější metodika není v číselníku uvedena.').replace(/\r?\n/g, '<br>')}</p><div class="method-meta"><span><b>Zdroj:</b> ${app.esc(item.zdroj)}</span><span><b>Kód:</b> ${item.kodukaz}</span><span><b>Jednotka:</b> ${app.esc(item.mj || 'neuvedena')}</span><span><b>Platnost:</b> ${item.platiod}–${item.platido === '9999' ? 'dosud' : item.platido}</span></div><p class="tiny">Hodnoty vycházejí z územního vymezení v příslušném roce. U sčítání a jednorázových šetření může roční soubor obsahovat údaj ze staršího referenčního období uvedeného v názvu či metodice.</p></details>`;
  }
  return {
    populateIndicators,
    indicatorAvailability,
    renderIndicatorOptions,
    selectIndicator,
    normalizationControls,
    renderMethod,
  };
}
