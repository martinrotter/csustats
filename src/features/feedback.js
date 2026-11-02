export function createFeedback(app) {
  function toast(message) {
    app.$('toast').textContent = message;
    app.$('toast').classList.remove('hidden');
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(() => app.$('toast').classList.add('hidden'), 5000);
  }
  function notice(message, error = false, retry = false) {
    app.$('notice').replaceChildren();
    if (!message) {
      app.$('notice').classList.add('hidden');
      return;
    }
    const text = document.createElement('span');
    text.textContent = message;
    app.$('notice').append(text);
    app.$('notice').className = `notice${error ? ' error' : ''}`;
    if (retry) {
      const button = document.createElement('button');
      button.className = 'button';
      button.textContent = 'Zkusit znovu';
      button.onclick = () => app.initializeCatalog();
      app.$('notice').append(button);
    }
  }
  return { toast, notice };
}
