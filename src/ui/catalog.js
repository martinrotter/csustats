import { t, getLocale, getLanguage, ht } from '../i18n/index.js';
import { escapeHtml, textKey } from '../core/cube.js';
import { countWord } from '../core/dimensions.js';

export class Catalog {
  constructor(app) {
    this.app = app;
    this.limit = 80;
    this.items = [...app.sources.builtins];
    for (const id of ['dataset-search', 'catalog-source', 'catalog-municipal'])
      app.$(id).addEventListener(id === 'dataset-search' ? 'input' : 'change', () => {
        this.limit = 80;
        this.render();
      });
    app.$('catalog-more').addEventListener('click', () => {
      this.limit += 80;
      this.render();
    });
    app.$('dataset-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-dataset]');
      if (button) app.chooseDataset(button.dataset.dataset);
    });
    app.$('refresh-catalog').addEventListener('click', () => this.load(true));
  }
  async load(force = false) {
    const language = getLanguage();
    if (this.pending && this.pendingLanguage === language) return this.pending;
    this.pendingLanguage = language;
    this.app.$('catalog-count').textContent = t('Načítám katalog ČSÚ…');
    const pending = this.app.datastat
      .catalog({ force, language })
      .then((items) => {
        if (getLanguage() !== language) return;
        this.items = [
          ...this.app.sources.builtins,
          ...items.sort((a, b) => a.title.localeCompare(b.title, getLocale())),
        ];
        this.render();
      })
      .catch((error) => {
        if (getLanguage() !== language) return;
        this.app.message(
          t`Katalog ČSÚ se nepodařilo načíst. Souborové sady a vlastní soubory zůstávají dostupné. ${error.message}`,
          true,
        );
        this.render();
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
  open(source = 'all') {
    this.app.$('catalog-source').value = source;
    this.app.$('dataset-dialog').showModal();
    this.render();
    this.app.$('dataset-search').focus();
    if (this.items.length === 1) this.load();
  }
  render() {
    const { $ } = this.app;
    const terms = textKey($('dataset-search').value).split(/\s+/).filter(Boolean);
    const source = $('catalog-source').value;
    const municipal = $('catalog-municipal').checked;
    const items = this.items.filter(
      (item) =>
        (source === 'all' || source === item.sourceKey) &&
        (!municipal || item.geoLevels.some((level) => level.kodUrovne === 'OBEC')) &&
        terms.every((term) => textKey(`${item.title} ${item.code}`).includes(term)),
    );
    $('catalog-count').textContent =
      `${items.length.toLocaleString(getLocale())} ${countWord(items.length, 'sada', 'sady', 'sad')}${this.items.length === 1 && this.pending ? t(' · načítám ČSÚ…') : ''}`;
    $('dataset-list').innerHTML =
      items
        .slice(0, this.limit)
        .map(
          (item) =>
            `<button class="dataset-card" data-dataset="${escapeHtml(item.id)}"><span class="source-badge">${escapeHtml(item.source)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.code)} · ${escapeHtml(
              item.timeLevels
                .map((level) => level.nazevUrovne)
                .filter(Boolean)
                .join(', ') || t('Období podle sady'),
            )} · ${escapeHtml(
              item.geoLevels
                .map((level) => level.nazevUrovne || level.kodUrovne)
                .filter(Boolean)
                .join(', ') || t('Bez územního členění'),
            )}</small></button>`,
        )
        .join('') || `<p class="empty-state">${ht('Žádná sada neodpovídá hledání.')}</p>`;
    $('catalog-more').hidden = items.length <= this.limit;
  }
}
