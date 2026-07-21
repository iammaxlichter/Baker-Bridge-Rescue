/* Baker Bridge Rescue shared site behavior */
(function () {
  "use strict";

  /* Header scroll state, via a top-of-page sentinel rather than a
     scroll listener firing on every frame. */
  var header = document.querySelector(".site-header");
  if (header && "IntersectionObserver" in window) {
    var sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:24px;pointer-events:none;";
    document.body.prepend(sentinel);
    new IntersectionObserver(function (entries) {
      header.classList.toggle("scrolled", !entries[0].isIntersecting);
    }).observe(sentinel);
  }

  /* Some in-app browsers (Messages, Instagram, etc.) ignore the autoplay
     HTML attribute even with muted + playsinline set. Kick playback
     explicitly and retry once on first user touch if it was blocked. */
  var heroVideo = document.querySelector(".hero video");
  if (heroVideo) {
    heroVideo.muted = true;
    var tryPlay = function () { return heroVideo.play(); };
    tryPlay().catch(function () {
      document.addEventListener("touchstart", tryPlay, { once: true, passive: true });
    });
  }

  /* Mobile nav */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") links.classList.remove("open");
    });
  }

  /* Scroll reveals. Adding .in also triggers any .uline--scroll inside. */
  var revealables = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealables.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18 }
    );
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("in"); });
  }

  /* Ledger stats are facts, not live metrics, so they are set once and
     stamped in via CSS (see .reveal.in .stat .num) rather than counted up. */
  document.querySelectorAll("[data-count]").forEach(function (el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var suffix = el.getAttribute("data-suffix") || "";
    el.textContent = target.toLocaleString() + suffix;
  });

  /* Lightbox (gallery) */
  var lbFigures = Array.prototype.slice.call(document.querySelectorAll("[data-lightbox] figure"));
  if (lbFigures.length) {
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML =
      '<button class="lb-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<button class="lb-prev" aria-label="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<button class="lb-next" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' +
      "<img alt=\"\">";
    document.body.appendChild(lb);
    var lbImg = lb.querySelector("img");
    var idx = 0;

    function show(i) {
      idx = (i + lbFigures.length) % lbFigures.length;
      var img = lbFigures[idx].querySelector("img");
      lbImg.src = img.src;
      lbImg.alt = img.alt || "";
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
    }
    function close() {
      lb.classList.remove("open");
      document.body.style.overflow = "";
    }
    lbFigures.forEach(function (fig, i) {
      fig.addEventListener("click", function () { show(i); });
    });
    lb.querySelector(".lb-close").addEventListener("click", close);
    lb.querySelector(".lb-prev").addEventListener("click", function (e) { e.stopPropagation(); show(idx - 1); });
    lb.querySelector(".lb-next").addEventListener("click", function (e) { e.stopPropagation(); show(idx + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(idx - 1);
      if (e.key === "ArrowRight") show(idx + 1);
    });
  }

  /* Web3Forms handling (contact + newsletter) */
  var W3F_ENDPOINT = "https://api.web3forms.com/submit";
  document.querySelectorAll("form[data-w3f]").forEach(function (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var success = form.querySelector(".form-success");
      var error = form.querySelector(".form-error");
      if (success) success.classList.add("hidden");
      if (error) error.classList.add("hidden");
      var original = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
      try {
        var data = new FormData(form);
        var res = await fetch(W3F_ENDPOINT, {
          method: "POST",
          body: data,
          headers: { Accept: "application/json" },
        });
        var json = await res.json();
        if (json.success) {
          form.reset();
          if (success) success.classList.remove("hidden");
        } else {
          throw new Error(json.message || "Submission failed");
        }
      } catch (err) {
        console.error("[BBR form]", err);
        if (error) error.classList.remove("hidden");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    });
  });

  /* Footer year */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();
})();
