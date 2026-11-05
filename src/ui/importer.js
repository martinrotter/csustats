import { t, getLocale } from '../i18n/index.js';
import { parseNumber } from '../data/tabular.js';

export class Importer {
  constructor(app) {
    this.app = app;
    app.$('choose-import-file').addEventListener('click', () => app.$('import-file').click());
    app.$('import-file').addEventListener('change', () => this.read());
    app.$('import-encoding').addEventListener('change', () => {
      if (app.$('import-file').files[0]) this.read();
    });
    app.$('import-apply').addEventListener('click', () => this.apply());
  }
  open() {
    this.app.$('dataset-dialog').close();
    this.app.$('import-dialog').showModal();
  }
  async read() {
    const app = this.app,
      { $ } = app,
      file = $('import-file').files[0];
    if (!file) return;
    $('import-filename').textContent = file.name;
    if (file.size > 20 * 1024 * 1024) {
      app.message(t('Soubor překračuje limit 20 MB.'), true);
      return;
    }
    this.title = file.name.replace(/\.[^.]+$/, '');
    const result = await app.run(t('Otevírám soubor'), async (signal) => {
      const text = new TextDecoder($('import-encoding').value, { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      let data;
      const isJson = /\.json(?:stat)?$/i.test(file.name) || /^[\s\uFEFF]*[\[{]/.test(text);
      if (isJson) {
        data = JSON.parse(text.replace(/^\uFEFF/, ''));
        if (
          data &&
          app.sources.resolve(data.id) &&
          data.selections &&
          typeof data.selections === 'object'
        )
          return { view: data };
        if (
          data.class === 'dataset' ||
          data.class === 'collection' ||
          data.dimension ||
          Object.values(data).some((item) => item && typeof item === 'object' && item.dimension)
        ) {
          const cube = await app.processor.request({ type: 'parse-jsonstat', text }, { signal });
          if (!cube.source) {
            cube.source = t`Místní soubor · ${file.name}`;
            cube.metadata.generatedLocalSource = true;
            cube.metadata.localFileName = file.name;
          }
          return { cube };
        }
      }
      return {
        table: await app.processor.request(
          { type: 'parse-table', text, format: isJson ? 'json' : 'csv' },
          { signal },
        ),
      };
    });
    if (!result) return;
    if (result.view) {
      $('import-dialog').close();
      await app.chooseDataset(result.view.id, result.view);
      return;
    }
    if (result.cube) {
      $('import-dialog').close();
      await app.acceptImport(result.cube, this.title);
      return;
    }
    this.table = result.table;
    $('import-mapping').hidden = false;
    $('import-preview').textContent =
      t`${this.table.rows.length.toLocaleString(getLocale())} řádků · ${this.table.fields.length} sloupců

${this.table.fields.join(' | ')}
${this.table.rows
  .slice(0, 4)
  .map((row) => this.table.fields.map((key) => String(row[key] ?? '')).join(' | '))
  .join('\n')}`;
    const options = this.table.fields.map((field) => {
      const item = document.createElement('option');
      item.value = field;
      item.textContent = field;
      return item;
    });
    for (const id of ['import-value', 'import-category', 'import-time']) {
      $(id).replaceChildren(...options.map((item) => item.cloneNode(true)));
    }
    for (const id of ['import-category', 'import-time']) {
      const item = document.createElement('option');
      item.value = '';
      item.textContent = t('Bez této dimenze');
      $(id).prepend(item);
    }
    const time = this.table.fields.find((field) =>
      /^(rok|year|datum|date|obdobi|time)$/i.test(field),
    );
    const namedValue = this.table.fields.find((field) =>
      /^(hodnota|value|pocet|počet|amount)$/i.test(field),
    );
    const numeric =
      namedValue ||
      this.table.fields.find(
        (field) =>
          field !== time &&
          this.table.rows.slice(0, 50).some((row) => parseNumber(row[field]) !== null),
      );
    $('import-value').value = numeric || this.table.fields.at(-1);
    $('import-time').value = time || '';
    $('import-category').value =
      this.table.fields.find((field) => field !== time && field !== $('import-value').value) || '';
  }
  async apply() {
    const app = this.app,
      { $ } = app;
    if (!this.table) return;
    const mapping = {
      title: this.title,
      value: $('import-value').value,
      unit: $('import-unit').value,
      dimensions: [
        [$('import-category').value, 'category'],
        [$('import-time').value, 'time'],
      ]
        .filter(([id]) => id)
        .map(([id, role]) => ({ id, role })),
    };
    const cube = await app.run(t('Zpracovávám tabulku'), (signal) =>
      app.processor.request({ type: 'cube-table', table: this.table, mapping }, { signal }),
    );
    if (!cube) return;
    $('import-dialog').close();
    await app.acceptImport(cube, this.title);
  }
}
