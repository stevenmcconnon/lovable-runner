import type { SiteTheme } from '../content/site-schema';

export const applyThemeToDocument = (theme: SiteTheme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--brand', hexToHSL(theme.primaryColor));
  root.style.setProperty('--brand-accent', hexToHSL(theme.accentColor));
  root.dataset.vibe = theme.vibe;
  root.dataset.surface = theme.backgroundStyle;
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
