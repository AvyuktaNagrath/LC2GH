// background.js — MV3-safe downloads via data URLs (no createObjectURL)
const log = (...a) => console.log("[LC2GH/bg]", ...a);

// helper: UTF-8 → base64 (handles Unicode safely)
function b64(str) {
  return btoa(unescape(encodeURIComponent(str || "")));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "LC2GH_DOWNLOAD") return;

  try {
    const p = msg.payload;
    log("download request from tab", sender.tab?.id, p?.slug);

    // 1) JSON
    const json = JSON.stringify(p, null, 2);
    const jsonDataUrl = `data:application/json;base64,${b64(json)}`;
    chrome.downloads.download(
      {
        url: jsonDataUrl,
        filename: `lc2gh-${p.slug}-${Date.now()}.json`,
        saveAs: false
      },
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
      {
        url: mdDataUrl,
        filename: `lc2gh-${p.slug}-${Date.now()}.md`,
        saveAs: false
      },
      (id) => log("md download id:", id)
    );

    sendResponse({ ok: true });
  } catch (e) {
    console.error("[LC2GH/bg] download error:", e);
    sendResponse({ ok: false, error: String(e) });
  }

  // return true to keep the message channel open until sendResponse runs
  return true;
});
