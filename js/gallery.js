/* Baker Bridge Rescue public pet gallery.
   Reads active photos from the same Supabase table the /admin dashboard manages.
   Two categories: 'new' (the sanctuary today) and 'old' (the rescue that was).
   Requires: supabase-js v2 UMD + config.js (window.APP_CONFIG) loaded first. */
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

  async function fetchPhotos() {
    var c = getClient();
    if (!c) throw new Error("Gallery is not configured. Add config.js with your Supabase values.");
    var res = await c
      .from("gallery_photos")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (res.error) throw res.error;
    return res.data || [];
  }

  var COLS = 3;

  function figureHTML(photo) {
    return (
      "<figure>" +
      '<img src="' + esc(photo.image_url) + '" alt="' + esc(photo.alt_text) + '" loading="lazy" ' +
      "onerror=\"this.closest('figure').remove()\">" +
      (photo.caption ? "<figcaption>" + esc(photo.caption) + "</figcaption>" : "") +
      "</figure>"
    );
  }

  function bySortOrder(a, b) {
    return (a.sort_order || 0) - (b.sort_order || 0);
  }

  /* Distribute a category's photos into COLS columns.
     - After the column_index migration: honor each photo's stored column and
       its position within that column (sort_order).
     - Before it (column_index absent): fall back to round-robin in sort_order,
       so the gallery still looks balanced instead of piling into one column. */
  function toColumns(photos) {
    var cols = [];
    var i;
    for (i = 0; i < COLS; i++) cols.push([]);

    var hasColumns = photos.some(function (p) {
      return p.column_index !== undefined && p.column_index !== null;
    });

    if (hasColumns) {
      photos.forEach(function (p) {
        var c = parseInt(p.column_index, 10);
        if (isNaN(c) || c < 0) c = 0;
        if (c > COLS - 1) c = COLS - 1;
        cols[c].push(p);
      });
      cols.forEach(function (col) { col.sort(bySortOrder); });
    } else {
      photos.slice().sort(bySortOrder).forEach(function (p, idx) {
        cols[idx % COLS].push(p);
      });
    }
    return cols;
  }

  function columnsHTML(photos) {
    return toColumns(photos)
      .map(function (col) {
        return '<div class="masonry-col">' + col.map(figureHTML).join("") + "</div>";
      })
      .join("");
  }

  /* Each section is a <section data-gallery="new|old"> whose .masonry gets
     filled in. A section with no photos removes itself so the page never
     shows an empty heading. */
  async function mount() {
    var sections = Array.prototype.slice.call(document.querySelectorAll("[data-gallery]"));
    if (!sections.length) return;

    sections.forEach(function (section) {
      var grid = section.querySelector(".masonry");
      if (!grid) return;
      // .is-state drops the column layout so the message is not split across columns
      grid.classList.add("is-state");
      grid.innerHTML = '<div class="store-state loading"><p>Loading photos</p></div>';
    });

    var photos;
    try {
      photos = await fetchPhotos();
    } catch (err) {
      console.error("[BBR gallery]", err);
      sections.forEach(function (section) {
        var grid = section.querySelector(".masonry");
        if (grid) {
          grid.innerHTML =
            '<div class="store-state error"><p>The photos could not load right now. Please refresh or try again shortly.</p></div>';
        }
      });
      return;
    }

    sections.forEach(function (section) {
      var category = section.getAttribute("data-gallery");
      var grid = section.querySelector(".masonry");
      var mine = photos.filter(function (p) { return p.category === category; });

      if (!mine.length) {
        section.remove();
        return;
      }
      grid.classList.remove("is-state");
      grid.innerHTML = columnsHTML(mine);
    });
  }

  window.BBRGallery = { fetchPhotos: fetchPhotos, mount: mount };

  mount();
})();
