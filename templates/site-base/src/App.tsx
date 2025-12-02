import site from './content/site.json';
import type { SiteContent } from './content/site-schema';
import { SectionRenderer } from './components/sections';
import { applyThemeToDocument } from './lib/theme';
import { useEffect } from 'react';

const siteContent = site as SiteContent;

const Background = () => (
  <div className="pointer-events-none fixed inset-0 -z-10">
    <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
    <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.4), transparent 45%)' }} />
    <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 80% 0%, rgba(249,115,22,0.35), transparent 45%)' }} />
  </div>
);

const App = () => {
  useEffect(() => {
    applyThemeToDocument(siteContent.theme);
  }, []);

  return (
    <div className="relative min-h-screen">
      <Background />
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.5em] text-white/40">{siteContent.meta.brandName}</p>
            <p className="text-lg font-semibold text-white">{siteContent.meta.headline}</p>
          </div>
          <div className="hidden gap-4 text-sm text-white/60 md:flex">
            {siteContent.meta.phone ? <span>{siteContent.meta.phone}</span> : null}
            {siteContent.meta.email ? <span>{siteContent.meta.email}</span> : null}
          </div>
        </div>
      </header>
      <main>
        <SectionRenderer sections={siteContent.sections} />
      </main>
      <footer className="border-t border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-white/60 md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} {siteContent.meta.brandName}</span>
          <span>{siteContent.meta.subheadline}</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
