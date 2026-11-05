import { t, getLocale } from '../i18n/index.js';
import { MAX_CELLS } from './cube.js';

export function validateSelection(descriptor, selections) {
  let count = 1;
  for (const dim of descriptor.dimensions) {
    const chosen = selections[dim.id];
    if (!Array.isArray(chosen) || !chosen.length)
      throw new Error(t`Vyberte položky: ${dim.label}.`);
    const known = new Set(dim.categories.map((item) => item.id));
    if (new Set(chosen).size !== chosen.length || chosen.some((id) => !known.has(id)))
      throw new Error(t`Neplatná položka dimenze ${dim.label}.`);
    count *= chosen.length;
    if (count > MAX_CELLS)
      throw new Error(
        t`Výběr má více než ${MAX_CELLS.toLocaleString(getLocale())} buněk. Omezte dimenze.`,
      );
  }
  const metric = descriptor.dimensions.find((dim) => dim.role === 'metric');
  for (const rule of descriptor.constraints?.forbiddenPairs || []) {
    if (
      selections[metric?.id]?.includes(rule.metric) &&
      descriptor.dimensions.some((dim) => rule.dimensions.includes(dim.id))
    ) {
      const label = metric.categories.find((item) => item.id === rule.metric)?.label || rule.metric;
      throw new Error(
        t`Ukazatel „${label}“ nelze kombinovat s vybraným členěním. Změňte ukazatel nebo variantu dimenze.`,
      );
    }
  }
  return count;
}
