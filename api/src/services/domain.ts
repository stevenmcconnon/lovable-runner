import { randomUUID } from 'node:crypto';

type DomainSearchResult = {
  domain: string;
  tld: string;
  available: boolean;
  currency: string;
  priceCents: number;
  termYears: number;
};

type DnsRecord = {
  type: string;
  host: string;
  value: string;
  ttl: number;
};

type DnsConfig = {
  domain: string;
  slug: string;
  verificationToken: string;
  records: DnsRecord[];
};

const sanitizeDomainInput = (value: string) =>
  value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/^-+|-+$/g, '');

export class DomainService {
  private defaultTlds = ['com', 'net', 'ai', 'co'];

  private previewDomain = (process.env.PREVIEW_DOMAIN || 'preview.ai-sitemaker.com').replace(/\/+$/, '');

  private liveDomain = (process.env.LIVE_DOMAIN || 'sites.ai-sitemaker.com').replace(/\/+$/, '');

  private apexIps =
    (process.env.LIVE_APEX_IPS || '76.223.21.61,13.248.155.104')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean) || [];

  search(query: string, tlds?: string[], limit = 8): DomainSearchResult[] {
    const base = this.normalizeLabel(query);
    const suffixes = (tlds && tlds.length ? tlds : this.defaultTlds).slice(0, limit);
    return suffixes.map((tld, index) => ({
      domain: `${base}.${tld}`,
      tld,
      available: true,
      currency: 'USD',
      priceCents: 3500 + index * 500,
      termYears: 1,
    }));
  }

  purchaseDomain(domain: string): { providerOrderId: string; status: string } {
    return {
      providerOrderId: randomUUID(),
      status: 'processing',
    };
  }

  buildDnsConfig(params: { slug: string; domain: string; verificationToken?: string }): DnsConfig {
    const verificationToken =
      params.verificationToken ?? this.buildVerificationToken(params.domain);
    const safeSlug = this.normalizeLabel(params.slug).replace(/[^a-z0-9-]/g, '');
    const records: DnsRecord[] = [
      {
        type: 'CNAME',
        host: 'www',
        value: `${safeSlug}.${this.previewDomain}`,
        ttl: 300,
      },
      {
        type: 'TXT',
        host: '_aisite',
        value: `verify=${verificationToken}`,
        ttl: 300,
      },
    ];
    this.apexIps.forEach((ip) => {
      records.push({
        type: 'A',
        host: '@',
        value: ip,
        ttl: 300,
      });
    });
    return {
      domain: params.domain,
      slug: safeSlug,
      verificationToken,
      records,
    };
  }

  buildVerificationToken(domain: string): string {
    const sanitized = this.normalizeLabel(domain);
    return `aisite-${sanitized}-${Date.now().toString(36)}`;
  }

  normalizeLabel(value: string): string {
    const sanitized = sanitizeDomainInput(value);
    if (!sanitized || sanitized === '.') {
      return `site-${Date.now().toString(36)}`;
    }
    const withoutTld = sanitized.split('.')[0];
    return withoutTld.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'site';
  }
}

export const domainHelpers = {
  sanitizeDomainInput,
};
