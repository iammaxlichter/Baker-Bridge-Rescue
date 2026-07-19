# Baker Bridge Rescue - Rebuild Handoff (v2 design)

Full visual revamp on top of the working build. Same pages, same Supabase
wiring, new design system. The /admin dashboard is untouched.

## The design, briefly

- Palette: warm white paper (#FFFCF5), marigold gold (#F0B03F) as the single
  action color, lake blue (#4E7CA1) for links, warm charcoal ink (#322D26).
  No green, no terracotta, no dark footer, no gradients.
- Type: Young Serif for headings, Figtree for body and UI.
- Photos sit in white album frames with captions, a few gently tilted.
- The one flourish: a hand drawn gold underline that draws itself in, under
  "second chances" in the hero and under "whole" in The Eyes quote.
- Stitched dashes (buttons, wish panel, dividers, timeline) echo a bandana.
  The bridge divider, running dog, and paw print decorations are gone. The
  only paw left is the favicon.
- Reduced motion is respected everywhere.

## Run it

1. Copy `config.example.js` to `config.js` and fill in the Supabase values.
2. Serve the folder (`npx serve .` or push to Cloudflare Pages).
3. `_redirects` is unchanged, so `/admin` keeps working.

## TODO before/after launch

1. **Hero video.** `index.html` plays `assets/hero.mp4` first and falls back to
   a hotlinked Pexels placeholder (UHD, heavy). Drop John's footage in as
   `assets/hero.mp4`. Color footage is fine, black and white is done in CSS.
2. **Affiliate links.** Amazon is live with tag `pets0cbae-20`. Walmart,
   Target, Home Depot, Patreon, and Buy Me a Coffee are "coming soon" chips
   in `index.html`.
3. **Resources links.** Only orgs I could confirm are linked. The rest are
   name only in `resources.html`.
4. **Memorial photos.** Happy, Perry, and Sherri are text cards in
   `gallery.html`. Add an `<img>` when John sends photos.
5. **Archive images.** The archives grid hotlinks 10 photos from the old
   Strikingly CDN. Download them to `assets/photos/archive/` and swap the
   `src` attributes before the old site is cancelled.
6. **Pivot statement.** The "A new chapter" copy in `index.html` is a draft
   marked with a TODO comment for John.

All of the John facing questions above are collected in a separate Word
document (Baker-Bridge-Questions-for-John.docx) you can email him as is.

## Notes

- Store ordering matches admin: `active = true`, `sort_order` then
  `created_at`. Nullable price handled. Second image in `image_urls` shows
  on card hover.
- Newsletter and contact forms share the Web3Forms key with different
  subject lines.
