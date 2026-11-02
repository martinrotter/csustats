export const CsuCoverage = Object.freeze({
  summarize(values) {
    let count = 0;
    for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) count++;
    const total = values.length;
    return {
      count,
      total,
      ratio: total ? count / total : 0,
      sparse: count > 0 && (count / total < 0.5 || (total > 1 && count === 1)),
    };
  },
});
