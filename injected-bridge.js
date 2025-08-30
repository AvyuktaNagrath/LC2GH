// injected-bridge.js — runs in page context; can read Monaco
(function () {
  function getMeta() {
    const titleEl = document.querySelector('[data-cy="question-title"], h1');
    const rawTitle = titleEl
      ? titleEl.textContent.trim()
      : (document.title || '').replace(/ - LeetCode.*/, '').trim();

    const m = location.pathname.match(/problems\/([^/]+)\//i) || location.pathname.match(/problems\/([^/]+)/i);
    const slug = m
      ? m[1]
      : rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    let language = '';
    const langEl =
      document.querySelector('[data-cy="lang-select"]') ||
      document.querySelector('div[data-cy="lang-select"]') ||
      document.querySelector('[data-cy="lang-item"] [aria-selected="true"]');
    if (langEl) language = (langEl.textContent || '').trim();

    let code = '';
    try {
      const models = window.monaco?.editor?.getModels?.() || [];
      if (models.length) code = models[0].getValue();
    } catch (_) {}
    if (!code) {
      const ta = document.querySelector('textarea');
      if (ta?.value) code = ta.value;
    }

    return { title: rawTitle, slug, language, code, url: location.href };
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.__LC_PULL_EDITOR__) {
      const meta = getMeta();
      window.postMessage({ __LC_PAYLOAD__: meta }, '*');
    }
  });
})();
