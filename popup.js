// popup.js — MV3-safe (no inline). Handles GitHub App linking + status display.
document.addEventListener("DOMContentLoaded", () => {
  const API = "http://localhost:8787"; // match your App settings
  const btn = document.getElementById("connect");
  const status = document.getElementById("status");

  function setStatus(html) {
    if (status) status.innerHTML = html || "";
  }

  async function showConnected() {
    const { jwt, apiBase } = await chrome.storage.local.get(["jwt", "apiBase"]);
    if (!jwt) return false;

    try {
      const res = await fetch(`${apiBase}/v1/settings`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();

      setStatus(`
        <div style="display:flex;align-items:center;gap:6px;">
          <img src="${s.avatar_url}" width="24" height="24" style="border-radius:50%">
          <div>
            <div>Connected as <b>${s.login}</b></div>
            <div style="font-size:11px;">
              Repo: <a href="https://github.com/${s.full_name}" target="_blank">${s.full_name}</a>
            </div>
          </div>
        </div>
      `);

      // Hide the connect button once connected
      if (btn) btn.style.display = "none";
      return true;
    } catch (e) {
      console.warn("settings fetch failed:", e);
      return false;
    }
  }

  btn?.addEventListener("click", async () => {
    try {
      setStatus("Opening GitHub…");
      const EXT_REDIRECT = chrome.identity.getRedirectURL("provider_cb.html");
      const url = `${API}/auth/github/start?client=ext&redirect=${encodeURIComponent(
        EXT_REDIRECT
      )}&nonce=${crypto.randomUUID()}`;

      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (cbUrl) => {
        if (chrome.runtime.lastError) {
          setStatus(`Auth error: ${chrome.runtime.lastError.message || "unknown"}`);
          return;
        }
        if (!cbUrl) {
          setStatus("Auth cancelled.");
          return;
        }

        try {
          const hash = new URL(cbUrl).hash.slice(1);
          const params = new URLSearchParams(hash);

          const jwt = params.get("jwt");
          const refresh = params.get("refresh");
          const exp = Number(params.get("exp"));

          if (!jwt || !refresh || !exp) {
            setStatus("Missing tokens in callback.");
            return;
          }

          chrome.storage.local.set(
            {
              jwt,
              refresh_token: refresh,
              exp,
              apiBase: API,
              ext_instance_id: crypto.randomUUID(),
            },
            async () => {
              setStatus("Linked to GitHub ✅");
              await showConnected(); // immediately update UI
              window.close();
            }
          );
        } catch (e) {
          setStatus(`Parse error: ${String(e)}`);
        }
      });
    } catch (e) {
      setStatus(`Unexpected error: ${String(e)}`);
    }
  });

  // On load: if already connected, show info
  showConnected();
});
