export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
export const fold = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export const fmt = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('cs-CZ', {
        maximumFractionDigits: 2,
      }).format(value)
    : value === 'i.d.'
      ? 'i.d.'
      : '—';
export const mb = (bytes) =>
  `${new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 1,
  }).format(bytes / 1000000)} MB`;
export const date = (time) =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(new Date(time));
export const placeCount = (count) =>
  `${count} ${count === 1 ? 'obec' : count >= 2 && count <= 4 ? 'obce' : 'obcí'}`;
export const yearCount = (count) =>
  `${count} ${count === 1 ? 'rok' : count >= 2 && count <= 4 ? 'roky' : 'roků'}`;
