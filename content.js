// content.js

(function () {
  const log = (...a) => console.log("[LC2GH]", ...a);

  // Inject bridge
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected-bridge.js');
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
  s.remove();

  const ACCEPTED_RE = /(^|\b)Accepted(\b|$)/i;

    // ---- Toast UI state (minimal, no CSS files) ----
  let toastEl = null;
  let replaceBtn = null;
  let statusSpan = null;
  let linkEl = null;
  let acceptedNow = false;
  let lastSlug = "";
  let forceReplace = false; // NEW: bypass local dedupe for manual replace


  function getSlugFromPath() {
    const m = location.pathname.match(/problems\/([^/]+)/i);
    return m ? m[1] : "";
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    Object.assign(toastEl.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 999999,
      background: 'rgba(20,20,20,0.92)', color: '#fff', padding: '10px 12px',
      borderRadius: '8px', fontSize: '12px', lineHeight: '1.4',
      boxShadow: '0 6px 18px rgba(0,0,0,0.3)', maxWidth: '320px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
    });

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    statusSpan = document.createElement('span');
    statusSpan.textContent = 'LC2GH: …';

    linkEl = document.createElement('a');
    linkEl.href = '#';
    linkEl.target = '_blank';
    linkEl.rel = 'noreferrer noopener';
    linkEl.style.color = '#8ab4ff';
    linkEl.style.textDecoration = 'underline';
    linkEl.style.display = 'none';
    linkEl.textContent = 'View on GitHub';

    replaceBtn = document.createElement('button');
    replaceBtn.textContent = 'Replace submission';
    Object.assign(replaceBtn.style, {
      marginLeft: 'auto', padding: '4px 8px', borderRadius: '6px',
      border: '1px solid #444', background: '#2a2a2a', color: '#fff',
      cursor: 'pointer'
    });
    replaceBtn.disabled = true;
    replaceBtn.addEventListener('click', () => {
      if (!acceptedNow) return; // gate by current Accepted state
      forceReplace = true;      // NEW: allow re-submit even if code unchanged
      window.postMessage({ __LC_PULL_EDITOR__: true }, '*');
    });


    row.appendChild(statusSpan);
    row.appendChild(linkEl);
    row.appendChild(replaceBtn);
    toastEl.appendChild(row);
    (document.body || document.documentElement).appendChild(toastEl);
    return toastEl;
  }

  function renderStatus({ exists, html_file }) {
    ensureToast();
    if (exists) {
      statusSpan.textContent = 'LC2GH: Already submitted';
      if (html_file) {
        linkEl.style.display = '';
        linkEl.href = html_file;
      } else {
        linkEl.style.display = 'none';
      }
    } else {
      statusSpan.textContent = 'LC2GH: Not submitted yet';
      linkEl.style.display = 'none';
    }
  }

  function setReplaceEnabled(on) {
    ensureToast();
    acceptedNow = !!on;
    replaceBtn.disabled = !acceptedNow;
    replaceBtn.style.opacity = acceptedNow ? '1' : '0.6';
    replaceBtn.style.cursor = acceptedNow ? 'pointer' : 'not-allowed';
  }

  function queryStatusForCurrentSlug() {
    const slug = getSlugFromPath();
    if (!slug) return;
    lastSlug = slug;
    chrome.runtime.sendMessage({ type: "LC2GH_STATUS", slug }, (resp) => {
      if (!resp || !resp.ok) {
        renderStatus({ exists: false });
        return;
      }
      const { exists, html_file } = resp.data || {};
      renderStatus({ exists: !!exists, html_file });
    });
  }

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
      // NEW: refresh toast status after submit (auto or replace)
      try { queryStatusForCurrentSlug(); } catch {}
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
    if (!forceReplace && seenKeys.has(key)) { log("duplicate; skipping"); return; } // CHANGED
    seenKeys.add(key);
    forceReplace = false; // NEW: reset after use


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
        setReplaceEnabled(true); // NEW: enable "Replace" when Accepted is visible
        log("Accepted detected");
        window.postMessage({ __LC_PULL_EDITOR__: true }, '*');
      } else {
        setReplaceEnabled(false); // NEW: disable when not Accepted
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

    // Initial toast + status
  ensureToast();
  queryStatusForCurrentSlug();

  // Minimal SPA router detection for LeetCode (URL changes without reload)
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setReplaceEnabled(false); // reset on navigation until Accepted shows again
      queryStatusForCurrentSlug();
    }
  }, 800);

})();
