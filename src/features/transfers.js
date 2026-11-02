import { CsuTransfers } from '../core/transfers.js';

export function createTransfers(app) {
  function abortError() {
    return new DOMException('Načítání bylo zrušeno.', 'AbortError');
  }
  function checkAbort() {
    if (app.operationController?.signal.aborted) throw app.abortError();
  }
  function setTransferTasks(tasks) {
    app.transferTasks = tasks;
    app.activeTransfer = null;
    app.taskTotal = tasks.length || 1;
    app.$('transfer-section').classList.toggle('hidden', !tasks.length);
    app.$('transfer-list').innerHTML = tasks
      .map(
        (task) =>
          `<div class="transfer-file" data-transfer-id="${app.esc(task.id)}"><span class="file-state-icon" aria-hidden="true"></span><div class="file-description"><b>${app.esc(task.year ? `Rok ${task.year}` : task.title || task.name)}</b><small>${app.esc(task.name)}</small><span class="file-detail"></span></div><div class="file-state"><span class="file-status"></span><div class="file-meter"><i></i></div></div></div>`,
      )
      .join('');
    app.renderTransfers();
  }
  function renderTransfers() {
    for (const task of app.transferTasks) {
      const element = app.$('transfer-list').querySelector(`[data-transfer-id="${task.id}"]`);
      if (!element) continue;
      element.className = `transfer-file ${task.status}${task.id === app.activeTransfer ? ' current' : ''}`;
      element.querySelector('.file-state-icon').textContent = ['cached', 'done'].includes(
        task.status,
      )
        ? '✓'
        : task.status === 'error'
          ? '!'
          : task.status === 'canceled'
            ? '−'
            : '';
      element.querySelector('.file-status').textContent = app.transferLabels[task.status];
      element.querySelector('.file-detail').textContent =
        task.detail ||
        (task.cached && task.size ? `${app.mb(task.size)} · v tomto prohlížeči` : '');
      element.querySelector('.file-meter i').style.width = `${Math.max(0, task.fraction) * 100}%`;
    }
    const ready = app.transferTasks.filter((task) => task.cached || task.status === 'done').length;
    const overall = Math.floor(CsuTransfers.overall(app.transferTasks));
    app.$('transfer-summary').textContent = `${ready} z ${app.transferTasks.length} k dispozici`;
    app.$('overall-percent').textContent = `${overall} %`;
    app.$('overall-fill').style.width = `${overall}%`;
    app.$('overall-progress').setAttribute('aria-valuenow', overall);
    const current = app.$('transfer-list').querySelector('.transfer-file.current');
    const active = app.transferTasks.find((task) => task.id === app.activeTransfer);
    if (current && active && active.lastHeight !== current.offsetHeight) {
      active.lastHeight = current.offsetHeight;
      current.scrollIntoView({
        block: 'nearest',
      });
    }
  }
  function transferStatus(status, detail) {
    const task = app.transferTasks.find((item) => item.id === app.activeTransfer);
    if (!task) return;
    task.status = status;
    if (detail !== undefined) task.detail = detail;
    if (['cached', 'done'].includes(status)) task.fraction = 1;
    app.renderTransfers();
  }
  function startYearTransfer(year) {
    const changed = app.activeTransfer !== `year-${year}`;
    app.activeTransfer = `year-${year}`;
    app.taskIndex = Math.max(
      0,
      app.transferTasks.findIndex((task) => task.id === app.activeTransfer),
    );
    app.$('loading-detail').textContent =
      `Roční statistika ${year}${app.state.places.length ? ` · ${app.placeCount(app.state.places.length)}` : ' · všechny obce'}`;
    app.renderTransfers();
    if (changed)
      app
        .$('transfer-list')
        .querySelector(`[data-transfer-id="${app.activeTransfer}"]`)
        ?.scrollIntoView({
          block: 'nearest',
        });
  }
  function progress(stage, percent, bytes = '') {
    app.$('loading-stage').textContent = stage;
    app.$('loading-bytes').textContent = bytes;
    app.$('loading-task').textContent =
      app.taskTotal > 1 ? `Soubor ${app.taskIndex + 1} z ${app.taskTotal}` : '';
    if (percent == null) {
      app.$('loading-progress').removeAttribute('value');
      app.$('loading-percent').textContent = '';
      app.$('progress-track').classList.add('indeterminate');
    } else {
      app.$('loading-progress').value = percent;
      app.$('loading-percent').textContent = `${Math.min(100, Math.floor(percent))} %`;
      app.$('progress-track').classList.remove('indeterminate');
      app.$('progress-fill').style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
    const task = app.transferTasks.find((item) => item.id === app.activeTransfer);
    if (task) {
      if (percent != null) task.fraction = Math.max(task.fraction || 0, percent / 100);
      if (bytes) task.detail = bytes;
      app.renderTransfers();
    }
  }
  async function runOperation(title, callback, options = {}) {
    if (app.busy) return;
    app.busy = true;
    app.operationController = new AbortController();
    app.taskIndex = 0;
    app.setTransferTasks(options.tasks || []);
    app.$('cancel-loading').textContent = 'Zrušit načítání';
    app.$('cancel-loading').classList.remove('primary');
    app.$('loading-help').textContent =
      'Již stažené soubory se použijí z prohlížeče. Nové se stahují přímo z ČSÚ.';
    app.$('loading-title').textContent = title;
    app.$('loading-detail').textContent = 'Připravuji načtení…';
    app.progress('Připojuji se…', null);
    if (!app.$('loading-dialog').open) app.$('loading-dialog').showModal();
    let result = {
      ok: false,
      canceled: false,
    };
    try {
      await callback();
      app.checkAbort();
      app.notice('');
      result.ok = true;
    } catch (error) {
      result.canceled = error.name === 'AbortError';
      result.error = error;
      app.transferStatus(result.canceled ? 'canceled' : 'error', error.message);
      if (result.canceled) app.toast('Načítání zrušeno. Dokončené soubory zůstávají uložené.');
      else {
        console.error(error);
        app.notice(
          `Data se nepodařilo načíst: ${error.message} Zkontrolujte připojení a zkuste to znovu.`,
          true,
          !app.catalogReady,
        );
      }
    } finally {
      app.operationController = null;
      app.busy = false;
      await app.updateCacheSummary();
      app.renderSelection();
      if (options.retain && !result.canceled) {
        if (result.ok) {
          app.$('loading-title').textContent = 'Vybrané roky jsou připravené';
          app.$('loading-detail').textContent =
            'Uložené roky jsme přeskočili. Nově stažené soubory jsou připravené k prohlížení.';
          app.activeTransfer = null;
          app.progress('Hotovo', 100);
          app.$('cancel-loading').textContent = 'Pokračovat k datům';
          app.$('cancel-loading').classList.add('primary');
        } else {
          app.$('loading-title').textContent = 'Načítání se nepodařilo dokončit';
          app.$('loading-detail').textContent = result.error.message;
          app.$('cancel-loading').textContent = 'Zavřít';
        }
        app.$('loading-help').textContent =
          'Dokončené soubory zůstávají uložené v prohlížeči. Výběr roků můžete znovu otevřít v levém panelu.';
        app.renderTransfers();
      } else app.$('loading-dialog').close();
    }
    return result;
  }
  function cancelOperation() {
    if (!app.busy) {
      app.$('loading-dialog').close();
      return;
    }
    app.operationController?.abort();
    if (app.workerPending.size) app.stopWorker(app.abortError());
  }
  return {
    abortError,
    checkAbort,
    setTransferTasks,
    renderTransfers,
    transferStatus,
    startYearTransfer,
    progress,
    runOperation,
    cancelOperation,
  };
}
