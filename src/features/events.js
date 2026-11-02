import { CsuPlaces } from '../core/places.js';

export function createEvents(app) {
  function bindEvents() {
    document.querySelector('.skip-link').onclick = (event) => {
      event.preventDefault();
      app.$('main').focus();
      app.$('main').scrollIntoView();
    };
    app.$('brand').onclick = (event) => {
      event.preventDefault();
      app.switchView('overview');
    };
    app.$('about-button').onclick = () => app.$('about-dialog').showModal();
    app.$('storage-button').onclick = () => app.openYearPicker();
    app.$('storage-mobile').onclick = app.$('storage-button').onclick;
    app.$('bulk-places').onclick = app.openBulkPicker;
    app.$('clear-places').onclick = () => {
      app.visiblePlaceLimit = 12;
      app.changePlaces([]);
    };
    app.$('more-places').onclick = () => {
      app.visiblePlaceLimit += 50;
      app.renderSelection();
    };
    for (const input of document.querySelectorAll('[name="bulk-scope"]'))
      input.onchange = () => {
        app.bulkSelected.clear();
        app.$('bulk-search').value = '';
        app.renderBulkGroups();
      };
    app.$('bulk-search').oninput = app.renderBulkGroups;
    app.$('bulk-options').onchange = (event) => {
      const input = event.target.closest('[data-bulk-group]');
      if (!input) return;
      if (input.checked) app.bulkSelected.add(input.dataset.bulkGroup);
      else app.bulkSelected.delete(input.dataset.bulkGroup);
      app.updateBulkSummary();
    };
    app.$('bulk-action').onchange = app.updateBulkSummary;
    app.$('bulk-select-visible').onclick = () => {
      for (const checkbox of app.$('bulk-options').querySelectorAll('[data-bulk-group]'))
        app.bulkSelected.add(checkbox.dataset.bulkGroup);
      app.renderBulkGroups();
    };
    app.$('bulk-clear').onclick = () => {
      app.bulkSelected.clear();
      app.renderBulkGroups();
    };
    app.$('bulk-apply').onclick = () => {
      const next = CsuPlaces.merge(
        app.state.places,
        app.bulkIncoming(),
        app.$('bulk-action').value === 'replace',
      );
      app.$('bulk-dialog').close();
      app.visiblePlaceLimit = 12;
      app.changePlaces(next);
    };
    app.$('skip-years').onclick = () => app.$('storage-dialog').close();
    app.$('storage-dialog').addEventListener('close', app.finishStartup);
    app.$('download-years').onclick = app.prepareSelectedYears;
    for (const button of document.querySelectorAll('[data-years-preset]'))
      button.onclick = () => {
        const preset = button.dataset.yearsPreset;
        app.selectedYears = new Set(
          preset === 'saved'
            ? app.cacheEntries.map((entry) => entry.year)
            : preset === 'recent'
              ? Array.from(
                  {
                    length: Math.min(5, app.latest - 1999),
                  },
                  (_, index) => app.latest - index,
                )
              : preset === 'all'
                ? Array.from(
                    {
                      length: app.latest - 1999,
                    },
                    (_, index) => app.latest - index,
                  )
                : [],
        );
        app.updateYearSelection();
      };
    app.$('storage-list').onchange = (event) => {
      const input = event.target.closest('[data-pick-year]');
      if (!input) return;
      const year = Number(input.dataset.pickYear);
      if (input.checked) app.selectedYears.add(year);
      else app.selectedYears.delete(year);
      app.updateYearSelection();
    };
    for (const button of document.querySelectorAll('.close-dialog'))
      button.onclick = () => button.closest('dialog').close();
    for (const dialog of document.querySelectorAll('dialog:not(#loading-dialog)'))
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            dialog.close();
        }
      });
    app.$('cancel-loading').onclick = app.cancelOperation;
    app.$('loading-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      app.cancelOperation();
    });
    app.$('start-button').onclick = () => {
      app.$('place-search').focus();
      app.$('place-search').scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    };
    app.$('place-search').addEventListener('input', app.renderSearch);
    app.$('place-search').addEventListener('focus', app.renderSearch);
    app.$('place-search').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        app.$('place-results').classList.add('hidden');
        app.$('place-search').setAttribute('aria-expanded', 'false');
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        app.$('place-results').querySelector('button')?.focus();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        app.$('place-results').querySelector('button')?.click();
      }
    });
    app.$('place-results').addEventListener('keydown', (event) => {
      const buttons = [...app.$('place-results').querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[Math.min(buttons.length - 1, index + 1)]?.focus();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (index === 0) app.$('place-search').focus();
        else buttons[index - 1]?.focus();
      }
      if (event.key === 'Escape') {
        app.$('place-search').focus();
        app.$('place-results').classList.add('hidden');
        app.$('place-search').setAttribute('aria-expanded', 'false');
      }
    });
    app.$('district-filter').onchange = app.renderSearch;
    app.$('place-results').onclick = (event) => {
      const button = event.target.closest('[data-code]');
      if (button) app.changePlaces([...app.state.places, button.dataset.code]);
    };
    app.$('selected-places').onclick = (event) => {
      const button = event.target.closest('[data-remove]');
      if (button)
        app.changePlaces(app.state.places.filter((code) => code !== button.dataset.remove));
    };
    app.$('year-select').onchange = () => {
      app.state.year = Number(app.$('year-select').value);
      app.activeSlice = app.validSlice(app.state.year);
      app.renderSelection();
      app.renderSearch();
      app.renderData();
      app.saveHash();
    };
    app.$('load-year').onclick = () => app.loadCurrentYear();
    app.$('refresh-year').onclick = () => app.loadCurrentYear(true);
    for (const button of document.querySelectorAll('[data-view]')) {
      button.onclick = () => app.switchView(button.dataset.view);
      button.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...document.querySelectorAll('[data-view]')];
        const index = buttons.indexOf(button);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click();
        buttons[next].focus();
      };
    }
    app.$('indicator-search').oninput = app.filterOverview;
    app.$('topic-filter').onchange = app.filterOverview;
    app.$('available-only').onchange = app.filterOverview;
    for (const view of ['compare', 'history']) {
      app.$(`${view}-indicator-search`).oninput = () => app.renderIndicatorOptions(view);
      app.$(`${view}-show-empty`).onchange = () => app.renderIndicatorOptions(view);
    }
    app.$('compare-indicator').onchange = () =>
      app.selectIndicator(app.$('compare-indicator').value);
    app.$('history-indicator').onchange = () =>
      app.selectIndicator(app.$('history-indicator').value);
    app.$('compare-normalize').onchange = () => {
      app.state.normalize = app.$('compare-normalize').value;
      app.saveHash();
      app.renderCompare();
    };
    app.$('history-mode').onchange = () => {
      app.state.mode = app.$('history-mode').value;
      app.saveHash();
      app.renderHistory();
    };
    app.$('history-series-limit').onchange = app.renderHistory;
    app.$('history-from').onchange = app.$('history-to').onchange = () => {
      app.state.from = Number(app.$('history-from').value);
      app.state.to = Number(app.$('history-to').value);
      app.saveHash();
      if (app.state.view === 'history' && app.activeSlice) app.renderHistory();
    };
    app.$('load-history').onclick = app.loadHistory;
    app.$('export-overview').onclick = app.exportOverview;
    app.$('export-compare').onclick = app.exportCompare;
    app.$('export-history').onclick = app.exportHistory;
    app.$('download-compare').onclick = () =>
      app.downloadChart(
        app.compareChart,
        `csustats-${app.state.year}-${app.state.indicator}.png`,
        app.$('compare-title').textContent,
        app.$('compare-subtitle').textContent,
      );
    app.$('download-history').onclick = () =>
      app.downloadChart(
        app.historyChart,
        `csustats-${app.state.from}-${app.state.to}-${app.state.indicator}.png`,
        app.$('history-title').textContent,
        app.$('history-subtitle').textContent,
      );
    app.$('share-button').onclick = async () => {
      app.saveHash();
      try {
        await navigator.clipboard.writeText(location.href);
        app.toast(
          location.protocol === 'file:'
            ? 'Adresa zkopírována. Příjemce potřebuje vlastní kopii HTML; přeneste část adresy od #.'
            : 'Odkaz s aktuálním výběrem zkopírován.',
        );
      } catch {
        app.toast('Zkopírujte adresu stránky z adresního řádku; obsahuje váš výběr.');
      }
    };
    app.$('storage-list').onclick = async (event) => {
      const button = event.target.closest('[data-delete-year]');
      if (button) await app.removeYear(Number(button.dataset.deleteYear));
    };
    app.$('clear-cache').onclick = async () => {
      for (const entry of await app.getCacheEntries()) await app.cacheRemove(entry.key);
      app.slices.clear();
      app.activeSlice = null;
      app.stopWorker();
      await app.updateCacheSummary();
      await app.renderStorage();
      app.renderData();
      app.renderSelection();
      app.toast('Stažené roky byly odstraněny. Číselníky a výběr obcí zůstávají.');
    };
    window.addEventListener('resize', () => {
      app.compareChart?.resize();
      app.historyChart?.resize();
    });
    window.addEventListener('hashchange', () => {
      if (app.busy) return;
      app.readHash();
      app.state.places = app.state.places.filter((code) => app.territories.has(code));
      if (!app.indicators.has(app.state.indicator)) app.state.indicator = app.POPULATION;
      app.populateYears();
      app.populateIndicators();
      app.renderSelection();
      app.updateView();
      app.activeSlice = app.validSlice(app.state.year);
      app.renderData();
      if (!app.activeSlice && app.state.places.length) app.loadCurrentYear();
    });
  }
  return { bindEvents };
}
