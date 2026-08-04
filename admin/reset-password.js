/* Baker Bridge Rescue admin — password reset / invite setup.
   Supabase recovery and invite emails redirect here. This page turns the token
   in the URL into a session, then lets the user set a password.

   It handles both link shapes Supabase can send:
     - Implicit flow: tokens in the URL hash
       (#access_token=...&refresh_token=...&type=recovery|invite)
     - PKCE flow: a code in the query string (?code=...)

   Requires: supabase-js v2 UMD + ../config.js (window.APP_CONFIG). */
(function () {
  "use strict";

  var ADMIN_HOME = "index.html"; // resolves to /admin/

  var cfg = window.APP_CONFIG || {};
  var client =
    window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          // We process the token ourselves (below) rather than relying on the
          // client's auto-detection, so behavior is the same for hash and code
          // links and there's no race with page scripts.
          auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: false },
        })
      : null;

  var els = {
    loading: document.getElementById("rp-loading"),
    error: document.getElementById("rp-error"),
    invalid: document.getElementById("rp-invalid"),
    form: document.getElementById("rp-form"),
    success: document.getElementById("rp-success"),
    pw: document.getElementById("rp-password"),
    confirm: document.getElementById("rp-confirm"),
    submit: document.getElementById("rp-submit"),
  };

  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }
  function setError(msg) {
    if (!els.error) return;
    if (!msg) { hide(els.error); els.error.textContent = ""; return; }
    els.error.textContent = msg;
    show(els.error);
  }

  function params() {
    return {
      hash: new URLSearchParams((window.location.hash || "").replace(/^#/, "")),
      query: new URLSearchParams(window.location.search || ""),
    };
  }

  // Turn whatever token is in the URL into an authenticated session.
  async function establishRecoverySession() {
    if (!client) {
      throw new Error("This page is not configured. Add config.js with your Supabase values.");
    }

    var p = params();

    // 1. Supabase reported an error on the link itself (expired / already used).
    var errDesc =
      p.hash.get("error_description") || p.query.get("error_description") ||
      p.hash.get("error") || p.query.get("error");
    if (errDesc) throw new Error(decodeURIComponent(String(errDesc).replace(/\+/g, " ")));

    // 2. Implicit flow: access + refresh tokens in the hash.
    var access_token = p.hash.get("access_token");
    var refresh_token = p.hash.get("refresh_token");
    if (access_token && refresh_token) {
      var r1 = await client.auth.setSession({ access_token: access_token, refresh_token: refresh_token });
      if (r1.error) throw r1.error;
      return true;
    }

    // 3. PKCE flow: an auth code in the query string.
    var code = p.query.get("code");
    if (code) {
      var r2 = await client.auth.exchangeCodeForSession(code);
      if (r2.error) throw r2.error;
      return true;
    }

    // 4. No token in the URL — only valid if a session somehow already exists.
    var r3 = await client.auth.getSession();
    return !!(r3.data && r3.data.session);
  }

  async function init() {
    try {
      var ok = await establishRecoverySession();
      hide(els.loading);
      if (ok) {
        show(els.form);
        // Strip the token from the address bar so it isn't left in history.
        try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
      } else {
        show(els.invalid);
      }
    } catch (err) {
      hide(els.loading);
      show(els.invalid);
      setError(err && err.message ? err.message : "This link is invalid or has expired.");
    }
  }

  if (els.form) {
    els.form.addEventListener("submit", async function (e) {
      e.preventDefault();
      setError(null);

      var pw = els.pw.value;
      var confirm = els.confirm.value;
      if (pw.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (pw !== confirm) { setError("The passwords do not match."); return; }

      var original = els.submit.textContent;
      els.submit.disabled = true;
      els.submit.textContent = "Saving…";

      var res = await client.auth.updateUser({ password: pw });
      if (res.error) {
        setError(res.error.message);
        els.submit.disabled = false;
        els.submit.textContent = original;
        return;
      }

      hide(els.form);
      show(els.success);
      setTimeout(function () { window.location.href = ADMIN_HOME; }, 1500);
    });
  }

  init();
})();
