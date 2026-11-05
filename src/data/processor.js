import { t, getLanguage } from '../i18n/index.js';
import { abortError, checkSignal } from '../core/http.js';

export class Processor {
  constructor(source) {
    this.source = source;
    this.worker = null;
    this.sequence = 0;
    this.pending = new Map();
    this.indexKey = null;
  }
  start() {
    if (this.worker) return;
    const url = URL.createObjectURL(new Blob([this.source], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.type === 'progress') {
        pending.onProgress?.({ phase: 'processing', percent: data.value, rows: data.rows });
        return;
      }
      this.pending.delete(data.id);
      pending.cleanup();
      if (data.type === 'error') {
        this.indexKey = null;
        const error = new Error(data.message);
        error.name = data.name || 'Error';
        pending.reject(error);
      } else {
        if (data.data?.indexKey) this.indexKey = data.data.indexKey;
        pending.resolve(data.data);
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.stop(new Error(t('Zpracování dat na pozadí selhalo.')));
    };
  }
  request(message, { signal, onProgress } = {}) {
    checkSignal(signal);
    this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const abort = () => this.stop(abortError());
      this.pending.set(id, {
        resolve,
        reject,
        onProgress,
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage({ ...message, id, language: getLanguage() });
      } catch (error) {
        this.stop(error);
      }
    });
  }
  stop(error = abortError()) {
    this.worker?.terminate();
    this.worker = null;
    this.indexKey = null;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
