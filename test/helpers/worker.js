import vm from 'node:vm';

class FileReader {
  readAsText(blob) {
    blob
      .text()
      .then((result) => this.onload?.({ target: { result } }))
      .catch((error) => this.onerror?.({ target: { error } }));
  }
}

export function createWorker(source) {
  let pending;
  const context = {
    Blob,
    Object,
    FileReader,
    console,
    setTimeout,
    clearTimeout,
    postMessage(message) {
      if (message.type === 'result') pending.resolve(message.data);
      if (message.type === 'error') pending.reject(new Error(message.message));
    },
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return (data) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker did not finish.')), 10000);
      pending = {
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
      };
      context.self.onmessage({ data: { id: 1, ...data } });
    });
}
