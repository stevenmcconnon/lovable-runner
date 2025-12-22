#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const templatesDir = path.join(__dirname, '..', 'templates', 'library');

const files = fs
  .readdirSync(templatesDir)
  .filter((file) => file.endsWith('.json'))
  .sort();

const siteNavPurpose = (name) => `Sticky navigation with primary CTAs and contact info for ${name}`;
const trustPurpose = (name) => `${name} certifications, guarantees, and associations`;
const leadPurpose = (name) => `Downloadable guide, checklist, or resource from ${name}`;
const hoursPurpose = (name) => `${name} service map and operating hours`;
const stickyPurpose = (name) => `Always-on call-to-action bar to contact ${name}`;
const footerPurpose = (name) => `${name} footer with contact columns, social, and legal links`;
const menuPurpose = () => 'Menu categories showcasing signature dishes and pricing';
const reservationPurpose = () => 'Reservation form capturing party size, date, and requests';
const inventoryPurpose = (name) => `Featured listings, vehicles, or specials from ${name}`;
const videoPurpose = (name) => `Video walkthroughs and spotlights from ${name}`;

const ensureSection = (sections, componentId, purpose, { position = 'end', before, after } = {}) => {
  if (sections.some((section) => section.componentId === componentId)) {
    return false;
  }
  const entry = { componentId, purpose };
  if (after) {
    const idx = sections.findIndex((section) => section.componentId === after);
    if (idx >= 0) {
      sections.splice(idx + 1, 0, entry);
    } else {
      sections.push(entry);
    }
    return true;
  }
  if (before) {
    const idx = sections.findIndex((section) => section.componentId === before);
    if (idx >= 0) {
      sections.splice(idx, 0, entry);
    } else {
      sections.push(entry);
    }
    return true;
  }
  if (position === 'start') {
    sections.unshift(entry);
    return true;
  }
  sections.push(entry);
  return true;
};

let updatedCount = 0;

files.forEach((file) => {
  const fullPath = path.join(templatesDir, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const template = JSON.parse(raw);
  const name = template.name || template.id;
  const sections = Array.isArray(template.sections) ? [...template.sections] : [];
  let modified = false;

  const vertical = (template.vertical || '').toLowerCase();
  const tags = (template.tags || []).map((tag) => tag.toLowerCase());
  const hasTag = (value) => tags.includes(value);

  if (!sections.length) {
    return;
  }

  if (ensureSection(sections, 'site-navigation', siteNavPurpose(name), { position: 'start' })) {
    modified = true;
  }
  if (ensureSection(sections, 'trust-badges', trustPurpose(name), { after: 'stats-showcase' })) {
    modified = true;
  }

  const needsHours =
    ['home-services', 'services', 'automotive', 'real-estate', 'healthcare', 'fitness', 'beauty', 'hospitality', 'creative'].includes(vertical) ||
    hasTag('local');
  if (needsHours) {
    if (
      ensureSection(
        sections,
        'hours-location',
        hoursPurpose(name),
        { before: 'faq-accordion' }
      )
    ) {
      modified = true;
    }
  }

  const needsMenu = vertical === 'hospitality' || hasTag('menu');
  if (needsMenu) {
    if (ensureSection(sections, 'menu-grid', menuPurpose(), { after: 'features-grid' })) {
      modified = true;
    }
  }

  const needsReservation = vertical === 'hospitality' || hasTag('reservations');
  if (needsReservation) {
    if (
      ensureSection(sections, 'reservation-widget', reservationPurpose(), {
        before: 'contact-form',
      })
    ) {
      modified = true;
    }
  }

  const needsInventory = ['automotive', 'real-estate', 'ecommerce'].includes(vertical) || hasTag('inventory');
  if (needsInventory) {
    if (
      ensureSection(sections, 'inventory-list', inventoryPurpose(name), {
        after: 'features-grid',
      })
    ) {
      modified = true;
    }
  }

  const needsVideo = ['creative', 'agency', 'software'].includes(vertical) || hasTag('video');
  if (needsVideo) {
    if (
      ensureSection(sections, 'video-spotlight', videoPurpose(name), {
        before: 'testimonials-cards',
      })
    ) {
      modified = true;
    }
  }

  if (
    ensureSection(
      sections,
      'lead-magnet',
      leadPurpose(name),
      { before: 'contact-form' }
    )
  ) {
    modified = true;
  }

  if (
    ensureSection(
      sections,
      'sticky-cta-bar',
      stickyPurpose(name),
      { before: 'footer-links' }
    )
  ) {
    modified = true;
  }

  if (ensureSection(sections, 'footer-links', footerPurpose(name))) {
    modified = true;
  }

  if (template.needsComponents) {
    delete template.needsComponents;
    modified = true;
  }

  if (modified) {
    template.sections = sections;
    fs.writeFileSync(fullPath, JSON.stringify(template, null, 2) + '\n');
    updatedCount += 1;
  }
});

console.log(`Updated ${updatedCount} template files.`);
