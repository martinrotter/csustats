import { Papa } from '../lib/browser-libraries.js';

export function createExports(app) {
  function saveDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function exportCSV(rows, filename) {
    if (!rows.length) {
      app.toast('Nejdříve načtěte data.');
      return;
    }
    const csv = Papa.unparse(rows, {
      delimiter: ';',
      newline: '\r\n',
      escapeFormulae: true,
    });
    app.saveDownload(
      new Blob(['\uFEFF', csv], {
        type: 'text/csv;charset=utf-8',
      }),
      filename,
    );
    app.toast('Export CSV je připravený ke stažení.');
  }
  function exportOverview() {
    if (!app.overviewTable) return;
    const rows = app.overviewTable.getData('active').map((row) => {
      const result = {
        Rok: app.state.year,
        'Kód ukazatele': row.code,
        Ukazatel: row.name,
        Okruh: row.topic,
        Jednotka: row.unit,
      };
      app.state.places.forEach((code) => {
        result[app.qualifiedPlace(code)] = app.rawValue(app.activeSlice, row.code, code) ?? '';
      });
      result.Zdroj = 'ČSÚ – databáze MOS';
      return result;
    });
    app.exportCSV(rows, `csustats-prehled-${app.state.year}.csv`);
  }
  function exportCompare() {
    app.exportCSV(
      app.compareRows.map((row) => ({
        Rok: app.state.year,
        'Kód obce': row.code,
        Obec: row.name,
        Okres: row.district,
        'Kód ukazatele': app.state.indicator,
        Ukazatel: app.indicators.get(app.state.indicator).nazev,
        Hodnota: row.value ?? '',
        Jednotka: app.unitLabel(app.state.indicator, app.state.normalize),
        'Původní hodnota': row.original ?? '',
        Zdroj: 'ČSÚ – databáze MOS',
      })),
      `csustats-porovnani-${app.state.year}-${app.state.indicator}.csv`,
    );
  }
  function exportHistory() {
    const rows = [];
    for (const row of app.historyRows)
      for (const code of app.state.places)
        rows.push({
          Rok: row.year,
          'Kód obce': code,
          Obec: app.placeLabel(code, row.year),
          'Kód ukazatele': app.state.indicator,
          Ukazatel: app.indicators.get(app.state.indicator).nazev,
          Hodnota: row[`v${code}`] ?? '',
          Jednotka: app.unitLabel(app.state.indicator, app.state.mode),
          Stav: row.loaded ? 'Načteno' : 'Nenačteno',
          Zdroj: 'ČSÚ – databáze MOS',
        });
    app.exportCSV(
      rows,
      `csustats-vyvoj-${app.state.from}-${app.state.to}-${app.state.indicator}.csv`,
    );
  }
  async function downloadChart(chart, filename, title, subtitle) {
    if (!chart) return;
    try {
      // Include the context in the exported image, not only the plot.
      const svg = chart.renderToSVGString();
      const image = new Image();
      const url = URL.createObjectURL(
        new Blob([svg], {
          type: 'image/svg+xml;charset=utf-8',
        }),
      );
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = url;
        });
        const width = chart.getWidth();
        const height = chart.getHeight();
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = (height + 104) * 2;
        const context = canvas.getContext('2d');
        context.scale(2, 2);
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height + 104);
        context.fillStyle = '#243c2f';
        context.font = '600 16px Segoe UI, Arial';
        context.fillText(title, 18, 28, width - 36);
        context.fillStyle = '#75866c';
        context.font = '11px Segoe UI, Arial';
        context.fillText(subtitle, 18, 50, width - 36);
        context.drawImage(image, 0, 65, width, height);
        context.fillText('Zdroj: ČSÚ · databáze MOS | CsuStats', 18, height + 91);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Export obrázku není dostupný.');
        app.saveDownload(blob, filename);
        app.toast('Graf je připravený ke stažení.');
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      app.toast('Graf se nepodařilo exportovat. Zkuste export tabulky do CSV.');
    }
  }
  return { saveDownload, exportCSV, exportOverview, exportCompare, exportHistory, downloadChart };
}
