import type { SiteTheme } from '../content/site-schema';

const FONT_LIBRARY: Record<
  string,
  {
    stack: string;
    href?: string;
  }
> = {
  inter: {
    stack: '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  'playfair-display': {
    stack: '"Playfair Display", "Times New Roman", serif',
    href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
  },
  'space-grotesk': {
    stack: '"Space Grotesk", "Inter", system-ui, sans-serif',
    href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap',
  },
  poppins: {
    stack: '"Poppins", "Inter", system-ui, sans-serif',
    href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap',
  },
  lora: {
    stack: '"Lora", "Georgia", serif',
    href: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&display=swap',
  },
  raleway: {
    stack: '"Raleway", "Inter", system-ui, sans-serif',
    href: 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600&display=swap',
  },
};

const normalizeFontKey = (value?: string | null) => {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\s+/g, '-');
};

const resolveFont = (value?: string | null) => {
  const key = normalizeFontKey(value) || 'inter';
  return FONT_LIBRARY[key] ? { key, ...FONT_LIBRARY[key] } : { key: 'inter', ...FONT_LIBRARY.inter };
};

const ensureFontLink = (fontKey: string, href?: string) => {
  if (!href || typeof document === 'undefined') return;
  const existing = document.getElementById(`font-${fontKey}`);
  if (existing) return;
  const link = document.createElement('link');
  link.id = `font-${fontKey}`;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
};

export const applyThemeToDocument = (theme: SiteTheme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--brand', hexToHSL(theme.primaryColor));
  root.style.setProperty('--brand-accent', hexToHSL(theme.accentColor));
  root.style.setProperty('--surface-foreground', hexToHSL(resolveSurfaceTextColor(theme)));
  root.style.setProperty('--on-brand-foreground', hexToHSL(resolveOnBrandTextColor(theme)));
  const displayFont = resolveFont(theme.displayFont);
  const bodyFont = resolveFont(theme.bodyFont);
  root.style.setProperty('--font-display', displayFont.stack);
  root.style.setProperty('--font-body', bodyFont.stack);
  ensureFontLink(displayFont.key, displayFont.href);
  ensureFontLink(bodyFont.key, bodyFont.href);
  root.dataset.vibe = theme.vibe;
  root.dataset.surface = theme.backgroundStyle;
  root.dataset.corners = theme.cornerStyle || 'rounded';
  root.dataset.styleProfile = theme.styleProfile || 'rounded-elevated';
};

const DEFAULT_SURFACE_TEXT = '#0f172a';
const DEFAULT_ON_BRAND_TEXT = '#f8fafc';

const normalizeHex = (hex?: string | null) => {
  if (!hex) return null;
  const trimmed = hex.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

const hexToHSL = (hex: string) => {
  if (!hex) return '222 84% 60%';
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const { h, s, l } = rgbToHsl(r, g, b);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
};

const rgbToHsl = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
};

const hexToRgb = (hex?: string | null) => {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  const bigint = Number.parseInt(value, 16);
  if (Number.isNaN(bigint)) return null;
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
};

const getLuminance = (hex?: string | null) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const r = channel(rgb.r);
  const g = channel(rgb.g);
  const b = channel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const resolveSurfaceTextColor = (theme: SiteTheme) => normalizeHex(theme.textColor) || DEFAULT_SURFACE_TEXT;

const resolveOnBrandTextColor = (theme: SiteTheme) => {
  const luminance = getLuminance(theme.primaryColor);
  if (luminance == null) return DEFAULT_ON_BRAND_TEXT;
  return luminance > 0.6 ? DEFAULT_SURFACE_TEXT : DEFAULT_ON_BRAND_TEXT;
};
