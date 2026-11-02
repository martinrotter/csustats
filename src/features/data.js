export function createData(app) {
  function area(code, year = app.state.year) {
    const records = app.territories.get(code) || [];
    return (
      records.find((record) => Number(record.platiod) <= year && Number(record.platido) >= year) ||
      records.at(-1) || {
        koduzemi: code,
        obec: code,
        okres: 'Neznámý okres',
        soorp: '',
      }
    );
  }
  function placeLabel(code, year = app.state.year) {
    return app.area(code, year).obec;
  }
  function displayPlace(code) {
    return app.displayPlaceNames.get(code) || app.placeLabel(code);
  }
  function qualifiedPlace(code, year = app.state.year) {
    const record = app.area(code, year);
    return `${record.obec} (${record.okres}, ${code})`;
  }
  function validArea(code, year) {
    return (app.territories.get(code) || []).some(
      (record) => Number(record.platiod) <= year && Number(record.platido) >= year,
    );
  }
  function signature(codes = app.state.places) {
    return codes.join(',');
  }
  function validSlice(year) {
    const slice = app.slices.get(Number(year));
    return slice && app.signature(slice.codes) === app.signature() ? slice : null;
  }
  function rawValue(slice, indicator, code) {
    if (!slice) return null;
    slice.codeIndex ||= new Map(slice.codes.map((item, index) => [item, index]));
    const index = slice.codeIndex.get(code);
    return index === undefined ? null : (slice.values[indicator]?.[index] ?? null);
  }
  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  function canNormalize(indicator) {
    const item = app.indicators.get(indicator);
    return (
      !!item &&
      /^(osoba|počet|tis\.?\s*Kč|Kč)$/i.test(item.mj.trim()) &&
      indicator !== '010000' &&
      !/průměr|podíl|index|míra|procent|hustot|na\s+(1|100|tisíc)/i.test(item.nazev)
    );
  }
  function transformedValue(slice, indicator, code, mode = 'absolute') {
    const raw = app.rawValue(slice, indicator, code);
    if (mode !== 'per1000' || !app.numeric(raw)) return raw;
    const population = app.rawValue(slice, app.POPULATION, code);
    return app.numeric(population) && population > 0 ? (raw / population) * 1000 : null;
  }
  function unitLabel(indicator, mode = 'absolute') {
    const unit = app.indicators.get(indicator)?.mj || 'hodnota';
    return mode === 'per1000'
      ? `${unit} / 1 000 obyvatel`
      : mode === 'index'
        ? 'index (základ = 100)'
        : unit;
  }
  return {
    area,
    placeLabel,
    displayPlace,
    qualifiedPlace,
    validArea,
    signature,
    validSlice,
    rawValue,
    numeric,
    canNormalize,
    transformedValue,
    unitLabel,
  };
}
