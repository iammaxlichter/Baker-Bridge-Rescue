/* Baker Bridge Rescue — public store
   Reads active products from the same Supabase table the /admin dashboard manages.
   Requires: supabase-js v2 UMD + config.js (window.APP_CONFIG) loaded first. */
(function () {
  "use strict";

  var PAW_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="12" cy="16.2" rx="4.4" ry="3.9"/><ellipse cx="4.9" cy="10.6" rx="1.9" ry="2.5" transform="rotate(-22 4.9 10.6)"/><ellipse cx="9.3" cy="6.9" rx="2" ry="2.7" transform="rotate(-8 9.3 6.9)"/><ellipse cx="14.7" cy="6.9" rx="2" ry="2.7" transform="rotate(8 14.7 6.9)"/><ellipse cx="19.1" cy="10.6" rx="1.9" ry="2.5" transform="rotate(22 19.1 10.6)"/></svg>';

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

  function formatPrice(price) {
    return "$" + Number(price).toFixed(2);
  }

  async function fetchProducts(limit) {
    var c = getClient();
    if (!c) throw new Error("Store is not configured. Add config.js with your Supabase values.");
    var q = c
      .from("products")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (limit) q = q.limit(limit);
    var res = await q;
    if (res.error) throw res.error;
    return res.data || [];
  }

  function cardHTML(p) {
    var altImg = (p.image_urls || []).filter(Boolean)[0];
    var media;
    if (p.image_url) {
      media =
        '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" loading="lazy" ' +
        "onerror=\"this.style.display='none';this.parentElement.querySelector('.ph').style.display='grid'\">" +
        (altImg ? '<img class="alt" src="' + esc(altImg) + '" alt="" loading="lazy" onerror="this.remove()">' : "") +
        '<span class="ph" style="display:none">' + PAW_SVG + "</span>";
    } else {
      media = '<span class="ph">' + PAW_SVG + "</span>";
    }
    return (
      '<article class="product-card reveal in">' +
      '<div class="product-media">' + media + "</div>" +
      '<div class="product-body">' +
      "<h3>" + esc(p.name) + "</h3>" +
      (p.price != null ? '<div class="product-price">' + formatPrice(p.price) + "</div>" : "") +
      (p.description ? '<p class="product-desc">' + esc(p.description) + "</p>" : "") +
      (p.shop_url
        ? '<a class="btn btn-terracotta btn-sm" href="' + esc(p.shop_url) + '" target="_blank" rel="noopener">Shop this item</a>'
        : "") +
      "</div></article>"
    );
  }

  function stateHTML(kind, msg) {
    return '<div class="store-state ' + kind + '"><p>' + esc(msg) + "</p></div>";
  }

  /* Mounts the product grid into a container.
     opts: { limit, emptyMsg } */
  async function mount(selector, opts) {
    opts = opts || {};
    var el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = stateHTML("loading", "Fetching the goods...");
    try {
      var products = await fetchProducts(opts.limit);
      if (!products.length) {
        el.innerHTML = stateHTML("empty", opts.emptyMsg || "New products are on the way. Check back soon.");
        return;
      }
      el.classList.add("product-grid");
      el.innerHTML = products.map(cardHTML).join("");
    } catch (err) {
      console.error("[BBR store]", err);
      el.innerHTML = stateHTML("error", "The store could not load right now. Please refresh or try again shortly.");
    }
  }

  window.BBRShop = { fetchProducts: fetchProducts, mount: mount };
})();
