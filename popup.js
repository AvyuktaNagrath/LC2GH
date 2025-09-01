// popup.js — MV3-safe. Shows connected state + handles JWT refresh with leeway & single-flight.

document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_API = "http://localhost:8787";
  const LEEWAY_SEC = 90; // refresh a little early to avoid edge timing issues

  const btn = document.getElementById("connect");
  const status = document.getElementById("status");

  const setHTML = (html) => { if (status) status.innerHTML = html || ""; };
  const showButton = (show) => { if (btn) btn.style.display = show ? "inline-block" : "none"; };

  // ---- storage helpers (promise-wrapped) ----
  const storageGet = (keys) =>
    new Promise((resolve) => chrome.storage.local.get(keys || null, resolve));
  const storageSet = (obj) =>
    new Promise((resolve) => chrome.storage.local.set(obj, resolve));

  // ---- single-flight refresh guard ----
  let refreshPromise = null;

  async function refreshToken() {
    if (refreshPromise) return refreshPromise; // single flight
    refreshPromise = (async () => {
      const { apiBase, refresh_token, ext_instance_id } = await storageGet([
        "apiBase",
        "refresh_token",
        "ext_instance_id",
      ]);

      const base = apiBase || DEFAULT_API;
      if (!refresh_token) throw new Error("missing refresh_token");

      // ensure device id exists
      let deviceId = ext_instance_id;
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        await storageSet({ ext_instance_id: deviceId });
      }

      const res = await fetch(`${base}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token,
          ext_instance_id: deviceId,
        }),
      });

      if (!res.ok) {
        // hard reset on failed refresh
        await storageSet({ jwt: null, refresh_token: null, exp: 0 });
        throw new Error(`refresh failed: ${res.status}`);
      }

      const data = await res.json();
      await storageSet({
        jwt: data.jwt,
        refresh_token: data.refresh_token,
        exp: Number(data.exp) || 0,
        apiBase: base,
      });
      return data.jwt;
    })();

    try {
      const jwt = await refreshPromise;
      return jwt;
    } finally {
      refreshPromise = null; // clear lock
    }
  }

  async function getValidJwt() {
    const { jwt, exp } = await storageGet(["jwt", "exp"]);
    const nowSec = Math.floor(Date.now() / 1000);
    const isExpired = !exp || Number.isNaN(exp) || nowSec >= (Number(exp) - LEEWAY_SEC);
    if (!jwt || isExpired) {
      return await refreshToken(); // may throw; caller should handle
    }
    return jwt;
  }

  async function fetchSettingsWithAuth() {
    const { apiBase } = await storageGet(["apiBase"]);
    const base = apiBase || DEFAULT_API;

    // pre-check & potential refresh
    let token;
    try {
      token = await getValidJwt();
    } catch {
      // no valid/refreshable token: surface as 401-ish
      const err = new Error("no valid token");
      err.status = 401;
      throw err;
    }

    let res = await fetch(`${base}/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // 401 fallback → refresh then retry once
    if (res.status === 401) {
      try {
        const newJwt = await refreshToken();
        res = await fetch(`${base}/v1/settings`, {
          headers: { Authorization: `Bearer ${newJwt}` },
        });
      } catch (e) {
        // give up; propagate
        const err = new Error("unauthorized");
        err.status = 401;
        throw err;
      }
    }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    return res.json();
  }

  async function showConnected() {
    try {
      const s = await fetchSettingsWithAuth();
      setHTML(`
        <div style="display:flex;align-items:center;gap:8px;line-height:1.3;">
          <img src="${s.avatar_url}" width="24" height="24" style="border-radius:50%">
          <div>
            <div>Connected as <b>${s.login}</b></div>
            <div style="font-size:11px;">
              Repo: <a href="https://github.com/${s.full_name}" target="_blank" rel="noreferrer noopener">${s.full_name}</a>
            </div>
          </div>
        </div>
      `);
      showButton(false);
      return true;
    } catch (e) {
      // Not connected or failed auth → show button
      showButton(true);
      // Keep status area minimal on first load; optionally show a hint:
      // setHTML("Not connected");
      return false;
    }
  }

  // Connect button click → full auth flow
  btn?.addEventListener("click", async () => {
    try {
      setHTML("Opening GitHub…");
      const { apiBase } = await storageGet(["apiBase"]);
      const base = apiBase || DEFAULT_API;

      const EXT_REDIRECT = chrome.identity.getRedirectURL("provider_cb.html");
      const url = `${base}/auth/github/start?client=ext&redirect=${encodeURIComponent(
        EXT_REDIRECT
      )}&nonce=${crypto.randomUUID()}`;

      chrome.identity.launchWebAuthFlow({ url, interactive: true }, async (cbUrl) => {
        if (chrome.runtime.lastError) {
          setHTML(`Auth error: ${chrome.runtime.lastError.message || "unknown"}`);
          showButton(true);
          return;
        }
        if (!cbUrl) {
          setHTML("Auth cancelled.");
          showButton(true);
          return;
        }

        try {
          const hash = new URL(cbUrl).hash.slice(1);
          const params = new URLSearchParams(hash);

          const jwt = params.get("jwt");
          const refresh = params.get("refresh");
          const exp = Number(params.get("exp"));

          if (!jwt || !refresh || !exp) {
            setHTML("Missing tokens in callback.");
            showButton(true);
            return;
          }

          // ensure ext_instance_id exists (binds device on first refresh)
          const { ext_instance_id } = await storageGet(["ext_instance_id"]);
          const deviceId = ext_instance_id || crypto.randomUUID();

          await storageSet({
            jwt,
            refresh_token: refresh,
            exp,
            apiBase: base,
            ext_instance_id: deviceId,
          });

          setHTML("Linked to GitHub ✅");
          await showConnected(); // update UI immediately
          window.close();
        } catch (e) {
          setHTML(`Parse error: ${String(e)}`);
          showButton(true);
        }
      });
    } catch (e) {
      setHTML(`Unexpected error: ${String(e)}`);
      showButton(true);
    }
  });

  // On load: attempt to show connected state (handles refresh if needed)
  showConnected();
});
