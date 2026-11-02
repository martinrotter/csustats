export const CsuPlaces = Object.freeze({
  merge(existing, incoming, replace = false) {
    return [...new Set([...(replace ? [] : existing), ...incoming])];
  },
});
