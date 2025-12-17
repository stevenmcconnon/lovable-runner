import { URL } from 'node:url';
import { config } from '../env';
import { DatabaseService } from './database';
import { DomainRecord } from '../types';

const siteStore = require('../../src/site-store.js');

export type SiteSeoSnapshot = {
  slug: string;
  canonicalUrl: string;
  previewUrl: string | null;
  primaryHost: string;
  hasCustomDomain: boolean;
  host: {
    name: string;
    type: 'primary' | 'preview' | 'alias' | 'unknown';
    robotsTag: string;
    xRobotsTag: string | null;
    canonicalUrl: string;
  };
  directives: {
    preview: { host: string | null; robotsTag: string; xRobotsTag: string | null };
    primary: { host: string; robotsTag: string; xRobotsTag: string | null };
    aliases: Array<{ host: string; robotsTag: string; xRobotsTag: string | null }>;
  };
  sitemap: { urls: string[] };
};

const DEFAULT_ROBOTS_INDEX = 'index, follow';
const DEFAULT_ROBOTS_NOINDEX = 'noindex, follow';

const normalizeHost = (value?: string | null) =>
  value ? value.trim().replace(/\.$/, '').toLowerCase() : '';

const ensureTrailingSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`);

const unique = <T>(items: T[]) => Array.from(new Set(items));

export class SiteSeoService {
  private previewHost: string;

  constructor(private readonly deps: { db: DatabaseService }) {
    this.previewHost = normalizeHost(config.domains.previewDomain || config.domains.liveDomain || '');
  }

  private buildPreviewUrl(slug: string, metadata?: any): string | null {
    if (!this.previewHost || !slug) return null;
    const prefix = (metadata?.prefix || slug).replace(/^\/+|\/+$|\.+$/g, '');
    if (!prefix) return null;
    return ensureTrailingSlash(`https://${this.previewHost}/${prefix}`);
  }

  private determinePrimaryDomain(domains: DomainRecord[]): DomainRecord | null {
    if (!Array.isArray(domains) || !domains.length) return null;
    const primary = domains.find((domain) => domain.isPrimary);
    if (primary) return primary;
    return domains[0] ?? null;
  }

  private computeCanonicalUrl(slug: string, metadata: any, primaryDomain: DomainRecord | null): { url: string; host: string } {
    if (primaryDomain) {
      const host = normalizeHost(primaryDomain.canonicalHost || primaryDomain.domain || '');
      const url = ensureTrailingSlash(`https://${host}`);
      return { url, host };
    }
    const previewUrl = this.buildPreviewUrl(slug, metadata) || ensureTrailingSlash(`https://${this.previewHost}/${slug}`);
    return { url: previewUrl, host: this.previewHost };
  }

  private buildSitemapUrls(site: any, canonicalUrl: string): string[] {
    const base = ensureTrailingSlash(canonicalUrl);
    const urls = new Set<string>([base]);
    const addPath = (pathValue?: string | null) => {
      if (!pathValue) return;
      const trimmed = pathValue.trim();
      if (!trimmed || trimmed === '/' || trimmed === '#') return;
      const sanitized = trimmed.replace(/^\//, '');
      urls.add(`${base}${sanitized}`);
    };
    if (Array.isArray(site?.pages)) {
      site.pages.forEach((page: any) => addPath(page?.path));
    }
    return Array.from(urls.values());
  }

  private buildAliasDirectives(domains: DomainRecord[], primaryHost: string): Array<{ host: string; robotsTag: string; xRobotsTag: string | null }> {
    if (!Array.isArray(domains)) return [];
    return domains
      .filter((domain) => normalizeHost(domain.canonicalHost || domain.domain) !== primaryHost)
      .map((domain) => ({
        host: normalizeHost(domain.canonicalHost || domain.domain || ''),
        robotsTag: DEFAULT_ROBOTS_NOINDEX,
        xRobotsTag: DEFAULT_ROBOTS_NOINDEX,
      }));
  }

  private determineHostType(hostname: string, primaryHost: string, hasCustomDomain: boolean): 'primary' | 'preview' | 'alias' | 'unknown' {
    if (hostname === primaryHost) return 'primary';
    if (hostname === this.previewHost) {
      return hasCustomDomain ? 'preview' : 'primary';
    }
    if (hostname) return 'alias';
    return 'unknown';
  }

  async buildSnapshot(slug: string, hostHeader?: string | null): Promise<SiteSeoSnapshot | null> {
    if (!slug) return null;
    const siteConfig = await siteStore.loadSiteConfig(slug);
    if (!siteConfig?.site) {
      return null;
    }
    const domains = await this.deps.db.listDomainsForSlug(slug);
    const primaryDomain = this.determinePrimaryDomain(domains);
    const canonical = this.computeCanonicalUrl(slug, siteConfig.metadata, primaryDomain);
    const previewUrl = this.buildPreviewUrl(slug, siteConfig.metadata);
    const sitemapUrls = this.buildSitemapUrls(siteConfig.site, canonical.url);
    const previewDirective = {
      host: this.previewHost,
      robotsTag: !primaryDomain ? DEFAULT_ROBOTS_INDEX : DEFAULT_ROBOTS_NOINDEX,
      xRobotsTag: primaryDomain ? DEFAULT_ROBOTS_NOINDEX : null,
    };
    const primaryDirective = {
      host: canonical.host,
      robotsTag: DEFAULT_ROBOTS_INDEX,
      xRobotsTag: null,
    };
    const aliasDirectives = this.buildAliasDirectives(domains, canonical.host);
    const requestedHost = normalizeHost(hostHeader);
    const hostType = this.determineHostType(requestedHost, canonical.host, Boolean(primaryDomain));
    let hostRobots = DEFAULT_ROBOTS_INDEX;
    let hostXRobots: string | null = null;
    if (hostType === 'preview' && primaryDomain) {
      hostRobots = DEFAULT_ROBOTS_NOINDEX;
      hostXRobots = DEFAULT_ROBOTS_NOINDEX;
    }
    if (hostType === 'alias') {
      hostRobots = DEFAULT_ROBOTS_NOINDEX;
      hostXRobots = DEFAULT_ROBOTS_NOINDEX;
    }
    const snapshot: SiteSeoSnapshot = {
      slug,
      canonicalUrl: canonical.url,
      previewUrl,
      primaryHost: canonical.host,
      hasCustomDomain: Boolean(primaryDomain),
      host: {
        name: requestedHost || canonical.host,
        type: hostType,
        robotsTag: hostRobots,
        xRobotsTag: hostXRobots,
        canonicalUrl: canonical.url,
      },
      directives: {
        preview: previewDirective,
        primary: primaryDirective,
        aliases: aliasDirectives,
      },
      sitemap: { urls: sitemapUrls },
    };
    return snapshot;
  }

  async buildSitemapXml(slug: string): Promise<{ body: string; canonicalUrl: string } | null> {
    const snapshot = await this.buildSnapshot(slug);
    if (!snapshot) return null;
    const urls = snapshot.sitemap.urls;
    const now = new Date().toISOString();
    const items = urls
      .map((url) => `  <url>\n    <loc>${url}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>`)
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
    return { body: xml, canonicalUrl: snapshot.canonicalUrl };
  }

  async buildRobotsTxt(slug: string): Promise<string | null> {
    const snapshot = await this.buildSnapshot(slug);
    if (!snapshot) return null;
    const sitemapUrl = `${snapshot.canonicalUrl.replace(/\/$/, '')}/sitemap.xml`;
    return [`User-agent: *`, 'Allow: /', `Sitemap: ${sitemapUrl}`].join('\n');
  }
}
