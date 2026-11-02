export function createNavigation(app) {
  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const year = Number(params.get('year'));
    if (Number.isInteger(year) && year >= 2000 && year <= new Date().getFullYear())
      app.state.year = year;
    app.state.places = [
      ...new Set((params.get('places') || '').split(',').filter((code) => /^\d{6}$/.test(code))),
    ];
    if (/^\d{6}$/.test(params.get('indicator') || ''))
      app.state.indicator = params.get('indicator');
    if (['overview', 'compare', 'history'].includes(params.get('view')))
      app.state.view = params.get('view');
    for (const key of ['from', 'to']) {
      const value = Number(params.get(key));
      if (Number.isInteger(value) && value >= 2000 && value <= new Date().getFullYear())
        app.state[key] = value;
    }
    if (['absolute', 'per1000', 'index'].includes(params.get('mode')))
      app.state.mode = params.get('mode');
    if (['absolute', 'per1000'].includes(params.get('normalize')))
      app.state.normalize = params.get('normalize');
  }
  function saveHash() {
    const params = new URLSearchParams({
      year: app.state.year,
      places: app.signature(),
      indicator: app.state.indicator,
      view: app.state.view,
      from: app.state.from,
      to: app.state.to,
      mode: app.state.mode,
      normalize: app.state.normalize,
    });
    try {
      history.replaceState(null, '', `#${params}`);
    } catch {
      /* Some file-origin browsers restrict history writes; functionality is unaffected. */
    }
  }
  function populateYears() {
    const options = [];
    for (let year = app.latest; year >= 2000; year--)
      options.push(`<option value="${year}">${year}</option>`);
    for (const id of ['year-select', 'history-from', 'history-to'])
      app.$(id).innerHTML = options.join('');
    app.state.year = Math.min(app.latest, Math.max(2000, app.state.year));
    app.state.from = Math.min(app.latest, Math.max(2000, app.state.from));
    app.state.to = Math.min(app.latest, Math.max(app.state.from, app.state.to));
    app.$('year-select').value = app.state.year;
    app.$('history-from').value = app.state.from;
    app.$('history-to').value = app.state.to;
  }
  function updateView() {
    for (const button of document.querySelectorAll('[data-view]')) {
      const selected = button.dataset.view === app.state.view;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected);
      button.tabIndex = selected ? 0 : -1;
    }
    for (const id of ['overview', 'compare', 'history'])
      app.$(`view-${id}`).classList.toggle('hidden', id !== app.state.view);
  }
  function switchView(view) {
    app.state.view = view;
    app.updateView();
    app.saveHash();
    if (app.activeSlice) {
      if (view === 'compare') app.renderCompare();
      else if (view === 'history') app.renderHistory();
      else requestAnimationFrame(() => app.overviewTable?.redraw(true));
    }
  }
  function renderData() {
    const version = ++app.renderVersion;
    const visible =
      !!app.activeSlice &&
      !!app.state.places.length &&
      app.signature(app.activeSlice.codes) === app.signature() &&
      app.activeSlice.year === app.state.year;
    app.$('data-content').classList.toggle('hidden', !visible);
    app.$('empty-state').classList.toggle('hidden', visible);
    if (!visible) return;
    app.updateView();
    // Build visible tables after layout is committed; hidden charts are built on activation.
    requestAnimationFrame(() => {
      if (version !== app.renderVersion) return;
      app.renderOverview();
      if (app.state.view === 'compare') app.renderCompare();
      if (app.state.view === 'history') app.renderHistory();
      app.renderSelection();
    });
  }
  return { readHash, saveHash, populateYears, updateView, switchView, renderData };
}
