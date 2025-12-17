import type { SiteContent } from './content/site-schema';
import { SectionRenderer } from './components/sections';
import { ImageModalProvider } from './components/ui/image-modal';
import { ToastProvider } from './components/ui/toast';
import { applyThemeToDocument } from './lib/theme';
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    __AI_SITEMAKER_SLUG?: string;
    __AI_SITEMAKER_API_BASE?: string;
  }
}

const backgroundLayers: Record<
  'gradient' | 'mesh' | 'texture',
  { glow: string; base: string }
> = {
  gradient: {
    glow:
      'radial-gradient(circle at 18% 20%, hsl(var(--brand) / 0.28), transparent 45%), radial-gradient(circle at 80% 8%, hsl(var(--brand-accent) / 0.22), transparent 35%), radial-gradient(circle at 45% 70%, rgba(255,255,255,0.75), transparent 45%)',
    base: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%)',
  },
  mesh: {
    glow:
      'radial-gradient(circle at 25% 25%, hsl(var(--brand) / 0.2), transparent 40%), radial-gradient(circle at 70% 20%, hsl(var(--brand-accent) / 0.18), transparent 45%), radial-gradient(circle at 50% 75%, rgba(255,255,255,0.7), transparent 40%)',
    base:
      'linear-gradient(120deg, hsl(var(--brand) / 0.08), hsl(var(--brand-accent) / 0.08))',
  },
  texture: {
    glow:
      'radial-gradient(circle at 20% 30%, hsl(var(--brand) / 0.18), transparent 40%), radial-gradient(circle at 80% 25%, hsl(var(--brand-accent) / 0.18), transparent 45%)',
    base:
      'linear-gradient(180deg, #fdf7f2 0%, #fff8f4 50%, #f2f7ff 100%)',
  },
};

const Background = ({ mode }: { mode: 'gradient' | 'mesh' | 'texture' }) => {
  const layers = backgroundLayers[mode] || backgroundLayers.gradient;
  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 opacity-90" style={{ background: layers.glow }} />
      <div className="absolute inset-0" style={{ background: layers.base }} />
    </div>
  );
};

const DEFAULT_ROBOTS = 'index, follow';

const ensureCanonicalLink = (href: string) => {
  if (!href) return;
  const head = document.head || document.getElementsByTagName('head')[0];
  if (!head) return;
  let link = head.querySelector<HTMLLinkElement>("link[rel='canonical']");
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    head.appendChild(link);
  }
  link.setAttribute('href', href);
};

const upsertMeta = (name: string, content: string | null, attr: 'name' | 'http-equiv' = 'name') => {
  const head = document.head || document.getElementsByTagName('head')[0];
  if (!head) return;
  const selector = attr === 'name' ? `meta[${attr}='${name}']` : `meta[${attr}='${name}']`;
  let tag = head.querySelector<HTMLMetaElement>(selector);
  if (content == null) {
    if (tag?.parentNode) {
      tag.parentNode.removeChild(tag);
    }
    return;
  }
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, name);
    head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

const App = () => {
  const [siteContent, setSiteContent] = useState<SiteContent | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const loadContent = async () => {
      try {
        // Resolve content.json relative to the current page so slug-prefixed sites load correctly.
        const contentUrl = new URL('./content.json', window.location.href).toString();
        const response = await fetch(contentUrl, { cache: 'no-cache' });
        if (!response.ok) {
          throw new Error(`Failed to load content.json (${response.status})`);
        }
        const raw = await response.json();
        const data = (raw?.site || raw) as SiteContent;
        const slug = raw?.slug || (raw?.site?.slug as string | undefined) || data.slug || '';
        const normalized: SiteContent = { ...data, slug };
        setSiteContent(normalized);
        setStatus('ready');
        applyThemeToDocument(normalized.theme);
        if (typeof window !== 'undefined') {
          window.__AI_SITEMAKER_SLUG = slug || window.__AI_SITEMAKER_SLUG;
          const envApiBase =
            (import.meta.env?.VITE_RUNNER_API_BASE as string | undefined) ||
            (import.meta.env?.VITE_API_BASE as string | undefined) ||
            '';
          if (!window.__AI_SITEMAKER_API_BASE && envApiBase) {
            window.__AI_SITEMAKER_API_BASE = envApiBase.replace(/\/+$/, '');
          }
          if (slug) {
            document.documentElement.setAttribute('data-site-slug', slug);
          }
        }
      } catch (error) {
        console.error('[App] Failed to load site content', error);
        setStatus('error');
      }
    };
    loadContent();
  }, []);

  useEffect(() => {
    if (!siteContent) return;
    applyThemeToDocument(siteContent.theme);
    const slug = siteContent.slug || window.__AI_SITEMAKER_SLUG;
    const apiBase =
      window.__AI_SITEMAKER_API_BASE ||
      (import.meta.env?.VITE_RUNNER_API_BASE as string | undefined) ||
      (import.meta.env?.VITE_API_BASE as string | undefined) ||
      '';
    if (!slug || !apiBase) return;
    const endpoint = `${apiBase.replace(/\/+$/, '')}/analytics/events`;
    const payload = {
      slug,
      type: 'page_view',
      path: window.location.pathname,
      referrer: document.referrer || undefined,
    };
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
      } else {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => null);
      }
    } catch (error) {
      console.warn('[App] failed to record analytics event', error);
    }
  }, [siteContent]);

  useEffect(() => {
    if (!siteContent || typeof window === 'undefined') return;
    const slug = siteContent.slug || window.__AI_SITEMAKER_SLUG;
    if (siteContent.canonical) {
      ensureCanonicalLink(siteContent.canonical);
    }
    const apiBase =
      window.__AI_SITEMAKER_API_BASE ||
      (import.meta.env?.VITE_RUNNER_API_BASE as string | undefined) ||
      (import.meta.env?.VITE_API_BASE as string | undefined) ||
      '';
    if (!slug || !apiBase) return;
    const controller = new AbortController();
    const applySeoDirectives = async () => {
      try {
        const baseUrl = apiBase.replace(/\\/+$/, '');
        const url = new URL(`/seo/sites/${encodeURIComponent(slug)}`, baseUrl).toString();
        const requestUrl = new URL(url);
        if (window.location.host) {
          requestUrl.searchParams.set('host', window.location.host);
        }
        const response = await fetch(requestUrl.toString(), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const snapshot = await response.json();
        if (snapshot?.canonicalUrl) {
          ensureCanonicalLink(snapshot.canonicalUrl);
        }
        const robotsTag: string = snapshot?.host?.robotsTag || DEFAULT_ROBOTS;
        upsertMeta('robots', robotsTag);
        const xRobots: string | null = snapshot?.host?.xRobotsTag ?? null;
        upsertMeta('X-Robots-Tag', xRobots, 'http-equiv');
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        console.warn('[App] Failed to load SEO directives', error);
      }
    };
    applySeoDirectives();
    return () => controller.abort();
  }, [siteContent]);

  if (status === 'loading') {
    return (
      <div className="relative min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <div className="h-4 w-28 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-4 h-8 w-72 animate-pulse rounded-lg bg-slate-200" />
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-36 animate-pulse rounded-2xl bg-white shadow-sm" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!siteContent || status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-6 text-center shadow-lg shadow-black/40">
          <p className="text-lg font-semibold">Content unavailable</p>
          <p className="mt-2 text-sm text-slate-200">
            We could not load the site content. Check that <code className="font-mono">/content.json</code> is present.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <ImageModalProvider>
      <div className="relative min-h-screen">
        <Background mode={siteContent.theme.backgroundStyle} />
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
    </ImageModalProvider>
    </ToastProvider>
  );
};

export default App;
