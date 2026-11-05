import { t, ht } from '../i18n/index.js';
import { escapeHtml, formatNumber } from '../core/cube.js';

export const PALETTE = [
  '#2563a6',
  '#087f8c',
  '#d78926',
  '#8b5fbf',
  '#d55765',
  '#3f8859',
  '#5e809c',
  '#b06935',
  '#b6508c',
  '#6b8237',
  '#6467b0',
  '#268caa',
];

export function wrapChartText(text, characters) {
  const limit = Math.max(10, Math.floor(characters));
  const lines = [];
  let line = '';
  for (const word of String(text || '')
    .replace(/(\d{1,2}\.)\s+(?=\d{1,2}\.(?:\s|$))/g, '$1\u00a0')
    .replace(/\b([ksvzouaiKSVZOUAI])\s+(?=\S)/g, '$1\u00a0')
    .split(/[ \t\r\n]+/)
    .filter(Boolean)) {
    if (line && line.length + word.length + 1 > limit) {
      lines.push(line);
      line = '';
    }
    if (word.length > limit) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let i = 0; i < word.length; i += limit) lines.push(word.slice(i, i + limit));
    } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function chartSubtitle(projection, { transform = 'absolute', fixed = [] } = {}) {
  const measure =
    transform === 'index'
      ? t`Index${projection.base ? ` · ${projection.base} = 100` : t(' · základ není dostupný')}`
      : projection.unit
        ? t`Jednotka: ${projection.unit}`
        : '';
  return [
    measure,
    ...(transform === 'ratio' && projection.denominator
      ? [t`Jmenovatel: ${projection.denominator}`]
      : []),
    ...fixed,
    ...(projection.omitted
      ? [t`${projection.series.length} z ${projection.series.length + projection.omitted} řad`]
      : []),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function chartOptions(
  projection,
  {
    type = 'bar',
    title = '',
    subtitle = '',
    source = '',
    labels = false,
    extremes = false,
    legend = 'bottom',
    time = false,
    width = 1000,
    titleSize = 18,
    staticExport = false,
  } = {},
) {
  const horizontal = type === 'horizontal';
  const heatmap = type === 'heatmap';
  const count = projection.categories.length;
  const many = count > (horizontal ? 18 : 24);
  const series = projection.series;
  let legendRows = 1,
    legendRowWidth = 0;
  if (staticExport && legend === 'bottom')
    for (const item of series) {
      const itemWidth = Math.min(155, item.name.length * 6.5) + 35;
      if (legendRowWidth && legendRowWidth + itemWidth > width - 50) {
        legendRows++;
        legendRowWidth = 0;
      }
      legendRowWidth += itemWidth;
    }
  const unit = projection.unit;
  const titleText = wrapChartText(title, (width - 40) / (titleSize * 0.62));
  const subtitleText = wrapChartText(
    subtitle || chartSubtitle(projection),
    (width - 48) / (12 * 0.62),
  );
  const chartTop =
    22 +
    titleText.split('\n').length * (titleSize + 6) +
    (subtitleText ? 8 + subtitleText.split('\n').length * 18 : 0) +
    28;
  const label = (value) => formatNumber(value);
  const tooltip = (params) => {
    const items = Array.isArray(params) ? params : [params];
    const heading =
      items[0]?.axisValueLabel || projection.categories[items[0]?.data?.[0]]?.label || '';
    return `<div class="chart-tooltip"><strong>${escapeHtml(heading)}</strong>${items
      .slice(0, 25)
      .map((item) => {
        const value = heatmap ? item.value[2] : item.value;
        const name = heatmap ? series[item.value[1]]?.name : item.seriesName;
        return `<div><span style="background:${typeof item.color === 'string' && /^#[a-f\d]{3,8}$/i.test(item.color) ? item.color : '#2563a6'}"></span>${escapeHtml(name)}<b>${value == null ? '—' : escapeHtml(label(value))} ${escapeHtml(unit)}</b></div>`;
      })
      .join(
        '',
      )}${items.length > 25 ? `<small>${ht('Další řady najdete v tabulce.')}</small>` : ''}</div>`;
  };
  const categoryAxis = {
    type: 'category',
    data: projection.categories.map((item) => item.label),
    boundaryGap: !['line', 'area'].includes(type),
    axisLine: { lineStyle: { color: '#cbd5e1' } },
    axisTick: { show: false },
    axisLabel: {
      color: '#526176',
      fontSize: 11,
      hideOverlap: true,
      width: horizontal ? 175 : 115,
      overflow: 'truncate',
    },
  };
  const numericAxis = {
    type: 'value',
    scale: type === 'line',
    axisLabel: { formatter: label, color: '#526176', fontSize: 11 },
    splitLine: { lineStyle: { color: '#e7edf4', type: 'dashed' } },
    axisLine: { show: false },
  };
  const options = {
    backgroundColor: '#fff',
    color: PALETTE,
    animation: count * series.length < 1500,
    animationDuration: 250,
    textStyle: { fontFamily: 'Inter, Segoe UI, Arial, sans-serif' },
    aria: {
      enabled: true,
      description: t`${title}. ${count} kategorií, ${series.length} datových řad. Přesné hodnoty jsou dostupné na kartě Tabulka.`,
      decal: { show: false },
    },
    title: {
      text: titleText,
      subtext: subtitleText,
      left: 24,
      top: 22,
      padding: 0,
      itemGap: 8,
      textAlign: 'left',
      textStyle: {
        fontSize: titleSize,
        fontWeight: 600,
        color: '#162840',
        lineHeight: titleSize + 6,
      },
      subtextStyle: { color: '#66778e', fontSize: 12, lineHeight: 18, align: 'left' },
    },
    grid: {
      left: 24,
      right: legend === 'right' && series.length > 1 ? 205 : 30,
      top: chartTop,
      bottom:
        (many ? 100 : 65) +
        (legend === 'bottom' && series.length > 1 ? 25 + (legendRows - 1) * 22 : 0),
      containLabel: true,
    },
    legend: {
      show: series.length > 1 && !heatmap,
      type: staticExport ? 'plain' : 'scroll',
      orient: legend === 'right' ? 'vertical' : 'horizontal',
      ...(legend === 'right'
        ? { right: 16, top: chartTop + 5, bottom: 65, width: 170 }
        : { bottom: 30, left: 20, right: 20 }),
      textStyle: { fontSize: 11, width: 155, overflow: 'truncate', color: '#42546d' },
      itemWidth: 12,
      itemHeight: 9,
    },
    tooltip: {
      trigger: heatmap ? 'item' : 'axis',
      confine: true,
      appendToBody: false,
      formatter: tooltip,
      axisPointer: {
        type: ['bar', 'horizontal', 'stacked'].includes(type) ? 'shadow' : 'line',
        lineStyle: { color: '#8ca4bf', type: 'dashed' },
      },
      backgroundColor: '#fff',
      borderColor: '#dce4ee',
      padding: 12,
      textStyle: { color: '#1e3049', fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 32px #0f29451a;max-width:500px;max-height:70vh;overflow:auto',
    },
    xAxis: horizontal ? numericAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : numericAxis,
    graphic: [
      {
        type: 'text',
        left: 20,
        bottom: 8,
        style: { text: source, fill: '#718198', fontSize: 10, overflow: 'truncate', width: 900 },
      },
    ],
    series: series.map((item, index) => ({
      name: item.name,
      type: ['line', 'area'].includes(type) ? 'line' : 'bar',
      data: item.values,
      connectNulls: false,
      smooth: false,
      showSymbol: count <= 50,
      symbol: ['circle', 'rect', 'triangle', 'diamond'][
        (index + Math.floor(index / PALETTE.length)) % 4
      ],
      symbolSize: 5,
      lineStyle: {
        width: 2.3,
        type: ['solid', 'dashed', 'dotted'][Math.floor(index / PALETTE.length) % 3],
      },
      barMaxWidth: horizontal ? 22 : 30,
      barGap: '15%',
      stack: type === 'stacked' ? 'values' : undefined,
      areaStyle: type === 'area' ? { opacity: 0.13 } : undefined,
      emphasis: { focus: 'series', blurScope: 'coordinateSystem' },
      itemStyle: {
        borderRadius: type === 'stacked' ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
      },
      label: {
        show: labels && count * series.length <= 300,
        position: horizontal ? 'right' : 'top',
        formatter: (params) => (params.value == null ? '' : label(params.value)),
        fontSize: 10,
      },
      markPoint:
        extremes || item.outliers?.length
          ? {
              symbol: 'circle',
              symbolSize: 32,
              data: [
                ...(extremes
                  ? [
                      { type: 'max', name: t('Maximum') },
                      { type: 'min', name: t('Minimum') },
                    ]
                  : []),
                ...(item.outliers || []).slice(0, 100).map((position) => ({
                  name: t('Odlehlá hodnota'),
                  coord: horizontal
                    ? [item.values[position], position]
                    : [position, item.values[position]],
                  value: item.values[position],
                  symbol: 'circle',
                  symbolSize: 9,
                  itemStyle: { color: '#b9571c', borderColor: '#fff', borderWidth: 1 },
                  label: { show: false },
                })),
              ],
              label: { formatter: (params) => label(params.value), fontSize: 9 },
            }
          : undefined,
    })),
  };
  if (many)
    options.dataZoom = [
      {
        type: 'slider',
        ...(horizontal
          ? { yAxisIndex: 0, right: 5, width: 12, top: 95, bottom: 70 }
          : {
              xAxisIndex: 0,
              bottom: legend === 'bottom' && series.length > 1 ? 64 : 40,
              height: 18,
            }),
        start: 0,
        end: time ? 100 : Math.min(100, ((horizontal ? 18 : 24) / count) * 100),
        showDetail: false,
        borderColor: '#dce4ee',
        fillerColor: '#2563a61c',
        brushSelect: false,
      },
      {
        type: 'inside',
        ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }),
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseWheel: true,
        preventDefaultMouseMove: false,
      },
    ];
  if (heatmap) {
    const values = series.flatMap((item) => item.values).filter((value) => value != null);
    let min = values.length ? values.reduce((a, b) => Math.min(a, b), Infinity) : 0;
    let max = values.length ? values.reduce((a, b) => Math.max(a, b), -Infinity) : 1;
    if (min < 0 && max > 0) {
      max = Math.max(-min, max);
      min = -max;
    }
    if (min === max) {
      min = Math.min(0, min);
      max = max === 0 ? 1 : max;
    }
    options.yAxis = {
      type: 'category',
      data: series.map((item) => item.name),
      inverse: true,
      axisTick: { show: false },
      axisLabel: { width: 150, overflow: 'truncate', fontSize: 11 },
      splitArea: { show: true },
    };
    options.xAxis = { ...categoryAxis, splitArea: { show: true } };
    options.grid.right = 30;
    options.grid.bottom = many ? 115 : 90;
    if (series.length > 20)
      options.dataZoom = [
        ...(options.dataZoom || []),
        {
          type: 'slider',
          yAxisIndex: 0,
          orient: 'vertical',
          right: 5,
          top: chartTop,
          bottom: 95,
          width: 12,
          start: 0,
          end: (20 / series.length) * 100,
          showDetail: false,
          filterMode: 'weakFilter',
        },
      ];
    options.visualMap = {
      min,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 30,
      itemWidth: 12,
      itemHeight: 150,
      precision: 1,
      formatter: (value) => formatNumber(value),
      inRange: {
        color:
          min < 0
            ? ['#c73d50', '#f2f5f9', '#1766a7']
            : ['#edf5fc', '#8cbee0', '#2563a6', '#143b66'],
      },
    };
    options.series = [
      {
        type: 'heatmap',
        data: series.flatMap((item, row) =>
          item.values.flatMap((value, column) => (value == null ? [] : [[column, row, value]])),
        ),
        label: {
          show: labels && count * series.length <= 200,
          formatter: (params) => label(params.value[2]),
          fontSize: 10,
        },
        emphasis: { itemStyle: { borderColor: '#0b2545', borderWidth: 2 } },
      },
    ];
  }
  return options;
}
