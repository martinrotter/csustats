import test from 'node:test';
import assert from 'node:assert/strict';
import { Workbench } from '../src/app/workbench.js';
import { setLanguage, getLanguage } from '../src/i18n/index.js';
import { makeCube } from '../src/core/cube.js';

function appFixture({ fail = false, local = false } = {}) {
  const cube = makeCube({
    dimensions: [
      {
        id: 'geo',
        label: 'User label',
        categories: [{ id: '001', label: 'Original source label' }],
      },
    ],
    values: [42],
    metadata: { generatedLocalSource: local },
  });
  const oldDescriptor = {
    id: local ? 'import' : 'csu:TEST',
    dimensions: [{ id: 'geo', categories: [{ id: '001' }, { id: '002' }] }],
  };
  const fields = new Map();
  const app = {
    busy: false,
    descriptor: oldDescriptor,
    cube,
    source: { id: 'original' },
    selections: { geo: ['002'] },
    loadedSelection: JSON.stringify({ geo: ['001'] }),
    $: (id) => {
      if (!fields.has(id))
        fields.set(id, { value: 'cs', getAttribute: () => (id === 'tab-table' ? 'true' : null) });
      return fields.get(id);
    },
    storage: {
      setItem: (key, value) => {
        app.stored = { key, value };
      },
    },
    applyStaticUi() {
      this.uiLanguage = getLanguage();
    },
    networkEvent() {},
    message(text, error) {
      this.notice = { text, error };
    },
    catalog: { render() {}, load() {} },
    sources: { builtins: [] },
    dimensions: { render() {} },
    state() {
      return {
        id: this.descriptor.id,
        language: getLanguage(),
        selections: this.selections,
        chart: { type: 'line', fixed: { geo: '001' } },
      };
    },
    renderDescriptor() {},
    saveState() {
      this.saved = this.state();
    },
    async run(_title, task) {
      return task();
    },
    async chooseDataset(id, saved) {
      assert.equal(
        saved.language,
        getLanguage(),
        'Never re-enter the old language while rebuilding metadata',
      );
      assert.deepEqual(
        saved.selections,
        { geo: ['001'] },
        'Load the previously displayed data before restoring unsubmitted filters',
      );
      this.descriptor = { ...oldDescriptor, language: getLanguage() };
      this.cube = null;
      this.selections = saved.selections;
      return true;
    },
    async load() {
      if (!fail) {
        this.cube = { ...cube };
        this.loadedSelection = JSON.stringify(this.selections);
      }
    },
    results: {
      async accept(value, chart) {
        app.reaccepted = { value, chart };
      },
      showPane(pane) {
        app.pane = pane;
      },
    },
  };
  return { app, cube, oldDescriptor };
}

test('language switching preserves the displayed slice, unsubmitted filters, chart configuration and active result pane', async () => {
  try {
    setLanguage('cs');
    const { app, cube } = appFixture();
    await Workbench.prototype.changeLanguage.call(app, 'en');
    assert.equal(getLanguage(), 'en');
    assert.deepEqual([...app.cube.values], [...cube.values]);
    assert.deepEqual(app.selections, { geo: ['002'] });
    assert.equal(app.loadedSelection, JSON.stringify({ geo: ['001'] }));
    assert.equal(app.pane, 'table');
    assert.equal(app.stored.value, 'en');
    assert.equal(app.saved.language, 'en');
  } finally {
    setLanguage('cs');
  }
});

test('a shared view changes the current language without overwriting the saved manual preference', async () => {
  try {
    setLanguage('cs');
    const { app } = appFixture();
    app.stored = { key: 'narodni-data:language', value: 'cs' };
    await Workbench.prototype.changeLanguage.call(app, 'en', {
      id: 'csu:TEST',
      language: 'en',
      selections: { geo: ['001'] },
    });
    assert.equal(getLanguage(), 'en');
    assert.equal(app.saved.language, 'en');
    assert.equal(app.stored.value, 'cs');
  } finally {
    setLanguage('cs');
  }
});

test('a failed translated-data refresh restores the prior data and reports the source-label fallback in the new UI language', async () => {
  try {
    setLanguage('cs');
    const { app, cube, oldDescriptor } = appFixture({ fail: true });
    await Workbench.prototype.changeLanguage.call(app, 'en');
    assert.equal(app.cube, cube);
    assert.equal(app.descriptor, oldDescriptor);
    assert.deepEqual(app.selections, { geo: ['002'] });
    assert.equal(app.reaccepted.value, cube);
    assert.deepEqual(app.reaccepted.chart, { type: 'line', fixed: { geo: '001' } });
    assert(app.notice.error && app.notice.text.startsWith('Translated data could not be loaded'));
    assert.equal(app.uiLanguage, 'en');
  } finally {
    setLanguage('cs');
  }
});

test('local-file language changes keep user labels and values and refresh generated UI labels without a data request', async () => {
  try {
    setLanguage('cs');
    const { app, cube } = appFixture({ local: true });
    app.chooseDataset = () => assert.fail('Local data must not trigger remote metadata loading');
    await Workbench.prototype.changeLanguage.call(app, 'en');
    assert.equal(app.cube, cube);
    assert.equal(app.cube.source, 'Local file');
    assert.equal(app.cube.dimensions[0].label, 'User label');
    assert.equal(app.cube.dimensions[0].categories[0].label, 'Original source label');
    assert.deepEqual([...app.cube.values], [42]);
    assert.equal(app.reaccepted.value, cube);
  } finally {
    setLanguage('cs');
  }
});
