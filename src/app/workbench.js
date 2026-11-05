import {
  t,
  getLanguage,
  setLanguage,
  normalizeLanguage,
  preferredLanguage,
  captureStaticUi,
  translateMessage,
  errorText,
} from '../i18n/index.js';
import { ApiClient, RateGate } from '../core/http.js';
import { subsetCube, localizeGeneratedLabels } from '../core/cube.js';
import { DataCache } from '../data/cache.js';
import { DataStatSource } from '../data/datastat.js';
import { SourceRegistry } from '../data/sources.js';
import { Processor } from '../data/processor.js';
import { Transfers } from '../ui/transfers.js';
import { Catalog } from '../ui/catalog.js';
import { Dimensions } from '../ui/dimensions.js';
import { Results, download } from '../ui/results.js';
import { Utilities } from '../ui/utilities.js';
import { Importer } from '../ui/importer.js';

export class Workbench {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.descriptor = null;
    this.selections = {};
    this.cube = null;
    this.busy = false;
    this.operation = null;
    let storage;
    try {
      storage = localStorage;
      storage.setItem('narodni-data:probe', '1');
      storage.removeItem('narodni-data:probe');
    } catch {
      storage = null;
    }
    this.storage = storage;
    let storedLanguage;
    try {
      storedLanguage = storage?.getItem('narodni-data:language');
    } catch {
      /* Optional preference. */
    }
    setLanguage(
      preferredLanguage(location.hash, storedLanguage, [
        ...(navigator.languages || []),
        navigator.language,
      ]),
    );
    this.applyStaticUi = captureStaticUi();
    this.applyStaticUi();
    this.$('language-select').value = getLanguage();
    this.client = new ApiClient({
      gate: new RateGate({ storage, locks: navigator.locks }),
      onEvent: (event) => this.networkEvent(event),
    });
    this.cache = new DataCache({ onWarning: (text) => this.toast(text) });
    this.processor = new Processor(this.$('worker-source').textContent);
    this.datastat = new DataStatSource({
      client: this.client,
      cache: this.cache,
      processor: this.processor,
    });
    this.sources = new SourceRegistry({
      datastat: this.datastat,
      client: this.client,
      cache: this.cache,
      processor: this.processor,
      lookups: JSON.parse(this.$('region-data').textContent),
    });
    this.transfers = new Transfers(this);
    this.catalog = new Catalog(this);
    this.dimensions = new Dimensions(this);
    this.results = new Results(this);
    this.utilities = new Utilities(this);
    this.importer = new Importer(this);
    this.bind();
  }
  bind() {
    this.$('language-select').addEventListener('change', (event) =>
      this.changeLanguage(event.target.value),
    );
    for (const id of ['choose-dataset', 'change-dataset'])
      this.$(id).addEventListener('click', () => {
        if (!this.busy) this.catalog.open();
      });
    this.$('start-csu').addEventListener('click', () => this.catalog.open('datastat'));
    this.$('start-territory').addEventListener('click', () => {
      this.$('catalog-municipal').checked = true;
      this.catalog.open();
    });
    for (const id of ['start-import', 'import-button'])
      this.$(id).addEventListener('click', () => this.importer.open());
    this.$('load-data').addEventListener('click', () => this.load());
    this.$('refresh-data').addEventListener('click', () => this.load(true));
    this.$('filters-toggle').addEventListener('click', () => {
      const open = this.$('sidebar').classList.toggle('is-open');
      this.$('filters-toggle').setAttribute('aria-expanded', String(open));
    });
    this.$('share-button').addEventListener('click', () => this.share());
    this.$('home-link').addEventListener('click', (event) => {
      event.preventDefault();
      this.catalog.open();
    });
    document.addEventListener('click', (event) =>
      event.target.closest('[data-close]')?.closest('dialog')?.close(),
    );
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!this.busy) this.catalog.open();
      }
    });
    window.addEventListener('hashchange', () => {
      if (!this.busy) {
        const saved = this.readHash();
        if (saved) {
          if (saved.language && saved.language !== getLanguage())
            this.changeLanguage(saved.language, saved);
          else this.chooseDataset(saved.id, saved);
        }
      }
    });
    window.addEventListener('beforeunload', () => {
      this.operation?.abort();
      this.processor.stop();
    });
  }
  async changeLanguage(value, linkedView = null) {
    const language = normalizeLanguage(value);
    if (this.busy || this.changingLanguage || language === getLanguage()) {
      this.$('language-select').value = getLanguage();
      return;
    }
    this.changingLanguage = true;
    this.$('language-select').disabled = true;
    try {
      const previous = this.state(),
        wasLoaded = !!this.cube;
      const backup = {
        descriptor: this.descriptor,
        source: this.source,
        cube: this.cube,
        selections: this.selections,
        loadedSelection: this.loadedSelection,
      };
      const loadedSelections = this.loadedSelection ? JSON.parse(this.loadedSelection) : null;
      const pane = this.$('tab-table').getAttribute('aria-selected') === 'true' ? 'table' : 'chart';
      setLanguage(language);
      try {
        if (!linkedView) this.storage?.setItem('narodni-data:language', language);
      } catch {
        /* Optional preference. */
      }
      this.applyStaticUi();
      this.$('language-select').value = language;
      this.$('toast').hidden = true;
      this.message('');
      this.networkEvent({ phase: 'ready' });
      this.catalog.items = [...this.sources.builtins];
      this.catalog.render();
      if (this.descriptor?.id === 'import' && !linkedView) {
        this.descriptor.source = t('Místní soubor');
        this.descriptor.description = t(
          'Soubor zpracovaný v tomto prohlížeči. Data nejsou odeslaná do sítě.',
        );
        localizeGeneratedLabels(this.cube);
        localizeGeneratedLabels(this.importCube);
        this.renderDescriptor();
        await this.run(t('Připravuji graf a tabulku'), () =>
          this.results.accept(this.cube, previous.chart),
        );
        this.results.showPane(pane);
      } else if (linkedView || this.descriptor) {
        const saved = {
          ...(linkedView || previous),
          language,
          selections: linkedView?.selections || loadedSelections || previous.selections,
        };
        const ready = await this.chooseDataset(saved.id, saved);
        if (ready && wasLoaded) {
          await this.load();
          if (this.cube && !linkedView) {
            for (const dim of this.descriptor.dimensions) {
              const known = new Set((dim.allCategories || dim.categories).map((item) => item.id));
              this.selections[dim.id] = (previous.selections[dim.id] || []).filter((id) =>
                known.has(id),
              );
            }
            this.dimensions.render();
          }
          this.results.showPane(pane);
        }
        if (!ready || (wasLoaded && !this.cube)) {
          Object.assign(this, backup);
          this.renderDescriptor();
          if (this.cube) {
            await this.run(t('Připravuji graf a tabulku'), () =>
              this.results.accept(this.cube, previous.chart),
            );
            this.results.showPane(pane);
          }
          this.dimensions.render();
          this.message(
            t(
              'Po změně jazyka se nepodařilo načíst překlady dat. Zobrazené názvy pocházejí z předchozího jazyka.',
            ),
            true,
          );
        }
      } else document.title = t('Národní data · Průzkumník otevřených dat');
      this.saveState();
      this.catalog.load();
    } finally {
      this.changingLanguage = false;
      this.$('language-select').disabled = this.busy;
      for (const id of ['choose-dataset', 'change-dataset']) this.$(id).disabled = this.busy;
    }
  }
  toast(text) {
    clearTimeout(this.toastTimer);
    this.$('toast').textContent = translateMessage(text);
    this.$('toast').hidden = false;
    this.toastTimer = setTimeout(() => {
      this.$('toast').hidden = true;
    }, 6500);
  }
  message(text, error = false) {
    this.$('message').textContent = translateMessage(text);
    this.$('message').hidden = !text;
    this.$('message').classList.toggle('error', error);
  }
  networkEvent(event) {
    const status = this.$('network-button');
    const paused = this.client.gate.read().pauseUntil > Date.now();
    status.classList.toggle('waiting', event.phase === 'waiting' || paused);
    status.classList.toggle('error', event.phase === 'error');
    this.$('network-label').textContent = paused
      ? t('API čeká na obnovení')
      : event.phase === 'waiting'
        ? t('Šetrná fronta API')
        : ['request', 'response', 'receiving'].includes(event.phase)
          ? t('Načítám z API')
          : event.phase === 'error'
            ? `HTTP ${event.status || t('síť')}`
            : t('API připraveno');
    if (this.$('network-dialog').open) this.utilities.network();
  }
  async run(title, task, files = []) {
    if (this.busy) {
      this.toast(t('Nejdříve dokončete nebo zrušte probíhající načítání.'));
      return null;
    }
    this.busy = true;
    this.$('language-select').disabled = true;
    this.operation = new AbortController();
    this.message('');
    this.transfers.open(title, files);
    this.dimensions.render();
    for (const id of ['choose-dataset', 'change-dataset']) this.$(id).disabled = true;
    let failure;
    try {
      return await task(this.operation.signal, (event) => this.transfers.update(event));
    } catch (error) {
      failure = error;
      this.message(
        error.name === 'AbortError'
          ? t('Operace byla zrušena. Dříve uložená data zůstávají v cache.')
          : errorText(error),
        error.name !== 'AbortError',
      );
      return null;
    } finally {
      this.busy = false;
      this.$('language-select').disabled = !!this.changingLanguage;
      this.operation = null;
      this.transfers.finish(failure);
      this.dimensions.render();
      for (const id of ['choose-dataset', 'change-dataset'])
        this.$(id).disabled = !!this.changingLanguage;
    }
  }
  async chooseDataset(id, saved = null) {
    if (!this.busy && saved?.language && normalizeLanguage(saved.language) !== getLanguage())
      return this.changeLanguage(saved.language, saved);
    const source = this.sources.resolve(id);
    if (this.busy || !source) return;
    this.$('dataset-dialog').close();
    const result = await this.run(t('Připravuji datovou sadu'), async (signal, onProgress) => {
      const descriptor = await source.descriptor({ signal, onProgress });
      if (saved?.variants && descriptor.variants)
        for (const [type, code] of Object.entries(saved.variants))
          if (descriptor.variants.get(type)?.some((item) => item.id === code))
            descriptor.selectedVariants[type] = code;
      if (Array.isArray(saved?.types) && descriptor.variants)
        descriptor.activeTypes = [
          ...new Set([...(descriptor.requiredTypes || []), ...saved.types]),
        ].filter((type) => descriptor.variants.has(type));
      const defaults = await source.prepare(descriptor, { signal, onProgress });
      const selections = { ...defaults };
      if (saved?.selections)
        for (const dim of descriptor.dimensions) {
          const known = new Set((dim.allCategories || dim.categories).map((item) => item.id));
          if (Array.isArray(saved.selections[dim.id]))
            selections[dim.id] = [...new Set(saved.selections[dim.id].map(String))].filter((code) =>
              known.has(code),
            );
        }
      return { descriptor, selections };
    });
    if (!result) return false;
    this.descriptor = result.descriptor;
    this.source = source;
    this.selections = result.selections;
    this.cube = null;
    this.loadedSelection = null;
    this.pendingChart = saved?.chart;
    this.results.clear();
    this.renderDescriptor();
    this.dimensions.render();
    this.saveState();
    const initial = this.descriptor.dimensions.find(
      (dim) => dim.role === this.descriptor.initialPickerRole,
    );
    if (!saved && initial) await this.dimensions.open(initial.id);
    if (window.innerWidth < 760) {
      this.$('sidebar').classList.add('is-open');
      this.$('filters-toggle').setAttribute('aria-expanded', 'true');
    }
    return true;
  }
  renderDescriptor() {
    const { descriptor, $ } = this;
    $('dataset-source').textContent = descriptor.source;
    $('dataset-title').textContent = descriptor.title;
    $('mobile-dataset').textContent = descriptor.title;
    $('dataset-description').textContent = String(descriptor.description || '').replace(
      /<[^>]*>/g,
      '',
    );
    if (descriptor.originalLanguage && descriptor.originalLanguage !== getLanguage())
      $('dataset-description').textContent +=
        ' ' + t('CSV zdroj poskytuje názvy a metodiku v původním jazyce.');
    $('dataset-source-link').hidden = !descriptor.url;
    if (descriptor.url) $('dataset-source-link').href = descriptor.url;
    document.title = t`${descriptor.title} · Národní data`;
  }
  async changeVariant(type, code) {
    if (this.busy || !this.descriptor?.variants?.get(type)?.some((item) => item.id === code))
      return;
    const previous = { ...this.selections };
    const old = this.descriptor.selectedVariants[type];
    const descriptor = {
      ...this.descriptor,
      selectedVariants: { ...this.descriptor.selectedVariants, [type]: code },
    };
    const defaults = await this.run(t('Načítám nové členění'), (signal, onProgress) =>
      this.source.prepare(descriptor, { signal, onProgress }),
    );
    if (!defaults) {
      this.descriptor.selectedVariants[type] = old;
      this.dimensions.render();
      return;
    }
    this.descriptor = descriptor;
    this.selections = Object.fromEntries(
      descriptor.dimensions.map((dim) => [dim.id, previous[dim.id] || defaults[dim.id]]),
    );
    this.dimensions.render();
    this.saveState();
  }
  async changeDimensionType(type, add) {
    if (this.busy || !this.descriptor?.variants?.has(type)) return;
    if (!add && this.descriptor.requiredTypes?.includes(type)) return;
    const activeTypes = new Set(this.descriptor.activeTypes);
    if (add) activeTypes.add(type);
    else activeTypes.delete(type);
    const descriptor = { ...this.descriptor, activeTypes: [...activeTypes] };
    const defaults = await this.run(t('Upravuji členění dat'), (signal, onProgress) =>
      this.source.prepare(descriptor, { signal, onProgress }),
    );
    if (!defaults) return;
    const previous = this.selections;
    this.descriptor = descriptor;
    this.selections = Object.fromEntries(
      descriptor.dimensions.map((dim) => [dim.id, previous[dim.id] || defaults[dim.id]]),
    );
    this.dimensions.render();
    this.saveState();
  }
  async load(force = false) {
    if (!this.descriptor) return;
    const entries = await this.cache.entries();
    const files =
      this.descriptor.id === 'import'
        ? []
        : this.source.files(this.descriptor, this.selections, entries, force);
    await this.run(
      t('Načítám vybraný výřez'),
      async (signal, onProgress) => {
        const cube =
          this.descriptor.id === 'import'
            ? subsetCube(this.importCube, this.selections)
            : await this.source.load(this.descriptor, this.selections, {
                signal,
                force,
                onProgress,
              });
        const previousCube = this.cube;
        const previousSelection = this.loadedSelection;
        this.cube = cube;
        this.loadedSelection = JSON.stringify(this.selections);
        try {
          await this.results.accept(cube, this.pendingChart);
        } catch (error) {
          this.cube = previousCube;
          this.loadedSelection = previousSelection;
          throw error;
        }
        this.pendingChart = null;
        this.saveState();
        this.$('sidebar').classList.remove('is-open');
        this.$('filters-toggle').setAttribute('aria-expanded', 'false');
      },
      files,
    );
    if (this.cube) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async acceptImport(cube, title) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* Optional URL cleanup. */
    }
    this.descriptor = {
      id: 'import',
      title: cube.title || title,
      source: t('Místní soubor'),
      dimensions: cube.dimensions,
      description: t('Soubor zpracovaný v tomto prohlížeči. Data nejsou odeslaná do sítě.'),
    };
    this.selections = Object.fromEntries(
      cube.dimensions.map((dim) => [dim.id, dim.categories.map((item) => item.id)]),
    );
    this.importCube = cube;
    this.cube = cube;
    this.loadedSelection = JSON.stringify(this.selections);
    this.renderDescriptor();
    await this.run(t('Připravuji graf a tabulku'), async () => this.results.accept(cube));
    this.dimensions.render();
    this.$('refresh-data').disabled = true;
  }
  state() {
    return {
      language: getLanguage(),
      id: this.descriptor?.id,
      selections: this.selections,
      variants: this.descriptor?.selectedVariants,
      types: this.descriptor?.activeTypes,
      chart: this.cube ? this.results.config() : this.pendingChart,
    };
  }
  saveState() {
    if (!this.descriptor || this.descriptor.id === 'import') return;
    const state = JSON.stringify(this.state());
    try {
      this.storage?.setItem('narodni-data:last-view:v1', state);
    } catch {
      /* Optional preference. */
    }
    if (state.length <= 50000) {
      try {
        history.replaceState(null, '', `#view=${encodeURIComponent(state)}`);
      } catch {
        /* Local-file URL handling varies. */
      }
    }
  }
  readHash() {
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has('view') && params.get('view').startsWith('{')) {
        const text = params.get('view');
        if (text.length > 60000) return null;
        const saved = JSON.parse(text);
        return saved && typeof saved === 'object' ? saved : null;
      }
      return this.sources.legacy(params);
    } catch {
      this.message(t('Odkaz obsahuje neplatnou definici výběru.'), true);
    }
    return null;
  }
  async share() {
    if (this.descriptor?.id === 'import') {
      this.toast(
        t('Místní soubor nelze sdílet samotným odkazem. Použijte export CSV nebo obrázku.'),
      );
      return;
    }
    const state = JSON.stringify(this.state());
    if (state.length > 50000) {
      download(new Blob([state], { type: 'application/json' }), t('narodni-data-vyber.json'));
      this.toast(t('Výběr je příliš velký pro odkaz. Uložena definice výběru.'));
      return;
    }
    this.saveState();
    try {
      await navigator.clipboard.writeText(location.href);
      this.toast(t('Odkaz na výběr je zkopírovaný. Příjemce načte data tlačítkem Načíst výběr.'));
    } catch {
      this.utilities.info(true);
      const input = document.createElement('input');
      input.value = location.href;
      input.setAttribute('aria-label', t('Odkaz na výběr'));
      this.$('info-content').prepend(input);
      input.select();
      this.toast(t('Zkopírujte označený odkaz.'));
    }
  }
  async start() {
    await this.cache.open();
    const saved = this.readHash();
    if (saved) await this.chooseDataset(saved.id, saved);
    this.catalog.load();
  }
}
