import { getLocale, t, translateMessage, errorText } from '../i18n/index.js';
import { escapeHtml } from '../core/cube.js';

export const bytes = (value = 0) =>
  value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} MB`
    : `${(value / 1024).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} kB`;
const labels = () => ({
  queued: t('Čeká'),
  waiting: t('Ve frontě'),
  request: t('Připojuji'),
  response: t('Přijímám'),
  receiving: t('Stahuji'),
  processing: t('Zpracovávám'),
  saving: t('Ukládám'),
  cached: t('Již uloženo'),
  done: t('Připraveno'),
  error: t('Chyba'),
  canceled: t('Zrušeno'),
});

export class Transfers {
  constructor(app) {
    this.app = app;
    this.files = new Map();
    app
      .$('cancel-loading')
      .addEventListener('click', () =>
        app.operation ? app.operation.abort() : app.$('progress-dialog').close(),
      );
    app.$('progress-dialog').addEventListener('cancel', (event) => {
      if (app.operation) {
        event.preventDefault();
        app.operation.abort();
      }
    });
  }
  open(title, files = []) {
    const { $ } = this.app;
    this.files = new Map(
      files.map((file) => [file.name, { ...file, phase: file.cached ? 'cached' : 'queued' }]),
    );
    $('progress-title').textContent = title;
    $('progress-detail').textContent = t('Připravuji požadavek…');
    $('progress-bar').removeAttribute('value');
    $('progress-bytes').textContent = '';
    $('progress-percent').textContent = '';
    this.render();
    if (!$('progress-dialog').open) $('progress-dialog').showModal();
  }
  update(event) {
    const { $ } = this.app;
    if (event.warning) this.app.toast(event.warning);
    if (!$('progress-dialog').open) return;
    clearInterval(this.countdown);
    const name =
      event.file ||
      (event.url
        ? new URL(event.url).pathname.split('/').filter(Boolean).slice(-2).join('/')
        : null);
    if (name) {
      const old = this.files.get(name) || {};
      this.files.set(name, { ...old, ...event, name });
    }
    let percent = null;
    if (event.phase === 'receiving' && event.total > 0)
      percent = Math.min(82, (event.loaded / event.total) * 82);
    if (event.phase === 'processing' && event.percent != null) percent = 82 + event.percent * 0.15;
    if (event.phase === 'saving') percent = 98;
    if (['done', 'cached'].includes(event.phase)) percent = 100;
    if (percent == null) $('progress-bar').removeAttribute('value');
    else $('progress-bar').value = percent;
    $('progress-percent').textContent = percent == null ? '' : `${Math.round(percent)} %`;
    $('progress-bytes').textContent =
      event.loaded != null
        ? `${bytes(event.loaded)}${event.total ? ` / ${bytes(event.total)}` : t(' přijato')}`
        : event.rows
          ? t`${event.rows.toLocaleString(getLocale())} řádků`
          : '';
    const detail = () => {
      $('progress-detail').textContent =
        event.phase === 'waiting'
          ? t`${translateMessage(event.reason)} · pokračování za ${Math.max(0, Math.ceil((event.until - Date.now()) / 1000))} s`
          : `${labels()[event.phase] || t('Připravuji data')}${name ? ` · ${name}` : ''}`;
    };
    detail();
    if (event.phase === 'waiting') this.countdown = setInterval(detail, 1000);
    this.render();
  }
  render() {
    this.app.$('progress-files').innerHTML = [...this.files.values()]
      .map(
        (file) =>
          `<div class="progress-file"><span><strong>${escapeHtml(file.name)}</strong><small>${file.loaded ? bytes(file.loaded) : file.cached ? t('Bez dalšího stahování') : file.error ? escapeHtml(file.error) : ''}</small></span><span class="file-state ${file.phase}">${labels()[file.phase] || t('Připravuji')}</span></div>`,
      )
      .join('');
  }
  finish(error) {
    clearInterval(this.countdown);
    if (!error) {
      this.app.$('progress-dialog').close();
      return;
    }
    for (const file of this.files.values())
      if (!['done', 'cached'].includes(file.phase))
        file.phase = error.name === 'AbortError' ? 'canceled' : 'error';
    this.app.$('progress-title').textContent =
      error.name === 'AbortError' ? t('Načítání zrušeno') : t('Načítání se nezdařilo');
    this.app.$('progress-detail').textContent = errorText(error);
    this.app.$('progress-bar').removeAttribute('value');
    this.render();
  }
}
