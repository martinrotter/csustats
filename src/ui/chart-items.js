import { t } from '../i18n/index.js';
import { escapeHtml, textKey } from '../core/cube.js';

export class ChartItems {
  constructor(results) {
    this.results = results;
    const { $ } = results.app;
    $('choose-chart-items').addEventListener('click', () => this.open());
    $('reset-chart-items').addEventListener('click', () => {
      results.seriesIds = null;
      results.categoryIds = null;
      results.renderChart();
      results.app.saveState();
    });
    for (const id of ['chart-items-search', 'chart-items-selected'])
      $(id).addEventListener('input', () => this.render());
    $('chart-items-list').addEventListener('change', (event) => {
      const input = event.target.closest('input[data-item]');
      if (!input) return;
      if (input.checked && this.draft.size >= 200) {
        input.checked = false;
        results.app.toast(t('Vyberte nejvýše 200 položek grafu.'));
        return;
      }
      if (input.checked) this.draft.add(input.dataset.item);
      else this.draft.delete(input.dataset.item);
      this.render();
    });
    $('chart-items-all').addEventListener('click', () => {
      const ids = new Set([...this.draft, ...this.matching().map((item) => item.id)]);
      if (ids.size > 200) return results.app.toast(t('Vyberte nejvýše 200 položek grafu.'));
      this.draft = ids;
      this.render();
    });
    $('chart-items-none').addEventListener('click', () => {
      this.draft.clear();
      this.render();
    });
    $('chart-items-apply').addEventListener('click', () => {
      if (this.isSeries) results.seriesIds = [...this.draft];
      else results.categoryIds = [...this.draft];
      $('chart-items-dialog').close();
      results.renderChart();
      results.app.saveState();
    });
  }
  open() {
    const results = this.results,
      { $ } = results.app,
      config = results.config();
    this.isSeries = !!config.series && config.series !== config.x;
    this.dimension = results.app.cube.dimensions.find(
      (dim) => dim.id === (this.isSeries ? config.series : config.x),
    );
    if (!this.dimension) return;
    this.draft = new Set(
      (this.isSeries ? results.seriesIds : results.categoryIds) ||
        (this.isSeries ? results.projection.series : results.projection.categories).map(
          (item) => item.id,
        ),
    );
    $('chart-items-title').textContent = t`Položky grafu: ${this.dimension.label}`;
    $('chart-items-search').value = '';
    $('chart-items-selected').checked = false;
    this.render();
    $('chart-items-dialog').showModal();
    $('chart-items-search').focus();
  }
  matching() {
    const { $ } = this.results.app,
      term = textKey($('chart-items-search').value);
    return this.dimension.categories.filter(
      (item) =>
        (!$('chart-items-selected').checked || this.draft.has(item.id)) &&
        textKey(`${item.label} ${item.id}`).includes(term),
    );
  }
  render() {
    const { $ } = this.results.app,
      items = this.matching();
    $('chart-items-list').innerHTML = items
      .slice(0, 200)
      .map(
        (item) =>
          `<label class="dimension-option"><input type="checkbox" data-item="${escapeHtml(item.id)}" ${this.draft.has(item.id) ? 'checked' : ''} /><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.id)}</small></span></label>`,
      )
      .join('');
    $('chart-items-count').textContent =
      t`Vybráno ${this.draft.size} z ${this.dimension.categories.length} položek` +
      (items.length > 200 ? t(' · zobrazeno prvních 200, zpřesněte hledání') : '');
    $('chart-items-apply').disabled = this.draft.size > 200;
  }
}
