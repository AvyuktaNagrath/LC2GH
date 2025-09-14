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
  let statusSpan = null;
  let linkEl = null;
  let submitBtn = null;

  // Track current status of this slug so we can switch button behavior
  let currentExists = false;

  function getSlugFromPath() {
    const m = location.pathname.match(/problems\/([^/]+)/i);
    return m ? m[1] : "";
  }

  // Simple Accepted detector (used only for warning copy)
  function hasAcceptedResult() {
    const t = document.body?.innerText || '';
    return (
      ACCEPTED_RE.test(t) &&
      /Runtime:\s*[0-9.]+\s*ms/i.test(t) &&
      /Memory:\s*[0-9.]+\s*MB/i.test(t)
    );
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    Object.assign(toastEl.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 999999,
      background: 'rgba(20,20,20,0.92)', color: '#fff', padding: '10px 12px',
      borderRadius: '8px', fontSize: '12px', lineHeight: '1.4',
      boxShadow: '0 6px 18px rgba(0,0,0,0.3)', maxWidth: '340px',
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

    // Manual submit/replace button (label set by renderStatus)
    submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit to GitHub';
    Object.assign(submitBtn.style, {
      marginLeft: 'auto', padding: '4px 8px', borderRadius: '6px',
      border: '1px solid #444', background: '#3b82f6', color: '#fff',
      cursor: 'pointer'
    });
    submitBtn.addEventListener('click', () => {
      // Accepted warning (both submit and replace)
      if (!hasAcceptedResult()) {
        const okAccepted = window.confirm(
          "This page doesn’t show an Accepted result.\n" +
          "Continue anyway?"
        );
        if (!okAccepted) return;
        window.__LC2GH_bypassOnce = true; // one-shot bypass
      }

      // Replace-specific confirm if already exists
      if (currentExists) {
        const okReplace = window.confirm(
          "A submission for this problem already exists in your repo.\n" +
          "This will commit a new version (replace). Continue?"
        );
        if (!okReplace) return;
        window.__LC2GH_forceReplaceOnce = true; // one-shot bypass of dedupe
      }

      // Pull editor payload
      window.postMessage({ __LC_PULL_EDITOR__: true, __LC_MANUAL__: true }, '*');
    });

    row.appendChild(statusSpan);
    row.appendChild(linkEl);
    row.appendChild(submitBtn);
    toastEl.appendChild(row);
    (document.body || document.documentElement).appendChild(toastEl);
    return toastEl;
  }

  function renderStatus({ exists, html_file }) {
    ensureToast();
    currentExists = !!exists;

    if (exists) {
      statusSpan.textContent = 'LC2GH: Already submitted';
      submitBtn.textContent = 'Replace on GitHub';
      if (html_file) {
        linkEl.style.display = '';
        linkEl.href = html_file;
      } else {
        linkEl.style.display = 'none';
      }
    } else {
      statusSpan.textContent = 'LC2GH: Not submitted yet';
      submitBtn.textContent = 'Submit to GitHub';
      linkEl.style.display = 'none';
    }
  }

  function queryStatusForCurrentSlug() {
    const slug = getSlugFromPath();
    if (!slug) return;
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
      try { queryStatusForCurrentSlug(); } catch {}
    });
  }

  async function handlePayload(p) {
    // Gate only if user didn't confirm the bypass and no Accepted visible.
    const bypassAccepted = !!window.__LC2GH_bypassOnce;
    if (!bypassAccepted && !hasAcceptedResult()) {
      log("skip submit: no accepted result panel on this page");
      return;
    }
    window.__LC2GH_bypassOnce = false; // consume one-shot bypass

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

    // Dedupe unless user explicitly chose "replace" this time
    const forceReplaceThisClick = !!window.__LC2GH_forceReplaceOnce;
    const key = await sha256Hex(`${payload.slug}|${payload.language}|${payload.code}`);
    if (!forceReplaceThisClick && seenKeys.has(key)) { log("duplicate; skipping"); return; }
    seenKeys.add(key);
    window.__LC2GH_forceReplaceOnce = false; // consume one-shot flag

    // cache in extension storage (optional, unchanged)
    chrome.storage.local.get({ snapshots: [] }, ({ snapshots }) => {
      snapshots.unshift(payload);
      chrome.storage.local.set({ snapshots: snapshots.slice(0, 1000) });
    });

    // Local debug downloads (unchanged)
    chrome.runtime.sendMessage({ type: "LC2GH_DOWNLOAD", payload }, (resp) => {
      log("background responded:", resp);
    });

    postSubmission(payload);
  }

  // Receive editor payload (manual-only path)
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
      queryStatusForCurrentSlug();
    }
  }, 800);
})();
