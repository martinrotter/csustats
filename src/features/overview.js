import { CsuCoverage } from '../core/coverage.js';
import { Tabulator } from '../lib/browser-libraries.js';

export function createOverview(app) {
  function valueFormatter(cell) {
    return app.valueHTML(cell.getValue());
  }
  function valueHTML(value) {
    return value === 'i.d.'
      ? '<span class="data-protected" title="Individuální důvěrný údaj">i.d.</span>'
      : value == null
        ? '<span class="data-missing" title="Údaj není k dispozici">—</span>'
        : app.esc(app.fmt(value));
  }
  function nameFormatter(cell) {
    const item = cell.getRow().getData();
    const coverage = item.coverage;
    const kind = !coverage.count
      ? 'none'
      : coverage.sparse
        ? 'sparse'
        : coverage.count < coverage.total
          ? 'partial'
          : 'complete';
    return `<div class="indicator-content"><span class="indicator-name">${app.esc(item.name)}</span><span class="indicator-meta"><span class="indicator-topic">${app.esc(item.topic)}</span><span class="indicator-code">${item.code}</span><span class="coverage-badge ${kind}" title="Číselné údaje pro ${coverage.count} z ${coverage.total} vybraných obcí">${coverage.sparse ? '⚠ ' : ''}${coverage.count}/${coverage.total} obcí</span></span></div><span class="indicator-open" aria-hidden="true">↗</span>`;
  }
  function numberSorter(a, b) {
    const aNum = app.numeric(a),
      bNum = app.numeric(b);
    return aNum && bNum
      ? a - b
      : aNum
        ? -1
        : bNum
          ? 1
          : String(a ?? '').localeCompare(String(b ?? ''));
  }
  function makeTable(element, columns, rows, extra = {}) {
    return new Tabulator(element, {
      data: rows,
      columns,
      layout: 'fitColumns',
      columnDefaults: {
        vertAlign: 'middle',
        headerWordWrap: true,
        resizable: true,
      },
      placeholder: 'Pro tento výběr nejsou dostupné údaje.',
      renderVertical: 'virtual',
      renderHorizontal: 'virtual',
      headerSortElement: '<span style="font-size:9px;color:#a2ae9d">↕</span>',
      ...extra,
    });
  }
  function renderCards() {
    const first = app.state.places[0];
    const definitions = [
      {
        code: app.POPULATION,
        label: 'Obyvatelé',
        unit: 'obyvatel',
      },
      {
        code: '113000',
        label: 'Průměrný věk',
        unit: 'let',
      },
      {
        code: '010300',
        label: 'Rozloha',
        unit: 'ha',
      },
      {
        code: '121800',
        label: 'Dokončené byty',
        unit: 'bytů',
      },
    ];
    app.$('stat-cards').innerHTML = definitions
      .map(
        (item) =>
          `<div class="stat-card"><div class="stat-card-label">${item.label} <span class="muted">· ${item.unit}</span></div><strong>${app.fmt(app.rawValue(app.activeSlice, item.code, first))}</strong><small><b>${app.esc(app.placeLabel(first))}</b> · ${app.state.year}</small><div class="mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>`,
      )
      .join('');
  }
  function filterOverview() {
    if (!app.overviewTable) return;
    const query = app.fold(app.$('indicator-search').value.trim());
    const topic = app.$('topic-filter').value;
    const available = app.$('available-only').checked;
    app.overviewTable.setFilter(
      (row) =>
        (!query || app.fold(`${row.name} ${row.code} ${row.topic} ${row.unit}`).includes(query)) &&
        (!topic || row.topicCode === topic) &&
        (!available || row.coverage.count > 0),
    );
    app.$('row-count').textContent =
      `${app.overviewTable.getDataCount('active')} ukazatelů · ${app.placeCount(app.state.places.length)}`;
  }
  function renderOverview() {
    app.renderCards();
    const empty = new Array(app.state.places.length).fill(null);
    app.overviewRows = [...app.indicators.values()].map((item) => {
      const row = {
        code: item.kodukaz,
        name: item.nazev,
        topic: app.topics.get(item.okruh) || '',
        topicCode: item.okruh,
        unit: item.mj || '—',
      };
      row.coverage = CsuCoverage.summarize(app.activeSlice.values[item.kodukaz] || empty);
      return row;
    });
    const columns = [
      {
        title: 'Ukazatel / tematický okruh',
        field: 'name',
        cssClass: 'indicator-cell',
        formatter: app.nameFormatter,
        minWidth: 300,
        widthGrow: 3,
        variableHeight: true,
        frozen: window.innerWidth > 650,
        tooltip: false,
      },
      {
        title: 'Jednotka',
        field: 'unit',
        width: 92,
        headerSort: false,
        cssClass: 'unit-cell',
      },
      ...app.state.places.map((code, index) => ({
        title: app.esc(app.displayPlace(code)),
        field: `v${code}`,
        minWidth: 125,
        widthGrow: 1,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: (cell) =>
          app.valueHTML(app.rawValue(app.activeSlice, cell.getRow().getData().code, code)),
        sorter: (_, __, a, b) =>
          app.numberSorter(
            app.rawValue(app.activeSlice, a.getData().code, code),
            app.rawValue(app.activeSlice, b.getData().code, code),
          ),
        titleFormatter: () =>
          `<span class="table-color" style="background:${app.placeColor(index)}"></span>${app.esc(app.displayPlace(code))}`,
        headerTooltip: app.qualifiedPlace(code),
      })),
    ];
    app.overviewTable?.destroy();
    app.overviewTable = app.makeTable(app.$('overview-table'), columns, app.overviewRows, {
      height: 555,
      index: 'code',
    });
    app.overviewTable.on('tableBuilt', app.filterOverview);
    app.overviewTable.on('rowClick', (_, row) => {
      app.selectIndicator(row.getData().code);
      app.switchView('compare');
    });
    app.overviewTable.on('renderComplete', () => {
      for (const row of app.overviewTable.getRows('visible')) {
        row.getElement().tabIndex = 0;
        row
          .getElement()
          .setAttribute('aria-label', `${row.getData().name}. Enter: zobrazit porovnání.`);
        row.getElement().onkeydown = (event) => {
          if (event.key === 'Enter') {
            app.selectIndicator(row.getData().code);
            app.switchView('compare');
          }
        };
      }
    });
  }
  return {
    valueFormatter,
    valueHTML,
    nameFormatter,
    numberSorter,
    makeTable,
    renderCards,
    filterOverview,
    renderOverview,
  };
}
