# Baker Bridge Rescue — Rebuild Handoff

Full redesign: hero video landing, live Supabase-powered store, About, Gallery,
Resources, and Contact. The `/admin` dashboard is untouched and the store reads
from the same `products` table it manages.

## Run it

1. Copy `config.example.js` to `config.js` and fill in the Supabase values
   (you already have this locally; it stays gitignored).
2. Serve the folder (`npx serve .` or push to Cloudflare Pages).
3. `_redirects` is unchanged, so `/admin` keeps working.

## File map

- `index.html` — hero video, bridge divider animation, featured store (first 4
  products), pivot statement, mission pillars, Doc's video, testimonials,
  The Eyes, support grid, affiliates, partners, newsletter
- `shop.html` — full store grid
- `about.html` — the letter, timeline, realities of rescue, stance, gratitude
- `gallery.html` — photo masonry with lightbox, memorial, old-site archives
- `resources.html` — grant and assistance programs in accordions
- `contact.html` — Web3Forms contact form
- `css/site.css`, `js/site.js`, `js/products.js` — shared design system and logic
- `assets/photos/` — all 30 processed photos (deduped, cropped, compressed, ~2.7MB)
- `assets/brand/logo.jpg` — the BBR logo, white-trimmed

## TODO before/after launch

1. **Hero video.** `index.html` plays `assets/hero.mp4` first and falls back to
   a Pexels placeholder (dogs running in slow motion, hotlinked, UHD so it is
   heavy). When John's footage is ready, drop it in as `assets/hero.mp4` and
   optionally delete the Pexels `<source>` line. Any color footage works, the
   black and white is done in CSS.
2. **Affiliate links.** Amazon is live with their tag (`pets0cbae-20`). Walmart,
   Target, Home Depot, Patreon, and Buy Me a Coffee are "coming soon" chips in
   `index.html`. Swap each chip for an `<a class="chip">` when accounts exist.
3. **Resources links.** Only orgs with domains I am confident about are linked
   (RedRover, Petco Love, ASPCA, Best Friends, Maddie's Fund, PetSmart
   Charities, Bissell). Verify and add URLs for the rest in `resources.html`.
4. **Memorial photos.** Happy, Perry, and Sherri have text cards in
   `gallery.html`. If John sends photos, add an `<img>` above each card title.
   I intentionally did not guess which uploaded dog photos are them.
5. **Archive images.** The "From the archives" grid hotlinks 10 photos from the
   old Strikingly CDN. Download them before the old site is cancelled, save to
   `assets/photos/archive/`, and swap the `src` attributes. URLs are in
   `gallery.html`.
6. **Pivot statement.** The "A new chapter" copy in `index.html` is a draft for
   John to edit (marked with a TODO comment).
7. **Testimonial videos** (Bella, Coco, Lulu Rose, Logan, Happy, Doc) are the
   YouTube links from the old site. Confirm John keeps those videos up.

## Notes

- Supabase RLS already limits anonymous reads to `active = true` products, and
  the store orders by `sort_order` then `created_at`, matching the admin's
  "Save layout" feature.
- Newsletter and contact forms both use the Web3Forms key ending in `...fbee`
  with different subject lines so John can tell them apart.
- Fonts: Fraunces (display serif) + Karla (body). The /admin dashboard still
  uses its own Nunito-based stylesheet.
- 2026-07 restyle: editorial look — hairline borders instead of shadow cards,
  ruled list items instead of icon-badge cards, squared 6px buttons. Pawprints
  reduced to two uses: the favicon and the product-image placeholder in
  js/products.js. The bridge divider kept its running dog but lost its paws.
  The AI illustration (adopt-art.jpg) was deleted; the newsletter now uses
  assets/photos/beagle-bandana.jpg (a real photo).
- Reduced motion is respected: the running dog, reveals, and counters all
  degrade to static.
