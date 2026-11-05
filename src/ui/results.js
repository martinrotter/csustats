import { t, getLocale, ht } from '../i18n/index.js';
import {
  chartProjection,
  coverage,
  observations,
  escapeHtml,
  formatNumber,
  textKey,
  ratioMeasures,
} from '../core/cube.js';
import { chartOptions, chartSubtitle } from './charts.js';
import { ChartItems } from './chart-items.js';
import {
  comparisonRows,
  markOutliers,
  outlierLabel,
  peerDescription,
  comparisonCsv,
} from '../core/analysis.js';
import { echarts, Tabulator, Papa } from '../lib/browser-libraries.js';

const option = (value, title) =>
  `<option value="${escapeHtml(value)}">${escapeHtml(title)}</option>`;
const filename = (value) =>
  textKey(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'narodni-data';
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export class Results {
  constructor(app) {
    this.app = app;
    this.rows = [];
    this.fixed = {};
    this.seriesIds = null;
    this.categoryIds = null;
    this.chartItems = new ChartItems(this);
    const { $ } = app;
    for (const id of [
      'chart-x',
      'chart-series',
      'chart-metric',
      'chart-type',
      'chart-transform',
      'chart-denominator',
      'chart-scale',
      'chart-sort',
      'chart-limit',
      'chart-labels',
      'chart-extremes',
      'chart-legend',
      'chart-series-order',
    ])
      $(id).addEventListener('change', () => {
        if (id === 'chart-series' || id === 'chart-x') {
          this.seriesIds = null;
          this.categoryIds = null;
        }
        this.renderFixed();
        this.refreshAnalysis();
        this.renderChart();
        if (!$('table-panel').hidden) this.renderTable();
        app.saveState();
      });
    for (const id of ['analysis-compare', 'table-summary'])
      $(id).addEventListener('change', () => {
        this.renderAnalysisControls();
        this.refreshAnalysis();
        this.renderChart();
        if (!$('table-panel').hidden) this.renderTable();
        app.saveState();
      });
    for (const id of ['table-outliers', 'table-metric-filter'])
      $(id).addEventListener('change', () => {
        this.filterTable();
        app.saveState();
      });
    $('analysis-chart-outliers').addEventListener('click', () =>
      this.rowsToChart(
        this.filteredRows().filter((row) => row._outlier),
        true,
      ),
    );
    $('chart-fixed').addEventListener('change', (event) => {
      this.fixed[event.target.dataset.fixed] = event.target.value;
      this.renderChart();
      app.saveState();
    });
    $('chart-settings-toggle').addEventListener('click', () => {
      const open = $('chart-settings').hidden;
      $('chart-settings').hidden = !open;
      $('chart-settings-toggle').setAttribute('aria-expanded', String(open));
    });
    $('reset-zoom').addEventListener('click', () =>
      this.chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }),
    );
    $('fullscreen-chart').addEventListener('click', async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.body.classList.contains('chart-expanded'))
        document.body.classList.remove('chart-expanded');
      else {
        try {
          await $('chart-panel').requestFullscreen();
        } catch {
          document.body.classList.add('chart-expanded');
        }
      }
      this.chart?.resize();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.body.classList.remove('chart-expanded');
        this.chart?.resize();
      }
    });
    for (const pane of ['chart', 'table'])
      $(`tab-${pane}`).addEventListener('click', () => this.showPane(pane));
    $('table-search').addEventListener('input', () => this.filterTable());
    $('table-missing').addEventListener('change', () => this.filterTable());
    $('export-csv').addEventListener('click', () => this.exportCsv());
    $('export-image').addEventListener('click', () => {
      if (this.projection?.categorical)
        return app.toast(t('Kategoriální kód se nezobrazuje jako číselný graf.'));
      $('image-dialog').showModal();
    });
    $('save-image').addEventListener('click', () =>
      this.exportImage().catch((error) => app.message(error.message, true)),
    );
    this.resizeObserver = new ResizeObserver(() => {
      const width = $('chart').clientWidth;
      if (this.chart && !app.$('chart-panel').hidden && width && width !== this.chartWidth) {
        this.chartWidth = width;
        this.currentOptions = chartOptions(this.projection, { ...this.chartContext, width });
        this.chart.setOption({ title: this.currentOptions.title, grid: this.currentOptions.grid });
      }
      this.chart?.resize();
      if (this.tableReady && !app.$('table-panel').hidden) this.table?.redraw();
    });
    this.resizeObserver.observe($('main'));
    this.resizeObserver.observe($('chart-panel'));
    for (const pane of ['chart', 'table'])
      $(`tab-${pane}`).addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 'chart'
              : event.key === 'End'
                ? 'table'
                : pane === 'chart'
                  ? 'table'
                  : 'chart';
          this.showPane(next);
          $(`tab-${next}`).focus();
        }
      });
  }
  clear() {
    this.tableReady = false;
    this.table?.destroy();
    this.table = null;
    this.chart?.dispose();
    this.chart = null;
    this.rows = [];
    this.app.$('workspace').hidden = true;
    this.app.$('welcome').hidden = false;
  }
  async accept(cube, savedChart = null) {
    const app = this.app,
      { $ } = app;
    const preparedRows = [];
    const preparedCoverage = coverage(cube);
    const metric = cube.dimensions.find((dim) => dim.role === 'metric');
    const metricCounts = new Map();
    for (const row of observations(cube)) {
      const item = {
        _index: row.index,
        _value: row.value,
        _unit: row.unit,
        _status:
          cube.metadata.statusLabels?.[row.status] ||
          row.status ||
          (row.value === null ? t('Nedostupný údaj') : ''),
      };
      cube.dimensions.forEach((dim, index) => {
        item[`d${index}`] = row.coordinates[dim.id].label;
        item[`c${index}`] = row.coordinates[dim.id].id;
      });
      item._search = textKey(Object.values(item).join(' '));
      preparedRows.push(item);
      const info = metricCounts.get(row.metricId) || { total: 0, numeric: 0 };
      info.total++;
      if (row.value !== null) info.numeric++;
      metricCounts.set(row.metricId, info);
      if (preparedRows.length % 5000 === 0) {
        app.transfers.update({
          phase: 'processing',
          percent: (preparedRows.length / cube.count) * 100,
          rows: preparedRows.length,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (app.operation?.signal.aborted)
          throw new DOMException(t('Operace byla zrušena.'), 'AbortError');
      }
    }
    this.tableReady = false;
    this.table?.destroy();
    this.table = null;
    this.baseRows = preparedRows;
    this.rows = preparedRows;
    this.analysisKey = null;
    this.coverage = preparedCoverage;
    this.metricCounts = metricCounts;
    $('welcome').hidden = true;
    $('workspace').hidden = false;
    $('result-source').textContent = cube.source || app.descriptor.source;
    $('result-title').textContent = app.descriptor.title;
    const time = cube.dimensions.find((dim) => dim.role === 'time');
    const periods = time?.categories;
    $('result-subtitle').textContent = [
      periods?.length
        ? `${periods[0].label}${periods.length > 1 ? ` – ${periods.at(-1).label}` : ''}`
        : '',
      cube.updated
        ? t`Aktualizace zdroje: ${new Date(cube.updated).toLocaleDateString(getLocale())}`
        : '',
      cube.metadata.cachedAt ? t('Použita místní cache') : t('Načtený výběr'),
    ]
      .filter(Boolean)
      .join(' · ');
    const numeric = this.coverage.numeric;
    const missing = this.coverage.missing;
    const sparse = [...this.metricCounts.values()].filter(
      (item) => item.numeric > 0 && item.numeric < item.total / 2,
    ).length;
    $('summary-strip').innerHTML = [
      [cube.count.toLocaleString(getLocale()), t('buněk')],
      [numeric.toLocaleString(getLocale()), t('číselných údajů')],
      [`${Math.round(this.coverage.ratio * 100)} %`, t('pokrytí')],
      ...(missing ? [[missing.toLocaleString(getLocale()), t('chybějících / chráněných')]] : []),
      ...(sparse ? [[sparse, t('ukazatelů s malým pokrytím')]] : []),
    ]
      .map(
        ([value, label]) =>
          `<div class="summary-item"><strong>${value}</strong><span>${label}</span></div>`,
      )
      .join('');
    const dims = cube.dimensions.filter((dim) => dim.role !== 'metric');
    $('chart-x').innerHTML = dims.map((dim) => option(dim.id, dim.label)).join('');
    $('chart-series').innerHTML =
      option('', t('Bez rozdělení')) + dims.map((dim) => option(dim.id, dim.label)).join('');
    $('chart-metric').innerHTML = (metric?.categories || [{ id: '_value', label: t('Hodnota') }])
      .map((item) => {
        const info = this.metricCounts.get(item.id);
        return option(
          item.id,
          `${item.label}${info?.numeric === 0 ? t(' · bez číselných údajů') : info && info.numeric < info.total / 2 ? t(' · malé pokrytí') : ''}`,
        );
      })
      .join('');
    const x =
      time?.categories.length > 1
        ? time
        : dims.find((dim) => dim.role === 'geo') ||
          dims.find((dim) => dim.categories.length > 1) ||
          dims[0];
    $('chart-x').value = x?.id || '';
    $('chart-series').value =
      dims.find((dim) => dim.id !== x?.id && dim.categories.length > 1)?.id || '';
    $('chart-type').value = x?.role === 'time' && x.categories.length > 1 ? 'line' : 'bar';
    $('chart-transform').value = 'absolute';
    $('chart-sort').value = 'source';
    $('chart-series-order').value = 'source';
    this.seriesIds = null;
    this.categoryIds = null;
    $('table-outliers').checked = false;
    $('table-summary').innerHTML =
      option('', t('Jednotlivé údaje')) +
      dims.map((dim) => option(dim.id, t`Součet přes: ${dim.label}`)).join('');
    $('table-metric-filter').innerHTML =
      option('', t('Všechny ukazatele')) +
      (metric?.categories || []).map((item) => option(item.id, item.label)).join('');
    this.renderAnalysisControls();
    this.fixed = {};
    if (savedChart) this.restore(savedChart);
    this.renderFixed();
    this.renderAnalysisControls();
    this.refreshAnalysis();
    this.renderChart();
    this.showPane('chart');
  }
  config() {
    const { $ } = this.app;
    return {
      ...Object.fromEntries(
        [
          'type',
          'x',
          'series',
          'metric',
          'transform',
          'denominator',
          'scale',
          'sort',
          'limit',
          'legend',
          'labels',
          'extremes',
        ]
          .map((key) => [
            key,
            ['labels', 'extremes'].includes(key)
              ? $(`chart-${key}`).checked
              : $(`chart-${key}`).value,
          ])
          .concat([['fixed', this.fixed]]),
      ),
      seriesIds: this.seriesIds,
      categoryIds: this.categoryIds,
      seriesOrder: $('chart-series-order').value,
      compare: $('analysis-compare').value,
      aggregate: $('table-summary').value,
      outliers: $('table-outliers').checked,
      tableMetric: $('table-metric-filter').value,
    };
  }
  restore(config) {
    const { $ } = this.app;
    for (const [key, value] of Object.entries(config)) {
      if (key === 'seriesIds' || key === 'categoryIds') {
        this[key] = Array.isArray(value)
          ? [...new Set(value.filter((id) => typeof id === 'string'))].slice(0, 200)
          : null;
        continue;
      }
      const extra = {
        seriesOrder: 'chart-series-order',
        compare: 'analysis-compare',
        aggregate: 'table-summary',
        outliers: 'table-outliers',
        tableMetric: 'table-metric-filter',
      }[key];
      if (extra) {
        const control = $(extra);
        if (key === 'outliers') control.checked = value === true;
        else if ([...control.options].some((item) => item.value === value)) control.value = value;
        continue;
      }
      if (key === 'denominator') this.requestedDenominator = value;
      if (key === 'fixed') {
        if (value && typeof value === 'object' && !Array.isArray(value)) this.fixed = value;
        continue;
      }
      if (
        ![
          'type',
          'x',
          'series',
          'metric',
          'transform',
          'denominator',
          'scale',
          'sort',
          'limit',
          'legend',
          'labels',
          'extremes',
        ].includes(key)
      )
        continue;
      const control = $(`chart-${key}`);
      if (['labels', 'extremes'].includes(key)) control.checked = value === true;
      else if ([...control.options].some((item) => item.value === value)) control.value = value;
    }
  }
  renderFixed() {
    const app = this.app,
      cube = app.cube;
    if (!cube) return;
    const config = this.config();
    if (config.series === config.x) app.$('chart-series').value = '';
    const rest = cube.dimensions.filter(
      (dim) =>
        dim.role !== 'metric' && dim.id !== config.x && dim.id !== app.$('chart-series').value,
    );
    app.$('chart-fixed').innerHTML = rest
      .map((dim) => {
        if (!dim.categories.some((item) => item.id === this.fixed[dim.id]))
          this.fixed[dim.id] = dim.categories[0].id;
        return `<label>${escapeHtml(dim.label)}<select data-fixed="${escapeHtml(dim.id)}" aria-label="${ht('Výřez grafu: {0}', escapeHtml(dim.label))}">${dim.categories.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === this.fixed[dim.id] ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>`;
      })
      .join('');
    const measures = ratioMeasures(cube).filter((item) => item.id !== config.metric);
    const desired = this.requestedDenominator || app.$('chart-denominator').value;
    app.$('chart-denominator').innerHTML = measures
      .map((item) => option(item.id, item.label))
      .join('');
    if (measures.some((item) => item.id === desired)) app.$('chart-denominator').value = desired;
    this.requestedDenominator = null;
    const normalize = measures.length > 0 && cube.metricTypes[config.metric] !== 'category';
    app.$('chart-transform').querySelector('[value="ratio"]').disabled = !normalize;
    if (config.transform === 'ratio' && !normalize) app.$('chart-transform').value = 'absolute';
    const ratio = app.$('chart-transform').value === 'ratio';
    app.$('ratio-denominator-control').hidden = !ratio;
    app.$('ratio-scale-control').hidden = !ratio;
    app.$('chart-sort').disabled =
      cube.dimensions.find((dim) => dim.id === config.x)?.role === 'time';
  }
  renderAnalysisControls() {
    const { $ } = this.app,
      cube = this.app.cube;
    if (!cube) return;
    const selected = $('analysis-compare').value,
      aggregate = $('table-summary').value;
    const dims = cube.dimensions.filter((dim) => dim.role !== 'metric' && dim.id !== aggregate);
    $('analysis-compare').innerHTML = dims.map((dim) => option(dim.id, dim.label)).join('');
    $('analysis-compare').value =
      dims.find((dim) => dim.id === selected)?.id ||
      dims.find((dim) => dim.role === 'geo')?.id ||
      dims.find((dim) => dim.role !== 'time')?.id ||
      dims[0]?.id ||
      '';
  }
  refreshAnalysis() {
    const cube = this.app.cube,
      { $ } = this.app;
    if (!cube || !this.baseRows) return;
    const config = this.config();
    const key = JSON.stringify([
      getLocale(),
      config.transform,
      config.denominator,
      config.scale,
      config.compare,
      config.aggregate,
    ]);
    if (key === this.analysisKey) return;
    this.analysisKey = key;
    this.detailRows = markOutliers(
      cube,
      comparisonRows(cube, this.baseRows, { ...config, aggregate: '' }),
      { ...config, aggregate: '' },
    );
    this.rows = config.aggregate
      ? markOutliers(cube, comparisonRows(cube, this.baseRows, config), config)
      : this.detailRows;
    this.tableReady = false;
    this.table?.destroy();
    this.table = null;
    const count = this.rows.filter((row) => row._outlier).length;
    $('analysis-note').textContent =
      t`Odlehlých hodnot: ${count}. Pravidlo 1,5 × IQR; alespoň 5 srovnatelných údajů. Ostatní dimenze, ukazatele a jednotky se porovnávají odděleně.` +
      (config.transform === 'index'
        ? ' ' + t('Index se týká pouze grafu; tabulka a srovnání používají původní hodnoty.')
        : '');
    $('analysis-chart-outliers').disabled = !count || !$('analysis-compare').value;
    $('table-analysis-note').textContent = config.aggregate
      ? t(
          'Souhrn sčítá zvolenou dimenzi při zachování ostatních. Přepočtený součet je součtem jednotlivých přepočtů. Zkontrolujte věcnou sčitatelnost ukazatele. Neúplné součty jsou označené pokrytím a do detekce odlehlých hodnot nevstupují. Graf zachovává jednotlivá období.',
        )
      : t(
          'Přepočet používá stejné dimenze a jmenovatel jako graf. Odlehlé hodnoty se hledají v celém načteném výběru, nezávisle na omezení řad grafu.',
        );
  }
  rowsToChart(rows, replace = false) {
    const { $ } = this.app,
      cube = this.app.cube,
      config = this.config();
    const compare = cube.dimensions.find((dim) => dim.id === config.compare);
    if (!compare || !rows.length)
      return this.app.toast(t('Pro tento výběr nejsou odlehlé položky k zobrazení.'));
    const metricIndex = cube.dimensions.findIndex((dim) => dim.role === 'metric');
    const metric = metricIndex < 0 ? '_value' : rows[0][`c${metricIndex}`];
    rows = rows.filter((row) => metricIndex < 0 || row[`c${metricIndex}`] === metric);
    const compareIndex = cube.dimensions.indexOf(compare),
      time = cube.dimensions.find(
        (dim) => dim.role === 'time' && dim.categories.length > 1 && dim.id !== compare.id,
      );
    const ids = [...new Set(rows.map((row) => row[`c${compareIndex}`]))];
    const previous =
      time && config.series === compare.id
        ? this.seriesIds || this.projection?.series.map((item) => item.id) || []
        : this.categoryIds || [];
    const selected = replace ? ids : [...new Set([...previous, ...ids])];
    if (selected.length > 200) return this.app.toast(t('Vyberte nejvýše 200 položek grafu.'));
    $('chart-metric').value = metric;
    $('chart-x').value = time?.id || compare.id;
    $('chart-series').value = time ? compare.id : '';
    this.seriesIds = time ? selected : null;
    this.categoryIds = time ? null : selected;
    for (const [index, dim] of cube.dimensions.entries())
      if (
        dim.role !== 'metric' &&
        dim.id !== compare.id &&
        dim.id !== time?.id &&
        dim.categories.some((item) => item.id === rows[0][`c${index}`])
      )
        this.fixed[dim.id] = rows[0][`c${index}`];
    this.renderFixed();
    this.showPane('chart');
    this.app.saveState();
  }
  renderChart() {
    const app = this.app,
      { $ } = app,
      cube = app.cube;
    if (!cube || $('chart-panel').hidden) return;
    this.refreshAnalysis();
    const config = this.config();
    const seriesIndex = cube.dimensions.findIndex((dim) => dim.id === config.series);
    const scores = {};
    for (const row of this.detailRows || []) {
      if (
        cube.dimensions.some((dim, index) =>
          dim.role === 'metric'
            ? row[`c${index}`] !== config.metric
            : dim.id !== config.x &&
              dim.id !== config.series &&
              config.fixed[dim.id] &&
              row[`c${index}`] !== config.fixed[dim.id],
        )
      )
        continue;
      const id = row[`c${seriesIndex}`];
      scores[id] = Math.max(scores[id] || 0, row._distance || 0);
    }
    const xDim = cube.dimensions.find((dim) => dim.id === config.x);
    this.projection = chartProjection(cube, {
      ...config,
      seriesScores: scores,
      limit: Number(config.limit),
    });
    const projection = this.projection;
    const manual = Array.isArray(this.seriesIds) || Array.isArray(this.categoryIds);
    $('chart-selection-status').textContent = manual
      ? t('Vlastní výběr položek')
      : t('Automatický výběr');
    $('chart-selection-status').textContent +=
      ' · ' +
      t`Řady v grafu: ${projection.series.length} · Kategorie: ${projection.categories.length}`;
    $('chart-limit').disabled = Array.isArray(this.seriesIds);
    $('chart-series-order').disabled = Array.isArray(this.seriesIds);
    $('reset-chart-items').hidden = !manual;
    const xIndex = cube.dimensions.findIndex((dim) => dim.id === config.x);
    const outlierCells = new Map();
    for (const row of this.detailRows || []) {
      if (
        !row._outlier ||
        !cube.dimensions.every((dim, index) =>
          dim.role === 'metric'
            ? row[`c${index}`] === config.metric
            : dim.id === config.x ||
              dim.id === config.series ||
              row[`c${index}`] === projection.fixed[dim.id],
        )
      )
        continue;
      const id = config.series ? row[`c${seriesIndex}`] : config.metric;
      if (!outlierCells.has(id)) outlierCells.set(id, new Set());
      outlierCells.get(id).add(row[`c${xIndex}`]);
    }
    for (const item of projection.series) {
      item.outliers = projection.categories.flatMap((category, index) =>
        outlierCells.get(item.id)?.has(category.id) ? [index] : [],
      );
    }
    const metric = cube.dimensions
      .find((dim) => dim.role === 'metric')
      ?.categories.find((item) => item.id === config.metric);
    const title = metric?.label || app.descriptor.title;
    const fixed = cube.dimensions
      .filter((dim) => projection.fixed[dim.id])
      .map(
        (dim) =>
          `${dim.label}: ${dim.categories.find((item) => item.id === projection.fixed[dim.id])?.label}`,
      );
    const warnings = [];
    if (projection.omitted && !Array.isArray(this.seriesIds))
      warnings.push(
        t`Zobrazeno ${projection.series.length} z ${projection.series.length + projection.omitted} řad. Počet upravíte v nastavení; tabulka a CSV obsahují celý výběr.`,
      );
    if (config.transform === 'index' && !projection.base)
      warnings.push(t('Pro index není dostupná společná kategorie s nenulovými hodnotami.'));
    if (config.transform === 'ratio')
      warnings.push(
        t`Poměr vůči „${projection.denominator}“ × ${config.scale}. Chybějící, chráněný nebo nulový jmenovatel se nepřepočítává. Zkontrolujte věcný význam a jednotky obou ukazatelů.`,
      );
    if (config.type === 'stacked')
      warnings.push(
        t(
          'Skládaný graf používejte pro sčitatelné a vzájemně se nepřekrývající skupiny. Celky a jejich části se nesmí sčítat.',
        ),
      );
    if (projection.series.some((item) => item.values.some((value) => value === null)))
      warnings.push(t('Chybějící a chráněné údaje jsou vynechané; spojnice přes mezery nevedou.'));
    if (config.labels && projection.categories.length * projection.series.length > 300)
      warnings.push(t('Popisky hodnot se u velkého počtu bodů skrývají kvůli čitelnosti.'));
    $('chart-warning').textContent = warnings.join(' ');
    $('chart-warning').hidden = !warnings.length;
    const tooLarge =
      projection.series.length > 200 ||
      projection.series.length * projection.categories.length > 20000;
    const empty = projection.categorical
      ? t(
          'Tento ukazatel obsahuje kategoriální kódy. Jejich význam a hodnoty najdete v metodice a tabulce.',
        )
      : tooLarge
        ? t(
            'Graf obsahuje příliš mnoho bodů. Omezte počet řad v nastavení nebo zvolte menší výběr. Tabulka zůstává úplná.',
          )
        : !projection.series.length ||
            !projection.series.some((item) => item.values.some((value) => value !== null))
          ? t('Pro zvolený výřez nejsou dostupné číselné údaje.')
          : '';
    $('chart-empty').textContent = empty;
    $('chart-empty').hidden = !empty;
    $('chart').hidden = !!empty;
    $('export-image').disabled = !!empty;
    $('chart-caption').textContent =
      t`${projection.categories.length} kategorií · ${projection.series.length} řad${projection.omitted ? t` (+${projection.omitted} mimo graf)` : ''}`;
    this.chartContext = {
      type: config.type,
      title,
      subtitle: chartSubtitle(projection, { transform: config.transform, fixed }),
      source: t`${cube.source || app.descriptor.source} · ${cube.updated ? new Date(cube.updated).toLocaleDateString(getLocale()) : t('načteno ') + new Date().toLocaleDateString(getLocale())} · Národní data`,
      labels: config.labels,
      extremes: config.extremes,
      legend: window.innerWidth < 760 ? 'bottom' : config.legend,
      time: xDim?.role === 'time',
    };
    this.chartWidth = $('chart').clientWidth || 900;
    this.currentOptions = chartOptions(projection, {
      ...this.chartContext,
      width: this.chartWidth,
    });
    if (empty) {
      this.chart?.clear();
      return;
    }
    this.chart ||= echarts.init($('chart'), null, { renderer: 'canvas' });
    this.chart.setOption(this.currentOptions, { notMerge: true });
    this.chart.resize();
    $('chart').setAttribute(
      'aria-label',
      t`${title}. ${projection.series.length} řad, ${projection.categories.length} kategorií. Podrobné hodnoty jsou na kartě Tabulka.`,
    );
  }
  showPane(pane) {
    const { $ } = this.app;
    for (const name of ['chart', 'table']) {
      $(`${name}-panel`).hidden = name !== pane;
      $(`tab-${name}`).setAttribute('aria-selected', String(name === pane));
      $(`tab-${name}`).tabIndex = name === pane ? 0 : -1;
    }
    if (pane === 'chart') this.renderChart();
    else this.renderTable();
  }
  filteredRows() {
    const { $ } = this.app;
    const term = textKey($('table-search').value);
    return this.rows.filter(
      (row) =>
        ($('table-missing').checked || row._value !== null) &&
        (!$('table-outliers').checked || !!row._outlier) &&
        (!$('table-metric-filter').value ||
          row[`c${this.app.cube.dimensions.findIndex((dim) => dim.role === 'metric')}`] ===
            $('table-metric-filter').value) &&
        (!term || textKey(row._search).includes(term)),
    );
  }
  filterTable() {
    const rows = this.filteredRows();
    this.app.$('table-count').textContent =
      t`${rows.length.toLocaleString(getLocale())} z ${this.rows.length.toLocaleString(getLocale())} řádků`;
    if (this.tableReady) this.table?.replaceData(rows);
  }
  renderTable() {
    this.refreshAnalysis();
    if (this.table) {
      if (this.tableReady) this.table.redraw();
      return;
    }
    const app = this.app,
      cube = app.cube;
    if (!cube) return;
    this.tableReady = false;
    const table = new Tabulator(app.$('data-table'), {
      locale: getLocale(),
      langs: {
        'cs-CZ': { data: { loading: 'Načítám…', error: 'Chyba načítání' } },
        'en-GB': { data: { loading: 'Loading…', error: 'Loading error' } },
      },
      data: this.filteredRows(),
      layout: 'fitDataStretch',
      height: 'min(65vh, 650px)',
      renderVertical: 'virtual',
      renderHorizontal: 'virtual',
      index: '_index',
      placeholder: t('Žádné odpovídající číselné údaje. Zkuste zobrazit i chybějící údaje.'),
      columns: [
        ...cube.dimensions.map((dim, index) => ({
          title: escapeHtml(dim.label),
          field: `d${index}`,
          minWidth: dim.role === 'time' ? 100 : 190,
          maxWidth: 380,
          formatter: (cell) =>
            `<span class="table-label">${escapeHtml(cell.getValue())}<small>${escapeHtml(cell.getRow().getData()[`c${index}`])}</small></span>`,
          variableHeight: true,
          headerTooltip: dim.label,
        })),
        {
          title: app.$('table-summary').value ? t('Součet původních hodnot') : t('Hodnota'),
          field: '_value',
          minWidth: 145,
          hozAlign: 'right',
          sorter: 'number',
          sorterParams: { alignEmptyValues: 'bottom' },
          formatter: (cell) =>
            cell.getValue() == null
              ? `<span class="table-missing" title="${escapeHtml(cell.getRow().getData()._status)}">${escapeHtml(cell.getRow().getData()._status || t('Nedostupné'))}</span>`
              : `<span class="table-value">${formatNumber(cell.getValue())}</span>`,
        },
        ...(app.$('chart-transform').value === 'ratio'
          ? [
              {
                title: app.$('table-summary').value
                  ? t('Součet přepočtených hodnot')
                  : t('Přepočtená hodnota'),
                field: '_derived',
                minWidth: 180,
                hozAlign: 'right',
                sorter: 'number',
                sorterParams: { alignEmptyValues: 'bottom' },
                formatter: (cell) =>
                  `<span class="table-value">${formatNumber(cell.getValue())}</span>`,
                tooltip: (_event, cell) =>
                  cell.getRow().getData()._derivedStatus || cell.getRow().getData()._derivedUnit,
              },
              {
                title: t('Jednotka přepočtu'),
                field: '_derivedUnit',
                minWidth: 170,
                formatter: (cell) => escapeHtml(cell.getValue()),
              },
            ]
          : []),
        {
          title: t('Srovnání'),
          field: '_distance',
          minWidth: 210,
          sorter: 'number',
          formatter: (cell) => {
            const row = cell.getRow().getData();
            return `<span class="outlier-badge ${row._outlier ? 'is-outlier' : ''}" title="${escapeHtml(peerDescription(row))}">${escapeHtml(outlierLabel(row))}</span>`;
          },
        },
        ...(app.$('table-summary').value
          ? [
              { title: t('Pokrytí součtu'), field: '_coverage', minWidth: 120 },
              ...(app.$('chart-transform').value === 'ratio'
                ? [
                    {
                      title: t('Pokrytí přepočteného součtu'),
                      field: '_derivedCoverage',
                      minWidth: 160,
                    },
                  ]
                : []),
            ]
          : []),
        {
          title: t('Graf'),
          headerSort: false,
          minWidth: 100,
          formatter: () => `<button class="text-button">${ht('Přidat do grafu')}</button>`,
          cellClick: (_event, cell) => this.rowsToChart([cell.getRow().getData()]),
        },
        {
          title: t('Jednotka'),
          field: '_unit',
          minWidth: 100,
          formatter: (cell) => escapeHtml(cell.getValue()),
        },
        {
          title: t('Stav / poznámka'),
          field: '_status',
          minWidth: 140,
          formatter: (cell) => `<span class="table-status">${escapeHtml(cell.getValue())}</span>`,
        },
      ],
    });
    this.table = table;
    table.on('tableBuilt', () => {
      if (this.table === table) {
        this.tableReady = true;
        this.filterTable();
      }
    });
    app.$('table-count').textContent =
      t`${this.filteredRows().length.toLocaleString(getLocale())} z ${this.rows.length.toLocaleString(getLocale())} řádků`;
  }
  exportCsv() {
    const cube = this.app.cube;
    if (!cube) return;
    this.refreshAnalysis();
    const { fields, data } = comparisonCsv(
      cube,
      this.tableReady ? this.table.getData('active') : this.filteredRows(),
      this.config(),
    );
    download(
      new Blob(
        [
          '\uFEFF' +
            Papa.unparse(
              { fields, data },
              { delimiter: ';', newline: '\r\n', escapeFormulae: true },
            ),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
      `${filename(this.app.descriptor.title)}.csv`,
    );
    this.app.toast(
      t`Exportováno ${data.length.toLocaleString(getLocale())} řádků podle filtru tabulky.`,
    );
  }
  async exportImage() {
    const { $ } = this.app;
    if (!this.currentOptions || $('export-image').disabled) return;
    const format = $('image-format').value;
    const [width, height] = $('image-size').value.split('x').map(Number);
    const logicalWidth = 1200,
      logicalHeight = 750;
    const container = document.createElement('div');
    container.style.cssText = `position:fixed;left:-20000px;top:0;width:${logicalWidth}px;height:${logicalHeight}px`;
    document.body.append(container);
    const chart = echarts.init(container, null, {
      renderer: format === 'svg' ? 'svg' : 'canvas',
      width: logicalWidth,
      height: logicalHeight,
    });
    try {
      const options = {
        ...chartOptions(this.projection, {
          ...this.chartContext,
          width: logicalWidth,
          titleSize: 21,
          legend: 'bottom',
          staticExport: true,
        }),
        animation: false,
      };
      const current = this.chart?.getOption();
      if (current?.legend?.[0]?.selected)
        options.legend = { ...options.legend, selected: current.legend[0].selected };
      if (current?.dataZoom && options.dataZoom)
        options.dataZoom = options.dataZoom.map((zoom, index) => ({
          ...zoom,
          ...(current.dataZoom[index]
            ? { start: current.dataZoom[index].start, end: current.dataZoom[index].end }
            : {}),
        }));
      chart.setOption(options);
      const uri = chart.getDataURL({
        type: format,
        pixelRatio: width / logicalWidth,
        backgroundColor: '#fff',
      });
      const response = await fetch(uri);
      const blob =
        format === 'svg'
          ? new Blob(
              [
                (await response.text()).replace(
                  '<svg width="1200" height="750"',
                  `<svg width="${width}" height="${height}"`,
                ),
              ],
              { type: 'image/svg+xml;charset=utf-8' },
            )
          : await response.blob();
      download(blob, `${filename(this.currentOptions.title.text)}.${format}`);
      $('image-dialog').close();
      this.app.toast(t`Graf uložen jako ${format.toUpperCase()} (${width} × ${height}).`);
    } finally {
      chart.dispose();
      container.remove();
    }
  }
}
