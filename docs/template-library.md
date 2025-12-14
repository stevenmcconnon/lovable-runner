## UI Template Library (LLM-friendly)

This document summarizes the current section components, gaps to fill, and the new starter template manifests for LLM-driven site generation without heavy builds.

### Current section components
- Hero with image (CTA + stats), Features grid, Testimonials cards, FAQ accordion, Pricing table, CTA banner, Process timeline, Stats showcase, Gallery carousel, Contact form.

### High-value gaps to add next
- Global shell: sticky nav + anchor links, footer with links/social/legal.
- Location & trust: hours/map block, logo strip, trust badges/compliance labels.
- People: team/practitioner bios, attorney/stylist cards, instructor grid.
- Commerce/booking: booking widget (time slots), reservation widget, rate table/payment calculator, product/detail card, cart/checkout link, menu grid for food/service menus, inventory/listing cards with filters.
- Content: case-study cards, blog/updates list, video embed grid, logo + testimonial mashup.
- Lead capture: sticky “call/book now” bar, short lead magnet form, quote estimator for services and events.

### Template manifests (JSON)
- `templates/template-library.json` – index of available templates with ids, verticals, tags, tone/vibe, and paths to the individual files.
- `templates/library/<template-id>.json` – one file per template (30 total) with sections and `needsComponents` flags.
- `templates/template-copy-presets.json` – 10 drop-in `site.json` payloads (plumber, electrician, HVAC, law, dental, trainer, wedding photographer, SaaS, ecommerce, restaurant) matching `templates/site-base/src/content/site-schema.ts`.
- Usage: pick `templateId`, load matching copy preset (or generate new copy using the section order in the manifest), adjust props, and write to `src/content/site.json` (or runtime JSON fetch once we decouple from bundling).

### Quick template lookup examples
- Local services (plumbing): `home-services-plumber` — emergency-first hero, stats, features, process, proof, FAQ, contact.
- SaaS: `saas-product` — product hero, features, stats, pricing, testimonials, FAQ, CTA, contact.
- Hospitality: `restaurant` / `coffee-shop` / `catering-food-truck` — hero, gallery, menu via features grid, stats (hours/awards), process for reservations/events, testimonials, FAQ, contact; needs `menu-grid` + `reservation-widget`.

### Proposed fast creation/deploy flow (sub-5s target)
- Prebuild once: ship a versioned `site-base` static bundle to S3 (e.g., `site-base/<hash>/dist/**`) and reuse it. Lambda keeps a cached copy in `/tmp`; only refresh on version change.
- Runtime JSON, no per-site npm: change the template app to load `/content.json` at runtime instead of bundling it, so creating a site is just writing JSON.
- S3 layout per site: `s3://bucket/prefix/<slug>/content.json` (full site content) and `s3://bucket/prefix/<slug>/template.json` (structure + template metadata). No per-site dist uploads.
- Lambda / API changes:
  - `/launch`: generate `content.json` and `template.json` (using template library + LLM) and upload just those files; skip `npm install` and `npm run build`.
  - `/update`: regenerate and overwrite JSON only (plus optional generated assets).
  - Add a lightweight `/templates` endpoint (served from the manifest + folder) so the LLM can fetch available templates + tags quickly.
- Client rendering: change `templates/site-base` to fetch `/content.json` on load (with a placeholder skeleton) and hydrate sections; keep section registry ids in sync with the manifest.
- Caching: keep the prebuilt dist zip in S3 + local `/tmp`, keyed by bundle hash; invalidate only on template code changes. This keeps cold starts fast and avoids repeated installs/builds.
