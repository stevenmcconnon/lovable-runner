## UI Template Library (LLM-friendly)

This document summarizes the current section components, gaps to fill, and the new starter template manifests for LLM-driven site generation without heavy builds.

### API access
The backend now exposes read-only endpoints so orchestration agents can fetch the manifest dynamically:
- `GET /templates` – returns `templates/template-library.json`.
- `GET /templates/:templateId` – streams a specific `templates/library/<id>.json`.
- `GET /templates/presets` – returns `templates/template-copy-presets.json`.
- `GET /templates/palettes` – returns `templates/template-palettes.json` (75 curated accessible color themes).

All three endpoints require the shared `TEMPLATE_LIBRARY_TOKEN`, sent via the `x-templates-token` header (or `x-docs-token`). Keep the token secret—these endpoints expose internal template metadata only.

### Current section components
- Global shell: **Site navigation** (sticky, announcement bar), **Footer links & contact**.
- Location & trust: **Hours/location**, **Trust badges**, Logo wall, Testimonial cards, Stats showcase, Case studies.
- Services & proof: Hero with image, Features grid, Product grid, Menu grid, Process timeline, Team grid, FAQ accordion.
- Commerce & booking: Pricing table, Booking widget, **Reservation widget**, Contact form, **Lead magnet**, **Sticky CTA bar**.
- Media: Gallery carousel (`layout: "carousel" | "grid" | "masonry"`), **Video spotlight**, **Inventory/listing grid**, Review collector.

### High-value gaps to add next
- Deeper commerce: quote estimator for services, interactive rate tables/payment calculators, lightweight cart/checkout embeds.
- Content marketing: blog/updates list, newsletter archive, podcast episode list, mashup sections combining testimonials + logos.
- Automation: embedded calendar availability picker powered by `/appointments`, micro-surveys/polls, advanced lead-routing logic.

### Template manifests (JSON)
- `templates/template-library.json` – index of available templates with ids, verticals, tags, tone/vibe, and paths to the individual files.
- `templates/library/<template-id>.json` – one file per template (38 total) with sections and `needsComponents` flags.
- `templates/template-copy-presets.json` – 10 drop-in `site.json` payloads (plumber, electrician, HVAC, law, dental, trainer, wedding photographer, SaaS, ecommerce, restaurant) matching `templates/site-base/src/content/site-schema.ts`.
- `templates/template-palettes.json` – 75 palette objects with `primary`, `secondary`, `accent`, text colors, suggested fonts, industries, and `styleProfile` hints for consistent theming.
- Usage: pick `templateId`, load matching copy preset (or generate new copy using the section order in the manifest), adjust props, and write to `src/content/site.json` (or runtime JSON fetch once we decouple from bundling).

### Color palette presets
- Each palette record includes high-contrast `primary`/`text` pairings plus `onPrimary`/`onAccent` tokens so CTAs meet WCAG 2.1 AA contrast without guesswork.
- `styleProfile`, `fonts`, and `vibes` allow the generator to align design language (e.g., `sharp-minimal` + Space Grotesk for SaaS; `rounded-elevated` + Playfair/Lora for luxury).
- `industries` hints help recommend palettes per template; you can also randomize within a vertical to avoid identical electrician sites.
- Use `template-palettes.json` + template metadata to produce thousands of unique combinations (templates × palettes × copy) while staying on-brand.

### Component-specific guidance
- `site-navigation`: include `logo.text`, a short `logo.tagline`, and at least four anchor `links` (each with `label` plus `href` or `sectionId`). `announcement` is optional Markdown/Portable Text rendered above the bar.
- `hours-location`: expects `address` Portable Text and an array of `hours` rows (`label` + `value`). Provide either `mapEmbedUrl` (Google/Mapbox embed) or `mapImage` (image asset + prompt for generation).
- `trust-badges`: send minimum three `badges`, each with `label`, short `description`, and optional `icon` values of `shield`, `check`, or `star`. Use `guarantees` for double-column promises.
- `menu-grid`: supply 2–4 `categories` with `items`. Items accept `tags` like `{ "label": "Spicy", "variant": "spicy" }` to automatically color-code chips.
- `reservation-widget` vs `booking-widget`: use reservation for hospitality (party size + seating); booking for services (project description). Both hit `/contact` with intent metadata.
- `inventory-list`: each `items[]` entry accepts `metrics` (e.g., `{ "label": "Mileage", "value": "12,340" }`) and `media.src`. Ideal for real-estate/auto directories.
- `video-spotlight`: provide `videos[]` with `url` (YouTube/Vimeo/loom) or pre-built `embedUrl`, optional `thumbnail`, and `duration`. First video autoplays; the list builds a playlist.
- `lead-magnet`: short form, so send `bullets` (Portable Text snippets) and `resourceName` to show the download title. Response is ingested through the contact endpoint with `intent: lead-magnet`.
- `sticky-cta-bar`: keep copy short. Provide `primaryCta` (with `label` and optional `sectionId` anchor) and optional `secondaryCta` or `phone`. The bar fades in after ~360px scroll.
- `footer-links`: provide at least two `columns[]`, plus optional `social` links, `legal` links (privacy/terms), and a `newsletter` block (title/description/placeholder/ctaLabel/confirmation).

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
