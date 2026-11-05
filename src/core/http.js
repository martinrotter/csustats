import { t, getLanguage, normalizeLanguage } from '../i18n/index.js';
export class HttpError extends Error {
  constructor(status, url, retryAt = 0) {
    const messages = {
      400: t('Server odmítl definici výběru. Zkontrolujte kombinaci ukazatelů a dimenzí.'),
      401: t('Tato data vyžadují přihlášení.'),
      403: t('Poskytovatel odmítl přístup. Další požadavky jsou dočasně pozastavené.'),
      404: t('Požadovaná sada nebo soubor není dostupný.'),
      413: t('Výběr je příliš velký. Omezte počet položek nebo období.'),
      429: t('Poskytovatel omezil počet požadavků. Respektujeme jeho čekací dobu.'),
      503: t('Služba je dočasně přetížená nebo nedostupná.'),
    };
    super(`${messages[status] || t('Požadavek na data selhal.')} (HTTP ${status})`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryAt = retryAt;
  }
}

export const abortError = () => new DOMException(t('Operace byla zrušena.'), 'AbortError');
export function checkSignal(signal) {
  if (signal?.aborted) throw abortError();
}

export function abortableWait(ms, signal) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function retryTime(value, now = Date.now(), serverDate = null) {
  if (value == null || value.trim() === '') return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return now + Number(value) * 1000;
  if (!/\d{2}:\d{2}:\d{2}.*GMT$/i.test(value.trim())) return 0;
  const target = Date.parse(value);
  const reference = Date.parse(serverDate);
  return Number.isFinite(target)
    ? now + Math.max(0, target - (Number.isFinite(reference) ? reference : now))
    : 0;
}

// One shared quota for both ČSÚ hosts, not a separate budget per endpoint.
// Web Locks make reservation atomic across tabs; storage preserves server pauses.
export class RateGate {
  constructor({
    now = Date.now,
    wait = abortableWait,
    storage = null,
    locks = null,
    spacing = 1200,
    windowMs = 60000,
    limit = 30,
    key = 'narodni-data:csu-quota:v1',
  } = {}) {
    Object.assign(this, { now, wait, storage, locks, spacing, windowMs, limit, key });
    this.state = { starts: [], pauseUntil: 0, reason: '' };
  }
  read() {
    try {
      const shared = JSON.parse(this.storage?.getItem(this.key) || 'null');
      if (shared && Array.isArray(shared.starts))
        this.state = {
          starts: shared.starts.filter(Number.isFinite),
          pauseUntil: Number(shared.pauseUntil) || 0,
          reason: String(shared.reason || ''),
        };
    } catch {
      /* Storage may be unavailable for file:// or private browsing. */
    }
    return this.state;
  }
  save(state) {
    this.state = state;
    try {
      this.storage?.setItem(this.key, JSON.stringify(state));
    } catch {
      /* In-memory quota stays active. */
    }
  }
  async atomic(fn) {
    if (this.locks) {
      let entered = false;
      try {
        return await this.locks.request(this.key, () => {
          entered = true;
          return fn();
        });
      } catch (error) {
        if (entered) throw error;
        this.locks = null;
      }
    }
    return fn();
  }
  async pause(until, reason) {
    await this.atomic(() => {
      const state = this.read();
      if (until > state.pauseUntil) this.save({ ...state, pauseUntil: until, reason });
    });
  }
  async lease(signal, task) {
    if (!this.locks) return task();
    let entered = false;
    try {
      return await this.locks.request(this.key + ':transfer', { signal }, () => {
        entered = true;
        return task();
      });
    } catch (error) {
      if (entered || signal.aborted) throw error;
      this.locks = null;
      // Some file/private contexts expose navigator.locks but reject its use.
      return task();
    }
  }
  async claim(signal, notify = () => {}) {
    for (;;) {
      checkSignal(signal);
      const delay = await this.atomic(() => {
        const state = this.read();
        const now = this.now();
        const starts = state.starts.filter((time) => time > now - this.windowMs);
        const next = Math.max(
          state.pauseUntil,
          (starts.at(-1) ?? -Infinity) + this.spacing,
          starts.length >= this.limit ? starts[starts.length - this.limit] + this.windowMs : 0,
        );
        if (next > now)
          return {
            until: next,
            reason: state.pauseUntil > now ? state.reason : t('Šetrná fronta požadavků'),
          };
        this.save({ ...state, starts: [...starts, now] });
        return null;
      });
      if (!delay) return;
      notify({ phase: 'waiting', ...delay });
      await this.wait(Math.min(3600000, delay.until - this.now()), signal);
    }
  }
}

export class ApiClient {
  constructor({
    fetcher = (url, options) => globalThis.fetch(url, options),
    gate = new RateGate(),
    now = Date.now,
    wait = abortableWait,
    random = Math.random,
    onEvent = () => {},
    timeout = 90000,
  } = {}) {
    Object.assign(this, { fetcher, gate, now, wait, random, onEvent, timeout });
    this.tail = Promise.resolve();
    this.inFlight = new Map();
    this.log = [];
  }
  emit(event, entry) {
    this.onEvent(event);
    for (const subscriber of entry?.subscribers || []) subscriber.onProgress?.(event);
  }
  request(
    url,
    {
      method = 'GET',
      body,
      signal,
      onProgress,
      maxBytes = 120 * 1024 * 1024,
      expectedSize = 0,
      retries = 2,
      language = getLanguage(),
    } = {},
  ) {
    checkSignal(signal);
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      !['data.csu.gov.cz', 'opendata.csu.gov.cz'].includes(target.hostname) ||
      target.username ||
      target.password ||
      !['GET', 'POST', 'HEAD'].includes(method)
    ) {
      return Promise.reject(new Error(t('Nepovolený datový endpoint.')));
    }
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    language = normalizeLanguage(language);
    const key = `${language} ${method} ${url} ${serialized || ''}`;
    let entry = this.inFlight.get(key);
    if (!entry) {
      entry = { subscribers: new Set(), controller: new AbortController() };
      this.inFlight.set(key, entry);
      const task = this.tail.then(() =>
        this.gate.lease(entry.controller.signal, () =>
          this.run(url, { method, serialized, maxBytes, expectedSize, retries, language }, entry),
        ),
      );
      this.tail = task.catch(() => {});
      task.then(
        (value) => this.finish(key, entry, null, value),
        (error) => this.finish(key, entry, error),
      );
    }
    return new Promise((resolve, reject) => {
      const subscriber = { resolve, reject, onProgress };
      const abort = () => {
        subscriber.cleanup();
        entry.subscribers.delete(subscriber);
        reject(abortError());
        if (!entry.subscribers.size) {
          if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
          entry.controller.abort();
        }
      };
      subscriber.cleanup = () => signal?.removeEventListener('abort', abort);
      entry.subscribers.add(subscriber);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      onProgress?.({ phase: 'queued', url, method });
    });
  }
  finish(key, entry, error, value) {
    if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
    for (const subscriber of entry.subscribers) {
      subscriber.cleanup();
      if (error) subscriber.reject(error);
      else subscriber.resolve(value);
    }
    entry.subscribers.clear();
  }
  async run(url, options, entry) {
    const { method, serialized, maxBytes, expectedSize, retries, language } = options;
    const signal = entry.controller.signal;
    for (let attempt = 0; ; attempt++) {
      checkSignal(signal);
      await this.gate.claim(signal, (event) => this.emit({ ...event, url, method }, entry));
      checkSignal(signal);
      const started = this.now();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeout);
      let record;
      try {
        this.emit({ phase: 'request', url, method, attempt }, entry);
        const response = await this.fetcher(url, {
          method,
          body: serialized,
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            Accept: 'application/json, text/csv;q=0.9, */*;q=0.5',
            'Accept-Language': language,
            ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          redirect: 'follow',
        });
        record = { url, method, status: response.status, attempt, started, bytes: 0, duration: 0 };
        this.log.unshift(record);
        this.log.length = Math.min(100, this.log.length);
        const now = this.now();
        let until = retryTime(
          response.headers.get('retry-after'),
          now,
          response.headers.get('date'),
        );
        if (response.status === 429) until = Math.max(until, now + 60000);
        if (response.status === 403) until = Math.max(until, now + 10 * 60000);
        const remaining =
          response.headers.get('ratelimit-remaining') ??
          response.headers.get('x-ratelimit-remaining');
        if (remaining !== null && Number(remaining) === 0) {
          const reset = response.headers.get('x-ratelimit-reset');
          const standardReset = response.headers.get('ratelimit-reset');
          const resetAt = reset && Number(reset) > now / 1000 ? Number(reset) * 1000 : 0;
          const standardAt = /^\d+(?:\.\d+)?$/.test(standardReset || '')
            ? now + Number(standardReset) * 1000
            : 0;
          until = Math.max(until, resetAt, standardAt || now + 60000);
        }
        if (until > now)
          await this.gate.pause(until, t`HTTP ${response.status} · čekání podle poskytovatele`);
        this.emit({ phase: 'response', ...record, until }, entry);
        if (!response.ok) {
          await response.body?.cancel();
          const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
          if (retryable && attempt < retries && until - now <= 30000) {
            const backoff = Math.max(until - now, 1500 * 2 ** attempt + this.random() * 500);
            await this.gate.pause(
              now + backoff,
              t`HTTP ${response.status} · opakování ${attempt + 1}/${retries}`,
            );
            continue;
          }
          throw new HttpError(response.status, url, until);
        }
        const declared = Number(response.headers.get('content-length')) || 0;
        if (declared > maxBytes) {
          await response.body?.cancel();
          throw new Error(t('Soubor překračuje bezpečnou velikost. Omezte výběr.'));
        }
        const total = expectedSize || (response.headers.get('content-encoding') ? 0 : declared);
        const chunks = [];
        if (method !== 'HEAD' && response.body) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              checkSignal(signal);
              const { done, value } = await reader.read();
              if (done) break;
              record.bytes += value.byteLength;
              if (record.bytes > maxBytes)
                throw new Error(t('Přenos překročil bezpečnou velikost. Omezte výběr.'));
              chunks.push(value);
              this.emit({ phase: 'receiving', loaded: record.bytes, total, url, method }, entry);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
          } finally {
            reader.releaseLock();
          }
        } else if (method !== 'HEAD') {
          const bytes = new Uint8Array(await response.arrayBuffer());
          record.bytes = bytes.length;
          if (bytes.length > maxBytes) throw new Error(t('Soubor překračuje bezpečnou velikost.'));
          chunks.push(bytes);
        }
        checkSignal(signal);
        const result = {
          blob: new Blob(chunks, { type: response.headers.get('content-type') || '' }),
          headers: Object.fromEntries(response.headers),
          status: response.status,
          url: response.url || url,
        };
        this.emit({ phase: 'done', url, method, loaded: record.bytes }, entry);
        return result;
      } catch (error) {
        if (!record) {
          record = { url, method, status: 0, attempt, started, bytes: 0 };
          this.log.unshift(record);
          this.log.length = Math.min(100, this.log.length);
        }
        record.error = signal.aborted ? t('Zrušeno') : timedOut ? t('Časový limit') : error.message;
        this.emit({ phase: 'error', ...record }, entry);
        if (signal.aborted) throw abortError();
        if (timedOut) throw new Error(t('Přenos překročil časový limit. Zkuste menší výběr.'));
        // Network/CORS errors are not blindly retried: the browser hides their cause.
        throw error;
      } finally {
        if (record) record.duration = this.now() - started;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }
  }
}
