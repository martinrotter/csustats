import { CsuPlaces } from '../core/places.js';

export function createPlaces(app) {
  function renderSearch() {
    if (!app.catalogReady) return;
    const query = app.fold(app.$('place-search').value.trim());
    const district = app.$('district-filter').value;
    if (!query && !district) {
      app.$('place-results').classList.add('hidden');
      app.$('place-search').setAttribute('aria-expanded', 'false');
      return;
    }
    const results = [];
    for (const code of app.territories.keys()) {
      if (app.state.places.includes(code) || !app.validArea(code, app.state.year)) continue;
      const item = app.area(code);
      if (district && item.okres !== district) continue;
      if (query && !app.fold(`${item.obec} ${code}`).includes(query)) continue;
      results.push({
        code,
        ...item,
      });
    }
    results.sort((a, b) => {
      const aExact = app.fold(a.obec).startsWith(query) ? 0 : 1;
      const bExact = app.fold(b.obec).startsWith(query) ? 0 : 1;
      return (
        aExact - bExact ||
        a.obec.localeCompare(b.obec, 'cs') ||
        a.okres.localeCompare(b.okres, 'cs')
      );
    });
    app.$('place-results').innerHTML = results.length
      ? results
          .slice(0, 35)
          .map(
            (item) =>
              `<button class="place-result" data-code="${item.code}"><b>${app.esc(item.obec)} <span class="muted">+</span></b><small>okres ${app.esc(item.okres)} · ${item.code}</small></button>`,
          )
          .join('') +
        (results.length > 35
          ? '<p class="no-results">Zobrazeno prvních 35 výsledků. Upřesněte hledání.</p>'
          : '')
      : '<p class="no-results">Žádná další obec neodpovídá hledání pro tento rok.</p>';
    app.$('place-results').classList.remove('hidden');
    app.$('place-search').setAttribute('aria-expanded', 'true');
  }
  function renderBulkGroups() {
    const scope = document.querySelector('[name="bulk-scope"]:checked').value;
    app.bulkGroups = new Map();
    for (const code of app.territories.keys()) {
      if (!app.validArea(code, app.state.year)) continue;
      const record = app.area(code);
      const name =
        scope === 'district'
          ? record.okres
          : app.regionCatalog.districts[record.okres] || 'Nezařazeno';
      if (!app.bulkGroups.has(name)) app.bulkGroups.set(name, []);
      app.bulkGroups.get(name).push(code);
    }
    const query = app.fold(app.$('bulk-search').value.trim());
    const existing = new Set(app.state.places);
    const groups = [...app.bulkGroups]
      .filter(([name]) => !query || app.fold(name).includes(query))
      .sort(([a], [b]) => a.localeCompare(b, 'cs'));
    app.$('bulk-options').innerHTML =
      groups
        .map(
          ([name, codes]) =>
            `<label class="bulk-option${app.bulkSelected.has(name) ? ' selected' : ''}"><input type="checkbox" data-bulk-group="${app.esc(name)}" ${app.bulkSelected.has(name) ? 'checked' : ''}><span><b>${app.esc(name)}</b><small>${app.placeCount(codes.length)} · ${codes.filter((code) => existing.has(code)).length} již ve výběru</small></span></label>`,
        )
        .join('') || '<p class="no-results">Žádný územní celek neodpovídá hledání.</p>';
    app.updateBulkSummary();
  }
  function bulkIncoming() {
    return [
      ...new Set([...app.bulkSelected].flatMap((name) => app.bulkGroups.get(name) || [])),
    ].sort(
      (a, b) => app.placeLabel(a).localeCompare(app.placeLabel(b), 'cs') || a.localeCompare(b),
    );
  }
  function updateBulkSummary() {
    const incoming = app.bulkIncoming();
    const replace = app.$('bulk-action').value === 'replace';
    const next = CsuPlaces.merge(app.state.places, incoming, replace);
    const existing = new Set(app.state.places);
    const added = incoming.filter((code) => !existing.has(code)).length;
    const groupCount = `${app.bulkSelected.size} ${app.bulkSelected.size === 1 ? 'celek' : app.bulkSelected.size >= 2 && app.bulkSelected.size <= 4 ? 'celky' : 'celků'}`;
    app.$('bulk-summary').textContent =
      `Vybráno ${groupCount} · ${app.placeCount(incoming.length)}${replace ? ` · nový výběr: ${app.placeCount(next.length)}` : ` · ${added} nových · celkem ${app.placeCount(next.length)}`}.`;
    app.$('bulk-apply').disabled = !incoming.length || (!replace && !added);
    app.$('bulk-apply').textContent = !incoming.length
      ? 'Vyberte územní celek'
      : !replace && !added
        ? 'Obce už jsou ve výběru'
        : replace
          ? `Nahradit výběr · ${app.placeCount(next.length)}`
          : `Přidat ${app.placeCount(added)}`;
    for (const checkbox of app.$('bulk-options').querySelectorAll('[data-bulk-group]'))
      checkbox.closest('.bulk-option').classList.toggle('selected', checkbox.checked);
  }
  function openBulkPicker() {
    app.bulkSelected = new Set();
    app.$('bulk-search').value = '';
    app.$('bulk-action').value = 'append';
    document.querySelector('[name="bulk-scope"][value="district"]').checked = true;
    if (app.$('district-filter').value) app.bulkSelected.add(app.$('district-filter').value);
    app.$('bulk-year-hint').textContent =
      `Vyberte jeden nebo více celků. Přidají se všechny jejich obce podle číselníku MOS pro rok ${app.state.year}; již vybrané se neduplikují.`;
    app.renderBulkGroups();
    app.$('bulk-dialog').showModal();
  }
  function renderSelection() {
    const names = new Map();
    for (const code of app.state.places) {
      const name = app.placeLabel(code);
      names.set(name, (names.get(name) || 0) + 1);
    }
    app.displayPlaceNames = new Map(
      app.state.places.map((code) => [
        code,
        names.get(app.placeLabel(code)) > 1
          ? `${app.placeLabel(code)} (${app.area(code).okres})`
          : app.placeLabel(code),
      ]),
    );
    app.$('selected-places').innerHTML = app.state.places
      .slice(0, app.visiblePlaceLimit)
      .map(
        (code, index) =>
          `<div class="place-chip"><span class="place-color" style="--place-color:${app.placeColor(index)}"></span><span class="place-chip-name">${app.esc(app.placeLabel(code))}<small>okres ${app.esc(app.area(code).okres)}${app.validArea(code, app.state.year) ? '' : ' · mimo platnost v tomto roce'}</small></span><button class="remove-place" data-remove="${code}" title="Odebrat ${app.esc(app.placeLabel(code))}" aria-label="Odebrat ${app.esc(app.placeLabel(code))}">×</button></div>`,
      )
      .join('');
    app.$('selection-toolbar').classList.toggle('hidden', !app.state.places.length);
    app.$('selection-count').textContent = `Vybráno ${app.placeCount(app.state.places.length)}`;
    app
      .$('more-places')
      .classList.toggle('hidden', app.state.places.length <= app.visiblePlaceLimit);
    app.$('more-places').textContent =
      `Zobrazit dalších ${Math.min(50, app.state.places.length - app.visiblePlaceLimit)} obcí`;
    app.$('selection-hint').textContent =
      app.state.places.length > app.visiblePlaceLimit
        ? `Zobrazeno ${app.visiblePlaceLimit} z ${app.state.places.length}. Tabulky zahrnují všechny vybrané obce.`
        : 'Obce lze přidávat jednotlivě nebo po územních celcích.';
    app.$('load-year').disabled = !app.catalogReady || !app.state.places.length;
    app.$('refresh-year').disabled = !app.activeSlice;
    app.$('year-display').textContent = app.state.year;
    app.$('year-status').textContent = app.validSlice(app.state.year)
      ? 'data připravena'
      : 'čeká na načtení';
    const summaryPlaces =
      app.state.places.length > 5 ? app.state.places.slice(0, 3) : app.state.places;
    app.$('active-summary').innerHTML = app.state.places.length
      ? summaryPlaces
          .map(
            (code, index) =>
              `<span class="summary-chip"><span class="place-color" style="--place-color:${app.placeColor(index)}"></span>${app.esc(app.placeLabel(code))}</span>`,
          )
          .join('<span class="summary-separator">/</span>') +
        (app.state.places.length > 5
          ? `<span class="summary-count">+ ${app.state.places.length - 3} dalších obcí</span>`
          : '') +
        `<span class="muted">· ${app.state.year}</span>`
      : '<span class="muted">Vyberte obec a načtěte roční data.</span>';
    app.updateYearHint();
  }
  function updateYearHint() {
    const entry = app.cacheEntries.find((item) => item.year === app.state.year);
    app.$('year-hint').textContent = entry
      ? `Uloženo v prohlížeči · ${app.mb(entry.size)} · ${app.date(entry.savedAt)}`
      : 'První načtení stáhne celý roční soubor (desítky MB).';
  }
  async function changePlaces(next) {
    if (app.busy) return;
    app.state.places = [...new Set(next)];
    app.activeSlice = null;
    app.$('place-search').value = '';
    app.$('place-results').classList.add('hidden');
    app.$('place-search').setAttribute('aria-expanded', 'false');
    app.renderSelection();
    app.saveHash();
    app.renderData();
    if (
      app.state.places.length &&
      (app.slices.has(app.state.year) ||
        app.cacheEntries.some((entry) => entry.year === app.state.year))
    )
      await app.loadCurrentYear();
  }
  return {
    renderSearch,
    renderBulkGroups,
    bulkIncoming,
    updateBulkSummary,
    openBulkPicker,
    renderSelection,
    updateYearHint,
    changePlaces,
  };
}
