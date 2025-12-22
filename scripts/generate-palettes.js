#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const families = [
  {
    prefix: 'tech',
    label: 'Tech Pulse',
    primary: '#0f172a',
    secondary: '#1e293b',
    background: '#f5f7ff',
    surface: '#ffffff',
    text: '#0f172a',
    muted: '#334155',
    onPrimary: '#f8fafc',
    onAccent: '#04111f',
    styleProfile: 'sharp-minimal',
    fonts: ['space-grotesk', 'inter'],
    vibes: ['tech', 'saas', 'modern'],
    industries: ['software', 'agency', 'services'],
    accents: [
      { name: 'electric-azure', color: '#38bdf8' },
      { name: 'violet-drive', color: '#a855f7' },
      { name: 'cyber-mint', color: '#2dd4bf' },
      { name: 'signal-orange', color: '#fb923c' },
      { name: 'neon-lime', color: '#a3e635' }
    ]
  },
  {
    prefix: 'luxury',
    label: 'Luxury Atelier',
    primary: '#111827',
    secondary: '#1f2937',
    background: '#fdf8f5',
    surface: '#ffffff',
    text: '#1b1b1b',
    muted: '#4b5563',
    onPrimary: '#fdf6ec',
    onAccent: '#120b05',
    styleProfile: 'rounded-elevated',
    fonts: ['playfair-display', 'lora'],
    vibes: ['luxury', 'boutique'],
    industries: ['beauty', 'medical', 'hospitality'],
    accents: [
      { name: 'antique-gold', color: '#d4af37' },
      { name: 'velvet-mauve', color: '#b981f8' },
      { name: 'ruby-aperture', color: '#c2410c' },
      { name: 'emerald-veil', color: '#0f766e' }
    ]
  },
  {
    prefix: 'earthy',
    label: 'Earthy Heritage',
    primary: '#1f2937',
    secondary: '#142031',
    background: '#f4f1ea',
    surface: '#ffffff',
    text: '#17212f',
    muted: '#475569',
    onPrimary: '#fdfaf5',
    onAccent: '#0b1106',
    styleProfile: 'rounded-elevated',
    fonts: ['lora', 'inter'],
    vibes: ['earthy', 'organic'],
    industries: ['home-services', 'landscaping', 'construction'],
    accents: [
      { name: 'moss', color: '#4d7c0f' },
      { name: 'copper', color: '#b45309' },
      { name: 'sage', color: '#a3b18a' },
      { name: 'pine', color: '#065f46' }
    ]
  },
  {
    prefix: 'playful',
    label: 'Playful Bloom',
    primary: '#1d1b84',
    secondary: '#312e81',
    background: '#fff7ed',
    surface: '#ffffff',
    text: '#0f172a',
    muted: '#4c1d95',
    onPrimary: '#fdf7ff',
    onAccent: '#12040f',
    styleProfile: 'rounded-elevated',
    fonts: ['poppins', 'inter'],
    vibes: ['playful', 'vibrant'],
    industries: ['creative', 'events', 'hospitality'],
    accents: [
      { name: 'citrus', color: '#fb923c' },
      { name: 'bubblegum', color: '#f472b6' },
      { name: 'aqua', color: '#2dd4bf' },
      { name: 'lilac', color: '#c084fc' }
    ]
  },
  {
    prefix: 'industrial',
    label: 'Industrial Grid',
    primary: '#111827',
    secondary: '#1f2937',
    background: '#f5f5f4',
    surface: '#ffffff',
    text: '#111827',
    muted: '#44403c',
    onPrimary: '#f8fafc',
    onAccent: '#070d13',
    styleProfile: 'sharp-minimal',
    fonts: ['inter', 'space-grotesk'],
    vibes: ['industrial', 'b2b'],
    industries: ['construction', 'logistics', 'manufacturing'],
    accents: [
      { name: 'amber-signal', color: '#f59e0b' },
      { name: 'safety-green', color: '#a3e635' },
      { name: 'steel-blue', color: '#3b82f6' },
      { name: 'torch-red', color: '#f87171' }
    ]
  },
  {
    prefix: 'wellness',
    label: 'Wellness Light',
    primary: '#134e4a',
    secondary: '#115e59',
    background: '#f7fdfa',
    surface: '#ffffff',
    text: '#0f172a',
    muted: '#1c4c43',
    onPrimary: '#e2f5f0',
    onAccent: '#011310',
    styleProfile: 'rounded-elevated',
    fonts: ['lora', 'inter'],
    vibes: ['wellness', 'calm'],
    industries: ['healthcare', 'fitness', 'wellness'],
    accents: [
      { name: 'teal-mist', color: '#2dd4bf' },
      { name: 'sage-haze', color: '#a7f3d0' },
      { name: 'lavender-breeze', color: '#c4b5fd' },
      { name: 'coral-tranquil', color: '#fb7185' },
      { name: 'sunrise', color: '#fcd34d' }
    ]
  },
  {
    prefix: 'legal',
    label: 'Legal Authority',
    primary: '#101828',
    secondary: '#1c2742',
    background: '#f6f6fb',
    surface: '#ffffff',
    text: '#0c1423',
    muted: '#4c5673',
    onPrimary: '#f7f7fe',
    onAccent: '#0b1221',
    styleProfile: 'sharp-minimal',
    fonts: ['playfair-display', 'inter'],
    vibes: ['professional', 'rigorous'],
    industries: ['legal', 'consulting'],
    accents: [
      { name: 'royal-gold', color: '#d6b25e' },
      { name: 'oxblood', color: '#8b1c13' },
      { name: 'navy-sky', color: '#1d4ed8' },
      { name: 'forest-bronze', color: '#365314' }
    ]
  },
  {
    prefix: 'finance',
    label: 'Finance Clarity',
    primary: '#082f49',
    secondary: '#0f4c75',
    background: '#f2fbff',
    surface: '#ffffff',
    text: '#04202e',
    muted: '#164863',
    onPrimary: '#e9f6ff',
    onAccent: '#02121c',
    styleProfile: 'sharp-minimal',
    fonts: ['inter', 'space-grotesk'],
    vibes: ['finance', 'trust'],
    industries: ['finance', 'insurance'],
    accents: [
      { name: 'aqua-mint', color: '#2dd4bf' },
      { name: 'cobalt-line', color: '#2563eb' },
      { name: 'amber-ledger', color: '#fbbf24' },
      { name: 'emerald-portfolio', color: '#16a34a' }
    ]
  },
  {
    prefix: 'automotive',
    label: 'Automotive Apex',
    primary: '#0b0f19',
    secondary: '#1c1f2a',
    background: '#f5f5f5',
    surface: '#ffffff',
    text: '#111111',
    muted: '#4b4b4b',
    onPrimary: '#f2f2f2',
    onAccent: '#050505',
    styleProfile: 'sharp-minimal',
    fonts: ['space-grotesk', 'inter'],
    vibes: ['automotive', 'bold'],
    industries: ['automotive', 'transport'],
    accents: [
      { name: 'signal-red', color: '#ef4444' },
      { name: 'speed-orange', color: '#fb923c' },
      { name: 'turbo-cyan', color: '#06b6d4' },
      { name: 'lime-track', color: '#84cc16' },
      { name: 'steel-blue', color: '#3b82f6' }
    ]
  },
  {
    prefix: 'hospitality',
    label: 'Hospitality Glow',
    primary: '#291334',
    secondary: '#3b1d4f',
    background: '#fffaf2',
    surface: '#ffffff',
    text: '#241126',
    muted: '#5b325f',
    onPrimary: '#fef6fb',
    onAccent: '#150711',
    styleProfile: 'rounded-elevated',
    fonts: ['playfair-display', 'inter'],
    vibes: ['warm', 'hospitality'],
    industries: ['hospitality', 'events'],
    accents: [
      { name: 'rose-gold', color: '#f472b6' },
      { name: 'peach-burst', color: '#fb7185' },
      { name: 'copper-spark', color: '#f59e0b' },
      { name: 'champagne', color: '#fcd34d' }
    ]
  },
  {
    prefix: 'creative',
    label: 'Creative Neon',
    primary: '#050315',
    secondary: '#120a3a',
    background: '#fdf7ff',
    surface: '#ffffff',
    text: '#0f0b2d',
    muted: '#4b30a4',
    onPrimary: '#f4f0ff',
    onAccent: '#050108',
    styleProfile: 'full-bleed',
    fonts: ['space-grotesk', 'poppins'],
    vibes: ['creative', 'bold'],
    industries: ['creative', 'content', 'startups'],
    accents: [
      { name: 'magenta-flare', color: '#ec4899' },
      { name: 'electric-purple', color: '#a855f7' },
      { name: 'laser-blue', color: '#38bdf8' },
      { name: 'acid-green', color: '#bef264' }
    ]
  },
  {
    prefix: 'healthcare',
    label: 'Healthcare Fresh',
    primary: '#0c3c78',
    secondary: '#0b4a8f',
    background: '#f3fbff',
    surface: '#ffffff',
    text: '#0f172a',
    muted: '#1c4c82',
    onPrimary: '#e3f0ff',
    onAccent: '#03142b',
    styleProfile: 'rounded-elevated',
    fonts: ['inter', 'lora'],
    vibes: ['clinical', 'trust'],
    industries: ['healthcare', 'dental'],
    accents: [
      { name: 'aqua-care', color: '#0ea5e9' },
      { name: 'mint-care', color: '#34d399' },
      { name: 'lavender-care', color: '#c4b5fd' },
      { name: 'peach-care', color: '#fda4af' },
      { name: 'golden-hour', color: '#fbbf24' }
    ]
  },
  {
    prefix: 'beauty',
    label: 'Beauty Muse',
    primary: '#2e0f2f',
    secondary: '#451244',
    background: '#fdf6f9',
    surface: '#ffffff',
    text: '#2c102b',
    muted: '#7a2e5e',
    onPrimary: '#fdebf3',
    onAccent: '#19030f',
    styleProfile: 'rounded-elevated',
    fonts: ['playfair-display', 'poppins'],
    vibes: ['beauty', 'luxury'],
    industries: ['beauty', 'fashion'],
    accents: [
      { name: 'rose', color: '#f472b6' },
      { name: 'mulberry', color: '#a21caf' },
      { name: 'champagne-blush', color: '#fbb6ce' },
      { name: 'sunset-glow', color: '#f97316' }
    ]
  },
  {
    prefix: 'ecommerce',
    label: 'Commerce Pop',
    primary: '#0f172a',
    secondary: '#1e293b',
    background: '#fdfcfe',
    surface: '#ffffff',
    text: '#111827',
    muted: '#475569',
    onPrimary: '#fdfbff',
    onAccent: '#06050c',
    styleProfile: 'sharp-minimal',
    fonts: ['poppins', 'inter'],
    vibes: ['retail', 'dynamic'],
    industries: ['ecommerce', 'retail'],
    accents: [
      { name: 'sunset-pop', color: '#fb923c' },
      { name: 'neon-mint', color: '#34d399' },
      { name: 'berry', color: '#db2777' },
      { name: 'royal-blue', color: '#3b82f6' }
    ]
  },
  {
    prefix: 'nonprofit',
    label: 'Mission Care',
    primary: '#0f2a3d',
    secondary: '#123852',
    background: '#f0f8ff',
    surface: '#ffffff',
    text: '#122437',
    muted: '#1f3d54',
    onPrimary: '#e2f1ff',
    onAccent: '#03101a',
    styleProfile: 'rounded-elevated',
    fonts: ['lora', 'inter'],
    vibes: ['mission', 'community'],
    industries: ['nonprofit', 'education'],
    accents: [
      { name: 'turquoise-hope', color: '#14b8a6' },
      { name: 'caring-coral', color: '#fb7185' },
      { name: 'sunrise-amber', color: '#fbbf24' },
      { name: 'orchid-hope', color: '#c084fc' },
      { name: 'leaf', color: '#4ade80' }
    ]
  },
  {
    prefix: 'education',
    label: 'Campus Modern',
    primary: '#11212f',
    secondary: '#1c2f3f',
    background: '#f8fbff',
    surface: '#ffffff',
    text: '#102132',
    muted: '#2b4258',
    onPrimary: '#eef5ff',
    onAccent: '#03070a',
    styleProfile: 'sharp-minimal',
    fonts: ['space-grotesk', 'inter'],
    vibes: ['education', 'structured'],
    industries: ['education', 'bootcamp'],
    accents: [
      { name: 'royal-campus', color: '#2563eb' },
      { name: 'sunflower', color: '#fbbf24' },
      { name: 'forest-campus', color: '#16a34a' },
      { name: 'cranberry', color: '#dc2626' },
      { name: 'teal-campus', color: '#0ea5e9' }
    ]
  },
  {
    prefix: 'logistics',
    label: 'Logistics Velocity',
    primary: '#041221',
    secondary: '#0f1f2f',
    background: '#f5f9fc',
    surface: '#ffffff',
    text: '#0d1b2a',
    muted: '#1e293b',
    onPrimary: '#eff6ff',
    onAccent: '#01070c',
    styleProfile: 'sharp-minimal',
    fonts: ['inter', 'space-grotesk'],
    vibes: ['logistics', 'industrial'],
    industries: ['logistics', 'b2b', 'professional-services'],
    accents: [
      { name: 'orange-route', color: '#f97316' },
      { name: 'lime-signal', color: '#bef264' },
      { name: 'blue-route', color: '#0ea5e9' },
      { name: 'amber-route', color: '#facc15' },
      { name: 'teal-route', color: '#14b8a6' }
    ]
  }
];

const palettes = [];
families.forEach((family) => {
  family.accents.forEach((accent) => {
    palettes.push({
      id: `${family.prefix}-${accent.name}`,
      label: `${family.label} ${accent.name.replace(/-/g, ' ')}`.replace(/\b(\w)/g, (match) => match.toUpperCase()),
      primary: family.primary,
      secondary: family.secondary,
      background: family.background,
      surface: family.surface,
      text: family.text,
      muted: family.muted,
      accent: accent.color,
      onPrimary: family.onPrimary,
      onAccent: family.onAccent,
      styleProfile: accent.styleProfile || family.styleProfile,
      fonts: accent.fonts || family.fonts,
      vibes: accent.vibes || family.vibes,
      industries: accent.industries || family.industries,
    });
  });
});

if (palettes.length !== 75) {
  throw new Error(`Expected 75 palettes, got ${palettes.length}`);
}

const payload = {
  version: '2024-11-xx',
  count: palettes.length,
  palettes,
};

const outputPath = path.join(__dirname, '..', 'templates', 'template-palettes.json');
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${palettes.length} palettes to ${outputPath}`);
