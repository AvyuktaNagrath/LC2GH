// background.js — MV3 service worker

const log = (...a) => console.log("[LC2GH/bg]", ...a);

// helper: UTF-8 → base64 (handles Unicode safely)
function b64(str) {
  return btoa(unescape(encodeURIComponent(str || "")));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return; // ignore

  // ---- Upload to backend from extension context ----
  if (msg.type === "LC2GH_SUBMIT") {
    (async () => {
      try {
        const { jwt, apiBase } = await chrome.storage.local.get(["jwt", "apiBase"]);
        if (!jwt || !apiBase) {
          return sendResponse({ ok: false, error: "no auth in storage" });
        }

        const idem =
          (self.crypto && self.crypto.randomUUID && self.crypto.randomUUID()) ||
          (Date.now() + ":" + Math.random());

        const res = await fetch(`${apiBase}/v1/submissions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${jwt}`,
            "Idempotency-Key": idem
          },
          body: JSON.stringify(msg.payload || {})
        });

        let data = {};
        try { data = await res.json(); } catch {}
        sendResponse({ ok: res.ok, status: res.status, data });
      } catch (e) {
        console.error("[LC2GH/bg] submit error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

    // ---- NEW: status lookup for a given slug (minimal) ----
  if (msg.type === "LC2GH_STATUS") {
    (async () => {
      try {
        const slug = (msg.slug || "").trim();
        if (!slug) return sendResponse({ ok: false, error: "missing slug" });

        const { jwt, apiBase } = await chrome.storage.local.get(["jwt", "apiBase"]);
        if (!jwt || !apiBase) {
          return sendResponse({ ok: false, error: "no auth in storage" });
        }

        const url = `${apiBase}/v1/submissions/status?slug=${encodeURIComponent(slug)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });

        let data = {};
        try { data = await res.json(); } catch {}
        sendResponse({ ok: res.ok, status: res.status, data });
      } catch (e) {
        console.error("[LC2GH/bg] status error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }


  // ---- Existing debug downloads path (kept) ----
  if (msg.type === "LC2GH_DOWNLOAD") {
    try {
      const p = msg.payload;
      log("download request from tab", sender.tab?.id, p?.slug);

      // 1) JSON
      const json = JSON.stringify(p, null, 2);
      const jsonDataUrl = `data:application/json;base64,${b64(json)}`;
      chrome.downloads.download(
        { url: jsonDataUrl, filename: `lc2gh-${p.slug}-${Date.now()}.json`, saveAs: false },
        (id) => log("json download id:", id)
      );

      // 2) Markdown
      const md = `# ${p.title}
- **Slug:** ${p.slug}
- **Difficulty:** ${p.difficulty || '—'}
- **Language:** ${p.language || '—'}
- **Runtime / Memory:** ${p.runtime || '—'} / ${p.memory || '—'}
- **Source:** ${p.url}
- **Captured:** ${p.timestamp}

## Code
\`\`\`
${(p.code || "").slice(0, 120000)}
\`\`\`
`;
      const mdDataUrl = `data:text/markdown;base64,${b64(md)}`;
      chrome.downloads.download(
        { url: mdDataUrl, filename: `lc2gh-${p.slug}-${Date.now()}.md`, saveAs: false },
        (id) => log("md download id:", id)
      );

      sendResponse({ ok: true });
    } catch (e) {
      console.error("[LC2GH/bg] download error:", e);
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
});
