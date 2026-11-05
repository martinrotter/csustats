import english from './en.json' with { type: 'json' };

export const LANGUAGES = ['cs', 'en'];
let language = 'cs';
export const getLanguage = () => language;
export const getLocale = () => (language === 'en' ? 'en-GB' : 'cs-CZ');
export const normalizeLanguage = (value) => (LANGUAGES.includes(value) ? value : 'cs');
export function setLanguage(value) {
  language = normalizeLanguage(value);
  return language;
}
export function preferredLanguage(hash = '', stored, browserLanguages = []) {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const view = params.get('view');
    const explicit =
      view && view.length <= 60000 ? JSON.parse(view)?.language : params.get('language');
    if (LANGUAGES.includes(explicit)) return explicit;
  } catch {
    /* The application reports invalid view definitions separately. */
  }
  if (LANGUAGES.includes(stored)) return stored;
  const preferences = Array.isArray(browserLanguages) ? browserLanguages : [browserLanguages];
  for (const preference of preferences) {
    if (typeof preference !== 'string') continue;
    const primary = preference.trim().toLowerCase().split('-')[0];
    if (LANGUAGES.includes(primary)) return primary;
  }
  return 'cs';
}
export const messageKey = (value) => String(value).replace(/\s+/g, ' ').trim();
const htmlEscape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

function interpolate(message, values, html = false) {
  let translated = language === 'en' ? (english[messageKey(message)] ?? message) : message;
  if (language === 'en' && translated !== message) {
    const leading = message.match(/^\s*/)[0],
      trailing = message.match(/\s*$/)[0];
    if (leading && !/^\s/.test(translated)) translated = leading + translated;
    if (trailing && !/\s$/.test(translated)) translated += trailing;
  }
  // Insert values after translating literal text. Source labels and user data are never translated.
  return translated
    .split(/(\{\d+\})/)
    .map((part) => {
      const index = /^\{(\d+)\}$/.exec(part);
      if (index) return String(values[Number(index[1])] ?? part);
      return html ? htmlEscape(part) : part;
    })
    .join('');
}

export function t(message = '', ...values) {
  if (Array.isArray(message)) {
    const key = message.reduce(
      (text, part, index) => text + part + (index < values.length ? `{${index}}` : ''),
      '',
    );
    return interpolate(key, values);
  }
  return interpolate(String(message ?? ''), values);
}

// Arguments to HTML messages have already been escaped by their rendering code.
export const ht = (message, ...values) => interpolate(message, values, true);

const literalPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rememberedMessages = Object.entries(english).flatMap(([key, value]) =>
  [key, value].map((text) => {
    const slots = [];
    const pattern = messageKey(text)
      .split(/(\{\d+\})/)
      .map((part) => {
        const match = /^\{(\d+)\}$/.exec(part);
        if (match) {
          slots.push(Number(match[1]));
          return '(.+?)';
        }
        return literalPattern(part);
      })
      .join('');
    return { key, slots, pattern: new RegExp('^' + pattern + '$') };
  }),
);
// Only for application messages/logs recorded before a language switch, never source metadata.
export function translateMessage(value) {
  const text = String(value ?? '');
  const http = /^(.*) \(HTTP (\d+)\)$/.exec(text);
  if (http) return `${translateMessage(http[1])} (HTTP ${http[2]})`;
  for (const entry of rememberedMessages) {
    const match = entry.pattern.exec(messageKey(text));
    if (match) {
      const values = [];
      entry.slots.forEach((slot, index) => {
        values[slot] = match[index + 1];
      });
      return t(entry.key, ...values);
    }
  }
  return text;
}
export function errorText(error) {
  if (error?.name === 'SyntaxError') return t('Data nemají platný formát JSON.');
  if (error?.name === 'TypeError' && /encod|decod/i.test(error.message))
    return t('Soubor nelze dekódovat. Zkontrolujte zvolené kódování.');
  if (error?.name === 'TypeError' && /fetch|network|load failed/i.test(error.message))
    return t('Síťový požadavek selhal. Zkontrolujte připojení a dostupnost zdroje.');
  return translateMessage(error?.message || String(error));
}

export function captureStaticUi(root = document.documentElement) {
  const records = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('script, style, noscript, [data-i18n-skip]') ||
        !messageKey(node.nodeValue)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode,
      original = node.nodeValue;
    records.push(() => {
      if (node.isConnected)
        node.nodeValue = original.replace(original.trim(), t(messageKey(original)));
    });
  }
  for (const element of root.querySelectorAll(
    '[aria-label], [placeholder], [title], meta[name="description"]',
  ))
    for (const attribute of [
      'aria-label',
      'placeholder',
      'title',
      ...(element.matches('meta') ? ['content'] : []),
    ]) {
      const original = element.getAttribute(attribute);
      if (original)
        records.push(() => {
          if (element.isConnected) element.setAttribute(attribute, t(original));
        });
    }
  return () => {
    root.lang = language;
    for (const update of records) update();
  };
}
