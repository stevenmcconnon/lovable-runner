import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          accent: 'hsl(var(--brand-accent))',
        },
      },
      backgroundImage: {
        'noise-light': "linear-gradient(180deg, rgba(9,9,12,0.9), rgba(9,9,12,0.98)), url('https://www.transparenttextures.com/patterns/asfalt-dark.png')",
      },
      fontFamily: {
        display: ['var(--font-display)', 'Inter', 'sans-serif'],
        sans: ['var(--font-body)', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
