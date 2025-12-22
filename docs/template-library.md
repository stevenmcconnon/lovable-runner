## UI Template Library (LLM-friendly)

This document summarizes the current section components, gaps to fill, and the new starter template manifests for LLM-driven site generation without heavy builds.

### API access
The backend now exposes read-only endpoints so orchestration agents can fetch the manifest dynamically:
- `GET /templates` – returns `templates/template-library.json`.
- `GET /templates/:templateId` – streams a specific `templates/library/<id>.json`.
- `GET /templates/presets` – returns `templates/template-copy-presets.json`.

All three endpoints require the shared `TEMPLATE_LIBRARY_TOKEN`, sent via the `x-templates-token` header (or `x-docs-token`). Keep the token secret—these endpoints expose internal template metadata only.

### Current section components
- Hero with image (CTA + stats), Features grid, **Product grid**, **Logo wall**, Testimonials cards, **Team grid**, FAQ accordion, Pricing table, CTA banner, Process timeline, Stats showcase, **Case studies**, Gallery carousel (supports `layout: "carousel" | "grid" | "masonry"`), Contact form.

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

### Content schema & styling (LLM guidance)
- **Portable Text everywhere:** Any section prop that carries long-form copy (hero text, features, testimonials, FAQs, CTAs, etc.) now accepts [Portable Text](https://portabletext.org/) blocks in addition to plain strings. Prefer emitting blocks so we can preserve italics, underline, strike, code, and links.

  ```jsonc
  [
    {
      "_type": "block",
      "style": "normal",
      "children": [
        { "_type": "span", "text": "Relaxed ", "marks": [] },
        { "_type": "span", "text": "underline", "marks": ["underline"] },
        { "_type": "span", "text": " + ", "marks": [] },
        { "_type": "span", "text": "bold", "marks": ["strong"] }
      ],
      "markDefs": [
        { "_key": "m1", "_type": "link", "href": "https://example.com" }
      ]
    }
  ]
  ```

  Supported marks: `strong`/`bold`, `em`/`italic`, `underline`, `strike`, `code`, and link markDefs (`_type: "link", href`). If a field doesn’t need formatting you can still send a plain string.

- **Fonts via theme:** Add `theme.displayFont` and `theme.bodyFont` using one of the curated keys – `inter`, `space-grotesk`, `poppins`, `playfair-display`, `lora`, `raleway`. The renderer loads the right Google Fonts and maps them to headings/body. Pick combos that match the vibe (e.g., Playfair + Lora for luxury, Space Grotesk + Inter for tech). Leave them empty to fall back to defaults.
- **Style profiles:** Pick a `theme.styleProfile` so the renderer can flip between visual treatments:
  - `rounded-elevated` – our current glassy, softly rounded cards (default).
  - `sharp-minimal` – squared edges, lighter shadows, and crisp dividers for tech/SaaS looks.
  - `full-bleed` – edge-to-edge sections with transparent panels so imagery carries the layout.
  Choose the profile that best fits the request; the build system will automatically sync the corner radius.
- **Contact forms:** Always include a `contactEmail` in every `contact-form` section. Submissions now POST to our backend and are relayed from an `@ai-sitemaker.com` sender, so forms without `contactEmail` cannot deliver anything.
- **Imagery/lightbox:** Section-level `image` props (hero cards, CTA, stats, product/portfolio items, gallery items, etc.) can now include optional `caption`, `credit`, and `creditUrl`. Every rendered image opens in a modal lightbox, so supplying descriptive alt text and credits improves the full-screen experience.

- **Schema reference:** Both the API (`src/site-schema.js`) and template app (`templates/site-base/src/content/site-schema.ts`) expect the same shape. Keep generated `content.json` aligned with those types.

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
