/* Baker Bridge Rescue home-page cards.
   Fills two card grids from the home_cards table the /admin dashboard manages:
     #home-cards-pillars  -> the green "A new chapter" cards
     #home-cards-gifts    -> the gold "What your gift provides" cards
   Requires: supabase-js v2 UMD + config.js (window.APP_CONFIG) loaded first.
   If the table isn't set up (or the fetch fails), the hard-coded cards already
   in the page are left as a fallback. A section with no rows also keeps its
   fallback rather than rendering an empty grid. */
(function () {
  "use strict";

  var SECTIONS = ["pillars", "gifts", "partners"];

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

  function cardHTML(c) {
    return (
      '<div class="card case">' +
      "<h3>" + esc(c.title) + "</h3>" +
      (c.description ? '<p class="muted">' + esc(c.description) + "</p>" : "") +
      "</div>"
    );
  }

  function partnerHTML(c) {
    var visit = c.url
      ? '<a class="btn btn-quiet btn-sm" href="' + esc(c.url) + '" target="_blank" rel="noopener">Visit ' + esc(c.title) + "</a>"
      : "";
    return (
      '<div class="card partner-card">' +
      "<h3>" + esc(c.title) + "</h3>" +
      (c.tag ? '<div class="tag">' + esc(c.tag) + "</div>" : "") +
      (c.description ? "<p>" + esc(c.description) + "</p>" : "") +
      (c.meta ? '<div class="meta">' + esc(c.meta) + "</div>" : "") +
      visit +
      "</div>"
    );
  }

  async function mount() {
    var hosts = {
      pillars: document.getElementById("home-cards-pillars"),
      gifts: document.getElementById("home-cards-gifts"),
      partners: document.getElementById("home-cards-partners"),
    };
    if (!hosts.pillars && !hosts.gifts && !hosts.partners) return;
    var c = getClient();
    if (!c) return; // not configured — keep the fallback cards

    try {
      var res = await c
        .from("home_cards")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (res.error) return; // table not set up yet — keep the fallback cards
      var rows = res.data || [];

      SECTIONS.forEach(function (section) {
        var host = hosts[section];
        if (!host) return;
        var items = rows.filter(function (r) { return r.section === section; });
        // A section with no rows keeps its hard-coded fallback.
        if (!items.length) return;
        var render = section === "partners" ? partnerHTML : cardHTML;
        host.innerHTML = items.map(render).join("");
      });
    } catch (err) {
      console.error("[BBR home cards]", err); // keep the fallback cards
    }
  }

  window.BBRHomeCards = { mount: mount };

  mount();
})();
