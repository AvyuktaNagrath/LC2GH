(function () {
  const log = (...a) => console.log("[LC2GH]", ...a);

  // Inject bridge
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected-bridge.js');
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
  s.remove();

  const ACCEPTED_RE = /(^|\b)Accepted(\b|$)/i;
  const seenKeys = new Set();

  function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', data).then(buf =>
      [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
    );
  }

  async function postSubmission(payload) {
  chrome.runtime.sendMessage({ type: "LC2GH_SUBMIT", payload }, (resp) => {
    console.log("[LC2GH] submit via background:", resp);
  });
}


  async function handlePayload(p) {
    const text = document.body?.innerText || '';
    const runtimeMatch = text.match(/Runtime:\s*([0-9.]+\s*ms)/i);
    const memoryMatch  = text.match(/Memory:\s*([0-9.]+\s*MB)/i);
    const langMatch    = text.match(/Language:\s*([A-Za-z+#0-9 ]+)/i);

    let difficulty = '';
    const diffEl = Array.from(document.querySelectorAll('span,div'))
      .find(el => /^(Easy|Medium|Hard)$/i.test((el.textContent || '').trim()));
    if (diffEl) difficulty = diffEl.textContent.trim();

    const payload = {
      title: p.title,
      slug: p.slug,
      url: p.url,
      language: p.language || (langMatch ? langMatch[1].trim() : ''),
      difficulty,
      runtime: runtimeMatch ? runtimeMatch[1] : '',
      memory: memoryMatch ? memoryMatch[1] : '',
      timestamp: new Date().toISOString(),
      code: p.code || ''
    };

    const key = await sha256Hex(`${payload.slug}|${payload.language}|${payload.code}`);
    if (seenKeys.has(key)) { log("duplicate; skipping"); return; }
    seenKeys.add(key);

    // cache in extension storage (optional, unchanged)
    chrome.storage.local.get({ snapshots: [] }, ({ snapshots }) => {
      snapshots.unshift(payload);
      chrome.storage.local.set({ snapshots: snapshots.slice(0, 1000) });
    });

    // 👉 send to background to perform the downloads
    chrome.runtime.sendMessage({ type: "LC2GH_DOWNLOAD", payload }, (resp) => {
      log("background responded:", resp);
    });

    postSubmission(payload);

  }

  // Detect Accepted
  const mo = new MutationObserver(() => {
    if (ACCEPTED_RE.test(document.body?.innerText || '')) {
      log("Accepted detected");
      window.postMessage({ __LC_PULL_EDITOR__: true }, '*');
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Fallback poll
  setInterval(() => {
    if (ACCEPTED_RE.test(document.body?.innerText || '')) {
      log("Accepted detected (poll)");
      window.postMessage({ __LC_PULL_EDITOR__: true }, '*');
    }
  }, 2000);

  // Manual hotkey: Alt+J to force capture
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'j') {
      log("Manual capture (Alt+J)");
      window.postMessage({ __LC_PULL_EDITOR__: true }, '*');
    }
  });

  // Receive editor payload
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.__LC_PAYLOAD__) {
      log("payload from bridge", e.data.__LC_PAYLOAD__);
      handlePayload(e.data.__LC_PAYLOAD__).catch(console.error);
    }
  });
})();
