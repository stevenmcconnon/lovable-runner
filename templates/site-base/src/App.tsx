import site from './content/site.json';
import type { SiteContent } from './content/site-schema';
import { SectionRenderer } from './components/sections';
import { applyThemeToDocument } from './lib/theme';
import { useEffect } from 'react';

const siteContent = site as SiteContent;

const Background = () => (
  <div className="pointer-events-none fixed inset-0 -z-10">
    <div
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(circle at 15% 20%, hsl(var(--brand) / 0.22), transparent 35%), radial-gradient(circle at 80% 10%, hsl(var(--brand-accent) / 0.18), transparent 30%), radial-gradient(circle at 50% 70%, rgba(255,255,255,0.8), transparent 45%)',
      }}
    />
    <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-slate-50" />
  </div>
);

const App = () => {
  useEffect(() => {
    applyThemeToDocument(siteContent.theme);
  }, []);

  return (
    <div className="relative min-h-screen">
      <Background />
      <header className="sticky top-0 z-10 border-b border-white/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 text-slate-900">
          <div>
            <p className="text-xs uppercase tracking-[0.5em] text-slate-500">{siteContent.meta.brandName}</p>
            <p className="text-lg font-semibold text-slate-900">{siteContent.meta.headline}</p>
          </div>
          <div className="hidden gap-4 text-sm text-slate-700 md:flex">
            {siteContent.meta.phone ? <span>{siteContent.meta.phone}</span> : null}
            {siteContent.meta.email ? <span>{siteContent.meta.email}</span> : null}
          </div>
        </div>
      </header>
      <main>
        {Array.isArray(siteContent.pages) && siteContent.pages.length ? (
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-10">
            <div className="flex flex-wrap gap-3 text-sm font-semibold text-slate-700">
              {siteContent.pages.map((page) => (
                <a key={page.path} className="rounded-full bg-white/80 px-4 py-2 shadow" href={`#${page.path.replace(/^\//, '')}`}>
                  {page.title || page.path}
                </a>
              ))}
            </div>
            {siteContent.pages.map((page) => (
              <section key={page.path} id={page.path.replace(/^\//, '')} className="scroll-mt-20">
                <div className="mb-6">
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{page.path}</p>
                  <h2 className="text-3xl font-semibold text-slate-900 md:text-4xl">{page.title}</h2>
                </div>
                <SectionRenderer sections={page.sections} />
              </section>
            ))}
          </div>
        ) : (
          <SectionRenderer sections={siteContent.sections || []} />
        )}
      </main>
      <footer className="border-t border-white/70 bg-white/80 text-slate-700">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} {siteContent.meta.brandName}</span>
          <span>{siteContent.meta.subheadline}</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
