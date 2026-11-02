import { CsuTransfers } from '../core/transfers.js';
import { echarts } from '../lib/browser-libraries.js';

export function createCharts(app) {
  function chartBase() {
    return {
      backgroundColor: '#ffffff',
      color: app.COLORS,
      animationDuration: 350,
      textStyle: {
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: 11,
        color: '#6c806e',
      },
      aria: {
        enabled: true,
      },
      grid: {
        left: 12,
        right: 28,
        top: 25,
        bottom: 20,
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        valueFormatter: (value) => app.fmt(value),
      },
      xAxis: {
        axisLine: {
          lineStyle: {
            color: '#dce5d8',
          },
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: '#7e8e7a',
        },
      },
      yAxis: {
        splitLine: {
          lineStyle: {
            color: '#edf1e9',
            type: 'dashed',
          },
        },
        axisLabel: {
          formatter: (value) => app.fmt(value),
          color: '#7e8e7a',
        },
      },
    };
  }
  function warning(target, messages) {
    app.$(target).textContent = messages.join(' ');
    app.$(target).classList.toggle('hidden', !messages.length);
  }
  function renderCompare() {
    if (!app.activeSlice) return;
    app.renderIndicatorOptions('compare');
    app.normalizationControls();
    const item = app.indicators.get(app.state.indicator);
    const unit = app.unitLabel(app.state.indicator, app.state.normalize);
    app.$('compare-title').textContent = item.nazev;
    app.$('compare-subtitle').textContent =
      `${app.state.year} · ${unit}${app.state.places.length > 9 ? ` · výřez z ${app.state.places.length} obcí (graf lze posouvat)` : ''}`;
    app.compareRows = app.state.places.map((code, index) => ({
      code,
      name: app.placeLabel(code),
      displayName: app.displayPlace(code),
      district: app.area(code).okres,
      color: app.placeColor(index),
      value: app.transformedValue(app.activeSlice, app.state.indicator, code, app.state.normalize),
      original: app.rawValue(app.activeSlice, app.state.indicator, code),
    }));
    app.compareChart ||= echarts.init(app.$('compare-chart'), null, {
      renderer: 'svg',
    });
    const option = app.chartBase();
    option.grid = {
      left: 12,
      right: 55,
      top: 10,
      bottom: app.state.places.length > 9 ? 45 : 10,
      containLabel: true,
    };
    option.tooltip = {
      ...option.tooltip,
      axisPointer: {
        type: 'shadow',
      },
    };
    option.xAxis = {
      ...option.xAxis,
      type: 'value',
      axisLabel: {
        ...option.xAxis.axisLabel,
        formatter: (value) => app.fmt(value),
      },
      splitLine: {
        lineStyle: {
          color: '#edf1e9',
          type: 'dashed',
        },
      },
    };
    option.yAxis = {
      type: 'category',
      inverse: true,
      data: app.compareRows.map((row) => row.displayName),
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: '#647c66',
        width: 150,
        overflow: 'truncate',
      },
    };
    option.series = [
      {
        type: 'bar',
        name: unit,
        barMaxWidth: 28,
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
        },
        label: {
          show: true,
          position: 'right',
          color: '#526c56',
          fontSize: 11,
          formatter: (params) => app.fmt(params.value),
        },
        data: app.compareRows.map((row) => ({
          value: app.numeric(row.value) ? row.value : null,
          itemStyle: {
            color: row.color,
          },
        })),
      },
    ];
    option.graphic = app.compareRows.some((row) => app.numeric(row.value))
      ? []
      : [
          {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: {
              text: 'Pro tento ukazatel nejsou dostupné číselné údaje.',
              fill: '#8b9b86',
              fontSize: 12,
            },
          },
        ];
    if (app.state.places.length > 9)
      option.dataZoom = [
        {
          type: 'slider',
          yAxisIndex: 0,
          right: 0,
          width: 12,
          start: 0,
          end: Math.min(100, (9 / app.state.places.length) * 100),
          showDetail: false,
        },
      ];
    app.compareChart.setOption(option, true);
    const warnings = [];
    if (app.compareRows.some((row) => !app.numeric(row.value)))
      warnings.push('Chybějící a chráněné údaje se v grafu nevykreslují; stav najdete v tabulce.');
    if (app.state.normalize === 'per1000')
      warnings.push(
        'Přepočet používá obyvatelstvo k 31. 12. stejného roku. Bez dostupného kladného počtu obyvatel se hodnota nevypočítá.',
      );
    if (app.state.indicator === '010000')
      warnings.push(
        'Tento ukazatel je kategoriální kód. Číslo označuje druh obce, nikoliv její velikost; význam kódů najdete v metodice.',
      );
    app.warning('compare-warning', warnings);
    app.compareTable?.destroy();
    app.compareTable = app.makeTable(
      app.$('compare-table'),
      [
        {
          title: 'Obec',
          field: 'name',
          minWidth: 180,
          widthGrow: 2,
          formatter: (cell) =>
            `<span class="table-color" style="background:${cell.getRow().getData().color}"></span>${app.esc(cell.getRow().getData().displayName)}`,
        },
        {
          title: 'Okres',
          field: 'district',
          minWidth: 110,
        },
        {
          title: app.esc(unit),
          field: 'value',
          hozAlign: 'right',
          minWidth: 140,
          formatter: app.valueFormatter,
          sorter: app.numberSorter,
        },
      ],
      app.compareRows,
      app.state.places.length > 12
        ? {
            height: 480,
          }
        : {},
    );
    app.renderMethod('compare-method');
  }
  async function loadHistory() {
    if (!app.state.places.length) {
      app.toast('Nejdříve vyberte alespoň jednu obec.');
      return;
    }
    app.state.from = Number(app.$('history-from').value);
    app.state.to = Number(app.$('history-to').value);
    if (app.state.from > app.state.to) {
      app.toast('Počáteční rok musí být menší nebo stejný jako koncový.');
      return;
    }
    const years = Array.from(
      {
        length: app.state.to - app.state.from + 1,
      },
      (_, index) => app.state.from + index,
    );
    await app.runOperation(
      'Načítám časovou řadu',
      async () => {
        app.taskTotal = years.length;
        for (let index = 0; index < years.length; index++) {
          app.taskIndex = index;
          await app.getYear(years[index]);
        }
        app.historyYears = years;
        app.renderHistory();
        app.saveHash();
      },
      {
        tasks: CsuTransfers.plan(years, app.cacheEntries),
      },
    );
  }
  function requestedHistoryYears() {
    return Array.from(
      {
        length: Math.max(0, app.state.to - app.state.from + 1),
      },
      (_, index) => app.state.from + index,
    );
  }
  function historyCoverage() {
    const years = app.requestedHistoryYears();
    const pending = years.filter((year) => !app.validSlice(year));
    const uncached = pending.filter(
      (year) => !app.cacheEntries.some((entry) => entry.year === year),
    );
    app.$('history-load-hint').textContent = pending.length
      ? `${app.yearCount(years.length)} v období · ${uncached.length} ke stažení, ostatní v místní paměti. Každý nový soubor má desítky MB.`
      : 'Všechny roky tohoto období jsou připravené pro vybrané obce.';
    return {
      years,
      pending,
    };
  }
  function renderHistory() {
    app.renderIndicatorOptions('history');
    app.normalizationControls();
    const { years, pending } = app.historyCoverage();
    app.historyYears = years;
    const item = app.indicators.get(app.state.indicator);
    const unit = app.unitLabel(app.state.indicator, app.state.mode);
    app.$('history-title').textContent = item.nazev;
    app.$('history-subtitle').textContent = `${app.state.from}–${app.state.to} · ${unit}`;
    let baseYear = null;
    if (app.state.mode === 'index')
      baseYear = years.find((year) => {
        const slice = app.validSlice(year);
        return app.state.places.every((code) => {
          const value = app.rawValue(slice, app.state.indicator, code);
          return app.numeric(value) && value !== 0;
        });
      });
    const baseSlice = app.validSlice(baseYear);
    app.historyRows = years.map((year) => {
      const slice = app.validSlice(year);
      const row = {
        year,
        loaded: !!slice,
      };
      for (const code of app.state.places) {
        let value = app.transformedValue(slice, app.state.indicator, code, app.state.mode);
        if (app.state.mode === 'index') {
          const base = app.rawValue(baseSlice, app.state.indicator, code);
          value = !app.numeric(value)
            ? value
            : baseYear != null && app.numeric(base) && base !== 0
              ? (value / base) * 100
              : null;
        }
        row[`v${code}`] = value;
      }
      return row;
    });
    app.historyChart ||= echarts.init(app.$('history-chart'), null, {
      renderer: 'svg',
    });
    const option = app.chartBase();
    option.grid = {
      left: 12,
      right: 20,
      top: 52,
      bottom: years.length > 10 ? 55 : 15,
      containLabel: true,
    };
    option.legend = {
      type: 'scroll',
      top: 0,
      textStyle: {
        color: '#648067',
        fontSize: 10,
      },
    };
    option.xAxis = {
      ...option.xAxis,
      type: 'category',
      boundaryGap: false,
      data: years,
    };
    option.yAxis = {
      ...option.yAxis,
      type: 'value',
      scale: true,
    };
    const limit = app.$('history-series-limit').value;
    const plotted =
      app.state.places.length > 20 && limit !== 'all'
        ? app.state.places.slice(0, Number(limit))
        : app.state.places;
    app.$('history-series-control').classList.toggle('hidden', app.state.places.length <= 20);
    app.$('history-series-hint').classList.toggle('hidden', app.state.places.length <= 20);
    app.$('history-series-hint').textContent =
      `Graf zobrazuje ${app.placeCount(plotted.length)} z ${app.state.places.length}. Tabulka a CSV obsahují všechny vybrané obce. Rozsah grafu můžete změnit výše.`;
    if (plotted.length < app.state.places.length)
      app.$('history-subtitle').textContent +=
        ` · v grafu ${plotted.length}/${app.state.places.length} obcí`;
    option.series = plotted.map((code, index) => ({
      name: app.qualifiedPlace(code),
      type: 'line',
      connectNulls: false,
      symbol: 'circle',
      symbolSize: 6,
      smooth: false,
      lineStyle: {
        width: 2.5,
      },
      itemStyle: {
        color: app.placeColor(index),
      },
      data: app.historyRows.map((row) => (app.numeric(row[`v${code}`]) ? row[`v${code}`] : null)),
    }));
    if (years.length > 10)
      option.dataZoom = [
        {
          type: 'slider',
          height: 16,
          bottom: 0,
          borderColor: '#e3e9de',
          fillerColor: '#176b5720',
        },
        {
          type: 'inside',
        },
      ];
    const hasNumbers = app.historyRows.some((row) =>
      plotted.some((code) => app.numeric(row[`v${code}`])),
    );
    option.graphic = hasNumbers
      ? []
      : [
          {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: {
              text: pending.length
                ? 'Vyberte období a klikněte na „Načíst období“.'
                : 'Pro tento ukazatel nejsou v období dostupné číselné údaje.',
              fill: '#8b9b86',
              fontSize: 12,
            },
          },
        ];
    app.historyChart.setOption(option, true);
    const warnings = [];
    if (pending.length)
      warnings.push(
        `Chybí ${pending.length} ${pending.length === 1 ? 'rok' : 'roků'} pro aktuální výběr. Načtěte období; mezery v grafu představují i dosud nenačtená data.`,
      );
    if (app.state.mode === 'index')
      warnings.push(
        baseYear != null
          ? `Základ indexu: rok ${baseYear} = 100 pro všechny vybrané obce.${pending.length ? ' Základ se může změnit po načtení chybějících let.' : ''}`
          : 'Index nelze spočítat: nebyl nalezen společný rok s dostupnou nenulovou hodnotou.',
      );
    if (app.state.mode === 'per1000')
      warnings.push('Přepočet používá obyvatelstvo k 31. 12. každého roku.');
    warnings.push(
      'Chybějící a chráněné údaje nejsou spojovány čarou. Území obcí a metodika se mohou v čase měnit.',
    );
    if (app.state.places.some((code) => years.some((year) => !app.validArea(code, year))))
      warnings.push('Některá z obcí nemá v části období platný záznam v číselníku území.');
    if (app.state.indicator === '010000')
      warnings.push(
        'Jde o kategoriální kód druhu obce; spojnice nevyjadřuje růst ani pokles velikosti.',
      );
    app.warning('history-warning', warnings);
    app.historyTable?.destroy();
    app.historyTable = app.makeTable(
      app.$('history-table'),
      [
        {
          title: 'Rok',
          field: 'year',
          width: 80,
          frozen: true,
        },
        ...app.state.places.map((code, index) => ({
          title: app.esc(app.displayPlace(code)),
          field: `v${code}`,
          minWidth: 140,
          hozAlign: 'right',
          formatter: app.valueFormatter,
          sorter: app.numberSorter,
          titleFormatter: () =>
            `<span class="table-color" style="background:${app.placeColor(index)}"></span>${app.esc(app.displayPlace(code))}`,
        })),
        {
          title: 'Stav',
          field: 'loaded',
          width: 110,
          formatter: (cell) =>
            cell.getValue() ? 'Načteno' : '<span class="data-missing">Nenačteno</span>',
          headerSort: false,
        },
      ],
      app.historyRows,
      {
        maxHeight: 400,
      },
    );
    app.renderMethod('history-method');
  }
  return {
    chartBase,
    warning,
    renderCompare,
    loadHistory,
    requestedHistoryYears,
    historyCoverage,
    renderHistory,
  };
}
