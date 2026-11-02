export /* Shared transfer planning and progress arithmetic; also exercised by verify.mjs. */
const CsuTransfers = Object.freeze({
  plan(years, entries) {
    const saved = new Map(entries.map((entry) => [Number(entry.year), entry]));
    return [...new Set(years.map(Number))].filter(Number.isInteger).map((year) => ({
      id: `year-${year}`,
      year,
      name: `mos_data_${year}.csv`,
      cached: saved.has(year),
      size: saved.get(year)?.size || 0,
      status: saved.has(year) ? 'cached' : 'queued',
      fraction: saved.has(year) ? 1 : 0,
      detail: '',
    }));
  },
  fraction(loaded, total, start = 0, end = 75) {
    // A compressed Content-Length must never produce a made-up percentage.
    if (!(total > 0) || loaded > total) return null;
    return start + (Math.max(0, loaded) / total) * (end - start);
  },
  overall(tasks) {
    if (!tasks.length) return 0;
    return (
      (tasks.reduce(
        (sum, task) => sum + (task.cached ? 1 : Math.min(1, Math.max(0, task.fraction || 0))),
        0,
      ) /
        tasks.length) *
      100
    );
  },
});
