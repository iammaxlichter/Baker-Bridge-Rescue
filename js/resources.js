/* Baker Bridge Rescue resources page.
   Reads active resources from the same Supabase table the /admin dashboard
   manages and rebuilds the collapsible link groups inside #resource-groups.
   Requires: supabase-js v2 UMD + config.js (window.APP_CONFIG) loaded first.
   If the table isn't set up yet (or the fetch fails), the hard-coded groups
   already in the page are left as a fallback. */
(function () {
  "use strict";

  // Group keys in the order they appear on the page.
  var GROUPS = [
    { key: "emergency", label: "Emergency and medical help for pet families" },
    { key: "shelters", label: "Grants for shelters and rescues" },
    { key: "foster", label: "Foster support" },
    { key: "community", label: "Community based support" },
  ];

  var CHEVRON =
    '<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';

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

  function itemHTML(r) {
    var title = r.url
      ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name) + "</a>"
      : esc(r.name);
    return (
      '<div class="res-item"><strong>' + title + "</strong>" +
      (r.description ? "<br /><span>" + esc(r.description) + "</span>" : "") +
      "</div>"
    );
  }

  function groupHTML(label, items, open) {
    return (
      '<details class="res-group reveal in"' + (open ? " open" : "") + ">" +
      "<summary>" + esc(label) + " " + CHEVRON + "</summary>" +
      '<div class="res-items">' + items.map(itemHTML).join("") + "</div>" +
      "</details>"
    );
  }

  async function mount() {
    var host = document.getElementById("resource-groups");
    if (!host) return;
    var c = getClient();
    if (!c) return; // not configured — keep the fallback groups

    try {
      var res = await c
        .from("resources")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (res.error) return; // table not set up yet — keep the fallback groups
      var rows = res.data || [];

      // Group by category, keep the known group order; unknown groups append last.
      var order = GROUPS.map(function (g) { return g.key; });
      var labels = {};
      GROUPS.forEach(function (g) { labels[g.key] = g.label; });
      var byGroup = {};
      rows.forEach(function (r) {
        (byGroup[r.category] = byGroup[r.category] || []).push(r);
      });
      Object.keys(byGroup).forEach(function (k) {
        if (order.indexOf(k) === -1) order.push(k);
        if (!labels[k]) labels[k] = k;
      });

      var html = "";
      var opened = false;
      order.forEach(function (key) {
        var items = byGroup[key];
        if (!items || !items.length) return;
        html += groupHTML(labels[key], items, !opened);
        opened = true;
      });

      if (!html) {
        host.innerHTML =
          '<p class="lede">We are adding resources here. Please check back soon.</p>';
        return;
      }
      host.innerHTML = html;
    } catch (err) {
      console.error("[BBR resources]", err); // keep the fallback groups
    }
  }

  window.BBRResources = { mount: mount };

  mount();
})();
