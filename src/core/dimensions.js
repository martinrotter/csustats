import { getLocale, getLanguage, t } from '../i18n/index.js';
// Shared dimension behaviour. Neither the UI nor these algorithms know a dataset code.
export function refreshTemporalDimensions(descriptor, selections) {
  const time = descriptor.dimensions.find((dim) => dim.role === 'time');
  if (!time) return;
  const selectedPeriods = new Set(selections[time.id] || []);
  const periods = time.categories.filter((item) => selectedPeriods.has(item.id));
  const signature = JSON.stringify([
    ...[...selectedPeriods].sort(),
    ...descriptor.dimensions
      .filter((dim) => dim.allCategories)
      .map((dim) => selections[dim.id] || []),
  ]);
  if (descriptor.temporalSignature === signature) return;
  descriptor.temporalSignature = signature;
  const ranges = periods
    .map((item) => ({ from: Date.parse(item.from), to: Date.parse(item.to) }))
    .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to))
    .sort((a, b) => b.to - a.to);
  for (const dimension of descriptor.dimensions) {
    if (!dimension.allCategories) continue;
    const selected = new Set(selections[dimension.id] || []);
    dimension.categories = dimension.allCategories
      .flatMap((item) => {
        if (!item.history?.length) return [item];
        const history = [...item.history].sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
        const version = ranges.flatMap((range) =>
          history.filter(
            (record) => Date.parse(record.from) < range.to && Date.parse(record.to) > range.from,
          ),
        )[0];
        if (!version && ranges.length && !selected.has(item.id)) return [];
        return [{ ...item, ...(version || history[0]), active: !ranges.length || !!version }];
      })
      .sort((a, b) => a.label.localeCompare(b.label, getLocale()));
  }
}

export function dimensionGroups(dimension) {
  const groups = new Map();
  const categories = new Map(dimension.categories.map((item) => [item.id, item]));
  for (const item of dimension.categories) {
    for (const group of item.groups || []) groups.set(group.id, group);
    if (item.parent && categories.has(item.parent)) {
      const parent = categories.get(item.parent);
      const level = dimension.levels?.find((level) => level.id === parent.level)?.label;
      groups.set(`tree:${parent.id}`, {
        id: `tree:${parent.id}`,
        label: `${level ? level + ': ' : ''}${parent.label}`,
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, getLocale()));
}

export function belongsToGroup(item, dimension, groupId) {
  if (!groupId) return true;
  if (item.groups?.some((group) => group.id === groupId)) return true;
  if (!groupId.startsWith('tree:')) return false;
  const wanted = groupId.slice(5);
  const categories =
    dimension.categoryIndex || new Map(dimension.categories.map((item) => [item.id, item]));
  const seen = new Set([item.id]);
  let parent = item.parent;
  while (parent && !seen.has(parent)) {
    if (parent === wanted) return true;
    seen.add(parent);
    parent = categories.get(parent)?.parent;
  }
  return false;
}

export function countWord(count, one, few, many) {
  return t(
    count === 1 ? one : getLanguage() === 'en' ? many : count >= 2 && count <= 4 ? few : many,
  );
}
