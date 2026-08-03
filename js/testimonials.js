/* Baker Bridge Rescue "Happy endings" videos.
   Reads active testimonials from the same Supabase table the /admin dashboard
   manages, and fills the #happy-endings row on the home page.
   Requires: supabase-js v2 UMD + config.js (window.APP_CONFIG) loaded first.
   If the table isn't set up yet (or the fetch fails), the hard-coded cards
   already in the page are left untouched as a fallback. */
(function () {
  "use strict";

  var client = null;

  function getClient() {
    if (client) return client;
    var cfg = window.APP_CONFIG || {};
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return client;
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* Pull the video id out of any common YouTube URL shape. */
  function youtubeId(url) {
    var m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,})/);
    return m ? m[1] : "";
  }

  function cardHTML(t) {
    var id = youtubeId(t.youtube_url);
    var thumb = id ? "https://img.youtube.com/vi/" + id + "/hqdefault.jpg" : "";
    return (
      '<a class="testi-card" href="' + esc(t.youtube_url) + '" target="_blank" rel="noopener">' +
      '<div class="testi-thumb">' +
      (thumb ? '<img src="' + thumb + '" alt="' + esc(t.name) + "’s video\" loading=\"lazy\">" : "") +
      '<span class="play"><span><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></span>' +
      "</div>" +
      '<div class="testi-body">' +
      "<h3>" + esc(t.name) + "</h3>" +
      (t.description ? "<p>" + esc(t.description) + "</p>" : "") +
      '<span class="watch">Watch ' + esc(t.name) + "’s video</span>" +
      "</div></a>"
    );
  }

  async function mount() {
    var el = document.getElementById("happy-endings");
    if (!el) return;
    var c = getClient();
    if (!c) return; // not configured — keep the fallback cards

    try {
      var res = await c
        .from("testimonials")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (res.error) return; // table not set up yet — keep the fallback cards
      var rows = res.data || [];
      if (!rows.length) {
        // Table exists but the admin cleared it: hide the whole section.
        var section = el.closest("section");
        if (section) section.remove();
        return;
      }
      el.innerHTML = rows.map(cardHTML).join("");
    } catch (err) {
      console.error("[BBR testimonials]", err); // keep the fallback cards
    }
  }

  window.BBRTestimonials = { mount: mount };

  mount();
})();
