import { getLocale, ht, t, translateMessage } from '../i18n/index.js';
import { escapeHtml } from '../core/cube.js';
import { bytes } from './transfers.js';

export class Utilities {
  constructor(app) {
    this.app = app;
    const { $ } = app;
    $('cache-button').addEventListener('click', () => this.cache());
    $('cache-list').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-remove-cache]');
      if (button) {
        button.disabled = true;
        await app.cache.remove(button.dataset.removeCache);
        this.cache(false);
      }
    });
    $('clear-cache').addEventListener('click', async () => {
      $('clear-cache').disabled = true;
      for (const item of await app.cache.entries()) await app.cache.remove(item.key);
      $('clear-cache').disabled = false;
      this.cache(false);
    });
    $('network-button').addEventListener('click', () => {
      this.network();
      $('network-dialog').showModal();
    });
    $('information-button').addEventListener('click', () => this.info());
    $('help-button').addEventListener('click', () => this.info(true));
  }
  async cache(open = true) {
    const app = this.app,
      entries = await app.cache.entries();
    app.$('cache-list').innerHTML =
      entries
        .map(
          (item) =>
            `<div class="cache-row"><div><strong>${escapeHtml(item.title || item.key)}</strong><small>${bytes(item.size)} · ${item.savedAt ? new Date(item.savedAt).toLocaleString(getLocale()) : ''}${item.modified ? t` · zdroj ${escapeHtml(item.modified)}` : ''}</small></div><button class="button" data-remove-cache="${escapeHtml(item.key)}">${ht('Odstranit')}</button></div>`,
        )
        .join('') || `<p class="empty-state">${ht('Zatím žádná uložená data.')}</p>`;
    app.$('cache-total').textContent =
      t`${entries.length} položek · ${bytes(entries.reduce((sum, item) => sum + item.size, 0))}${app.cache.db ? '' : t(' · pouze paměť stránky')}`;
    if (open) app.$('cache-dialog').showModal();
  }
  network() {
    const app = this.app,
      state = app.client.gate.read();
    app.$('quota-status').textContent =
      state.pauseUntil > Date.now()
        ? t`Fronta pozastavena do ${new Date(state.pauseUntil).toLocaleTimeString(getLocale())}: ${translateMessage(state.reason)}`
        : t`${state.starts.filter((time) => time > Date.now() - 60000).length} požadavků v poslední minutě. ${app.client.gate.locks && app.client.gate.storage ? t('Koordinace mezi kartami je zapnutá.') : t('Limit se v tomto prohlížeči hlídá především v rámci této stránky.')}`;
    app.$('network-log').innerHTML =
      app.client.log
        .map(
          (item) =>
            `<div class="network-row"><strong class="${item.status >= 200 && item.status < 300 ? 'http-ok' : 'http-error'}">${item.status || t('Síť')}<small> ${item.method}</small></strong><code>${escapeHtml(new URL(item.url).pathname)}${item.error ? `<br />${escapeHtml(translateMessage(item.error))}` : ''}</code><span>${item.duration || 0} ms<br />${bytes(item.bytes)}${item.attempt ? `<br />${ht('pokus {0}', item.attempt + 1)}` : ''}</span></div>`,
        )
        .join('') ||
      `<p class="muted">${ht('Zatím nebyl odeslán žádný požadavek. Odpovědi z cache síť nevyužívají.')}</p>`;
  }
  info(about = false) {
    const app = this.app,
      { $ } = app;
    $('info-title').textContent = about ? t('O aplikaci Národní data') : t('Metodika a původ dat');
    const common = `<p>${ht('Nezávislý průzkumník národních otevřených dat. Prvními podporovanými zdroji jsou ČSÚ DataStat a MOS. Aplikace pracuje přímo v prohlížeči; vlastní soubory se nikam neodesílají. Nejde o oficiální aplikaci ČSÚ.')}</p><p>${ht('Prázdná hodnota není nula. Chráněné údaje respektujeme a v grafech je neodhadujeme. Jednotky, metodika a územní členění se mohou v čase měnit. Graf zobrazuje jeden ukazatel a zvolený výřez ostatních dimenzí; tabulka zachovává celý načtený výběr.')}</p>`;
    let content = about ? common : '';
    if (app.descriptor && !about) {
      content += `<h3>${escapeHtml(app.descriptor.title)}</h3><p>${escapeHtml(app.descriptor.description || '')}</p>${app.descriptor.url ? `<p><a href="${escapeHtml(app.descriptor.url)}" target="_blank" rel="noopener noreferrer">${ht('Původní datová sada ↗')}</a></p>` : ''}`;
      for (const note of app.cube?.notes || []) content += `<p>${escapeHtml(note)}</p>`;
      for (const dim of app.cube?.dimensions || [])
        if (dim.role === 'metric')
          for (const metric of dim.categories) {
            if (metric.note)
              content += `<h3>${escapeHtml(metric.label)}</h3><p>${escapeHtml(metric.note)}</p>`;
          }
    }
    content += `<h3>${ht('Dokumentace')}</h3><p><a href="https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu" target="_blank" rel="noopener noreferrer">${ht('API ČSÚ DataStat ↗')}</a> · <a href="https://csu.gov.cz/statistika/databaze-mos-otevrena-data-dokumentace" target="_blank" rel="noopener noreferrer">${ht('Dokumentace MOS ↗')}</a></p><h3>${ht('Licence')}</h3><p>${ht('Vlastní kód MIT, © 2026 Martin Rotter. ECharts Apache-2.0; Tabulator a Papa Parse MIT. Úplná licenční oznámení jsou vložená v tomto HTML. Licence aplikace nemění podmínky zdrojových dat.')}</p>`;
    $('info-content').innerHTML = content;
    $('info-dialog').showModal();
  }
}
