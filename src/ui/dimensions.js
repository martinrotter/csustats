import { ht, getLocale, t } from '../i18n/index.js';
import { escapeHtml, textKey, observations } from '../core/cube.js';
import { validateSelection } from '../core/selection.js';
import {
  refreshTemporalDimensions,
  dimensionGroups,
  belongsToGroup,
  countWord,
} from '../core/dimensions.js';

export class Dimensions {
  constructor(app) {
    this.app = app;
    const { $ } = app;
    $('dimension-controls').addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-dimension]');
      if (remove) {
        app.changeDimensionType(remove.dataset.removeDimension, false);
        return;
      }
      const button = event.target.closest('[data-dimension]');
      if (button && !app.busy) this.open(button.dataset.dimension);
    });
    $('dimension-controls').addEventListener('change', (event) => {
      if (event.target.dataset.addDimension !== undefined && event.target.value) {
        app.changeDimensionType(event.target.value, true);
        return;
      }
      if (event.target.dataset.variant)
        app.changeVariant(event.target.dataset.variant, event.target.value);
    });
    for (const id of [
      'dimension-search',
      'dimension-level',
      'dimension-group',
      'dimension-selected-only',
      'show-empty-metrics',
    ])
      $(id).addEventListener(id === 'dimension-search' ? 'input' : 'change', () => {
        this.limit = 150;
        this.renderPicker();
      });
    $('dimension-list').addEventListener('change', (event) => {
      if (!event.target.dataset.code) return;
      if (event.target.checked) this.selected.add(event.target.dataset.code);
      else this.selected.delete(event.target.dataset.code);
      this.count();
    });
    $('dimension-all').addEventListener('click', () => {
      for (const item of this.filtered()) this.selected.add(item.id);
      this.renderPicker();
    });
    $('dimension-none').addEventListener('click', () => {
      this.selected.clear();
      this.renderPicker();
    });
    $('dimension-more').addEventListener('click', () => {
      this.limit += 150;
      this.renderPicker();
    });
    $('dimension-apply').addEventListener('click', () => {
      app.selections[this.current.id] = this.current.categories
        .filter((item) => this.selected.has(item.id))
        .map((item) => item.id);
      $('dimension-dialog').close();
      this.render();
      app.saveState();
    });
  }
  render() {
    const app = this.app,
      descriptor = app.descriptor;
    if (!descriptor) return;
    refreshTemporalDimensions(descriptor, app.selections);
    app.$('dimension-count').textContent = `${descriptor.dimensions.length}`;
    app.$('dimension-controls').innerHTML = descriptor.dimensions
      .map((dim) => {
        const ids = app.selections[dim.id] || [];
        const names = ids
          .slice(0, 2)
          .map((id) => dim.categories.find((item) => item.id === id)?.label || id);
        const variants = descriptor.variants?.get(dim.type);
        const variant =
          variants?.length > 1
            ? `<select class="dimension-variant" data-variant="${escapeHtml(dim.type)}" aria-label="${ht('Varianta dimenze {0}', escapeHtml(dim.label))}" ${app.busy ? 'disabled' : ''}>${variants.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === dim.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select>`
            : '';
        const remove =
          descriptor.variants && dim.type && !descriptor.requiredTypes?.includes(dim.type)
            ? `<button class="text-button" data-remove-dimension="${escapeHtml(dim.type)}" aria-label="${ht('Odebrat členění {0}', escapeHtml(dim.label))}" ${app.busy ? 'disabled' : ''}>×</button>`
            : '';
        return `<div class="dimension-block"><div class="dimension-label"><span>${escapeHtml(dim.label)} ${remove}</span><span>${ids.length} / ${dim.categories.length.toLocaleString(getLocale())}</span></div>${variant}<button class="dimension-button" data-dimension="${escapeHtml(dim.id)}" ${app.busy ? 'disabled' : ''}><span><strong>${escapeHtml(names.join(', ') || t('Vyberte položky'))}${ids.length > 2 ? t` a dalších ${ids.length - 2}` : ''}</strong><small>${dim.role === 'metric' ? t('Ukazatele a jejich metodika') : dim.role === 'time' ? t('Jedno i více období') : dim.role === 'geo' ? t('Jednotlivě i hromadně') : t('Jedna i více kategorií')}</small></span><b>⌄</b></button></div>`;
      })
      .join('');
    const additional = descriptor.variants
      ? [...descriptor.variants].filter(([type]) => !descriptor.activeTypes?.includes(type))
      : [];
    if (additional.length)
      app
        .$('dimension-controls')
        .insertAdjacentHTML(
          'beforeend',
          `<label class="dimension-block">${ht('Doplňující členění')}<select data-add-dimension aria-label="${ht('Přidat členění')}" ${app.busy ? 'disabled' : ''}><option value="">${ht('Přidat dimenzi…')}</option>${additional.map(([type, list]) => `<option value="${escapeHtml(type)}">${escapeHtml(list[0].label)}</option>`).join('')}</select></label>`,
        );
    let count = 0;
    try {
      count = validateSelection(descriptor, app.selections);
      app.$('selection-size').textContent =
        t`${count.toLocaleString(getLocale())} ${countWord(count, t('buňka'), t('buňky'), t('buněk'))} ve výběru`;
      app.$('selection-size').classList.remove('invalid');
    } catch (error) {
      app.$('selection-size').textContent = error.message;
      app.$('selection-size').classList.add('invalid');
    }
    app.$('load-data').disabled = app.busy || !count;
    app.$('refresh-data').disabled = app.busy || !count || descriptor.id === 'import';
    const dirty = app.cube && JSON.stringify(app.selections) !== app.loadedSelection;
    app.$('dirty-label').textContent = dirty ? t('Změněný výběr') : '';
    app.$('result-stale').textContent = dirty ? t('Graf a tabulka zobrazují předchozí výběr') : '';
  }
  async open(id) {
    const app = this.app,
      { $ } = app;
    this.current = app.descriptor.dimensions.find((dim) => dim.id === id);
    this.selected = new Set(app.selections[id]);
    this.limit = 150;
    this.metricCoverage = new Map();
    if (this.current.role === 'metric' && app.cube) {
      for (const row of observations(app.cube)) {
        const info = this.metricCoverage.get(row.metricId) || { total: 0, numeric: 0 };
        info.total++;
        if (row.value !== null) info.numeric++;
        this.metricCoverage.set(row.metricId, info);
      }
    }
    $('dimension-dialog-title').textContent = this.current.label;
    $('dimension-hint').textContent =
      this.current.role === 'time'
        ? t('Vyberte období. Již uložené soubory jsou označené a znovu se nestahují.')
        : this.current.role === 'metric'
          ? t(
              'Pokrytí uvádíme jen pro již načtené ukazatele a výběr. Neověřené položky zůstávají v nabídce.',
            )
          : t('Vyberte libovolný počet položek; hromadná volba přidá všechny odpovídající filtru.');
    $('dimension-search').value = '';
    $('dimension-selected-only').checked = false;
    $('show-empty-metrics').checked = false;
    $('empty-metrics-label').hidden = this.current.role !== 'metric';
    const levels = this.current.levels || [];
    $('dimension-level').hidden = levels.length <= 1;
    $('dimension-level').innerHTML =
      `<option value="">${ht('Všechny úrovně')}</option>` +
      levels
        .map(
          (level) => `<option value="${escapeHtml(level.id)}">${escapeHtml(level.label)}</option>`,
        )
        .join('');
    const groups = dimensionGroups(this.current);
    this.current.categoryIndex = new Map(this.current.categories.map((item) => [item.id, item]));
    $('dimension-group').hidden = !groups.length;
    $('dimension-group').innerHTML =
      `<option value="">${ht('Všechny skupiny')}</option>` +
      groups
        .map(
          (group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.label)}</option>`,
        )
        .join('');
    this.cacheKeys = new Set((await app.cache.entries()).map((entry) => entry.key));
    if (this.current.role === 'time') this.limit = this.current.categories.length;
    this.renderPicker();
    $('dimension-dialog').showModal();
    $('dimension-search').focus();
  }
  filtered() {
    const { $ } = this.app;
    const term = textKey($('dimension-search').value),
      level = $('dimension-level').value,
      group = $('dimension-group').value;
    return this.current.categories.filter(
      (item) =>
        (!term ||
          textKey(
            `${item.id} ${item.label} ${(item.groups || []).map((group) => group.label).join(' ')}`,
          ).includes(term)) &&
        (!level || item.level === level) &&
        belongsToGroup(item, this.current, group) &&
        (!$('dimension-selected-only').checked || this.selected.has(item.id)) &&
        ($('show-empty-metrics').checked ||
          this.selected.has(item.id) ||
          !this.metricCoverage.has(item.id) ||
          this.metricCoverage.get(item.id).numeric > 0),
    );
  }
  count() {
    this.app.$('dimension-selection-count').textContent =
      t`Vybráno ${this.selected.size.toLocaleString(getLocale())} z ${this.current.categories.length.toLocaleString(getLocale())} položek`;
  }
  renderPicker() {
    const items = this.filtered();
    if (this.current.role === 'time') items.reverse();
    this.app.$('dimension-list').innerHTML =
      items
        .slice(0, this.limit)
        .map((item) => {
          const info = this.metricCoverage.get(item.id);
          const coverage = info
            ? `<span class="coverage-badge ${info.numeric < info.total / 2 ? 'sparse' : ''}">${info.numeric === 0 ? t('Bez číselných údajů') : t`${info.numeric}/${info.total} číselných údajů${info.numeric < info.total / 2 ? t(' · malé pokrytí') : ''}`}</span>`
            : '';
          const cached = item.resourceKey && this.cacheKeys.has(item.resourceKey);
          const detail = [
            item.id !== String(item.label) ? item.id : '',
            ...(item.groups || []).map((group) => group.label),
            item.unit,
            item.active === false ? t('Mimo platnost ve zvoleném období') : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return `<label class="dimension-option"><input type="checkbox" aria-label="${escapeHtml(item.label)}${detail ? ` · ${escapeHtml(detail)}` : ''}" data-code="${escapeHtml(item.id)}" ${this.selected.has(item.id) ? 'checked' : ''} /><span><strong>${escapeHtml(item.label)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}${cached ? `<span class="coverage-badge">${ht('Již staženo · bez nového přenosu')}</span>` : ''}${coverage}</span></label>`;
        })
        .join('') || `<p class="empty-state">${ht('Žádná položka neodpovídá filtru.')}</p>`;
    this.app.$('dimension-more').hidden = items.length <= this.limit;
    this.count();
  }
}
