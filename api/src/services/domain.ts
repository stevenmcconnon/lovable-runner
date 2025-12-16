import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export type DomainSearchResult = {
  domain: string;
  tld: string;
  available: boolean;
  currency: string;
  priceCents?: number;
  termYears: number;
};

export type DnsRecord = {
  type: string;
  host: string;
  value: string;
  ttl: number;
  priority?: number;
};

export type DnsConfig = {
  domain: string;
  slug: string;
  verificationToken: string;
  records: DnsRecord[];
};

export type DomainContactInput = {
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  phone: string;
  phoneCountryCode?: string;
  phoneExt?: string;
  address?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  region?: string;
  province?: string;
  postalCode?: string;
  zip?: string;
  postcode?: string;
  country?: string;
  countryCode?: string;
  organization?: string;
  company?: string;
  jobTitle?: string;
  title?: string;
  promotionCode?: string;
};

type NormalizedContact = {
  firstName: string;
  lastName: string;
  organization: string;
  jobTitle: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  phoneExt?: string;
  stateChoice: 'STATE' | 'PROVINCE';
  promotionCode?: string;
};

type DomainPurchaseResult = {
  provider: string;
  providerOrderId: string | null;
  status: string;
  nameservers: string[];
  verification?: Record<string, unknown> | null;
};

type DomainServiceOptions = {
  namecheap?: NamecheapConfig | null;
  pricing?: {
    defaultBasePriceCents?: number;
    cacheTtlMs?: number;
  };
};

type NamecheapConfig = {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
  baseUrl?: string;
};

type DomainWireResult = { success: boolean };

const sanitizeDomainInput = (value: string) =>
  value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/^-+|-+$/g, '');

const formatPhoneNumber = (value: string, countryCode?: string | null): string | null => {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const prefix = (countryCode || '').replace(/[^\d]/g, '') || '1';
  return `+${prefix}.${digits}`;
};

const buildStateChoice = (country: string) => {
  if (!country) return 'STATE';
  const cc = country.toUpperCase();
  return cc === 'US' || cc === 'CA' ? 'STATE' : 'PROVINCE';
};

const deriveNameParts = (contact: DomainContactInput) => {
  if (contact.firstName && contact.lastName) {
    return { firstName: contact.firstName, lastName: contact.lastName };
  }
  const name = contact.name || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: 'Customer' };
  }
  return { firstName: 'Site', lastName: 'Owner' };
};

const normalizeContact = (contact?: DomainContactInput): NormalizedContact => {
  if (!contact) {
    throw new Error('Contact information is required');
  }
  const { firstName, lastName } = deriveNameParts(contact);
  const email = (contact.email || '').trim().toLowerCase();
  const phone = formatPhoneNumber(contact.phone || '', contact.phoneCountryCode || contact.countryCode);
  const address1 = contact.address1 || contact.address || '';
  const city = contact.city || '';
  const state = contact.state || contact.region || contact.province || '';
  const postalCode = contact.postalCode || contact.zip || contact.postcode || '';
  const country = (contact.country || contact.countryCode || '').toUpperCase();

  const missing: string[] = [];
  if (!email) missing.push('email');
  if (!phone) missing.push('phone');
  if (!address1) missing.push('address1');
  if (!city) missing.push('city');
  if (!state) missing.push('state');
  if (!postalCode) missing.push('postalCode');
  if (!country) missing.push('country');
  if (missing.length) {
    throw new Error(`Contact is missing required fields: ${missing.join(', ')}`);
  }

  return {
    firstName,
    lastName,
    organization: contact.organization || contact.company || `${firstName} ${lastName}`,
    jobTitle: contact.jobTitle || contact.title || 'Owner',
    email,
    address1,
    address2: contact.address2 || '',
    city,
    state,
    postalCode,
    country,
    phone: phone!,
    phoneExt: contact.phoneExt,
    stateChoice: buildStateChoice(country),
    promotionCode: contact.promotionCode,
  };
};

const splitDomain = (domain: string) => {
  const idx = domain.indexOf('.');
  if (idx === -1) {
    throw new Error('Domain must include a TLD (e.g., example.com)');
  }
  return {
    sld: domain.slice(0, idx),
    tld: domain.slice(idx + 1),
  };
};

const buildContactPayload = (prefix: string, contact: NormalizedContact) => ({
  [`${prefix}FirstName`]: contact.firstName,
  [`${prefix}LastName`]: contact.lastName,
  [`${prefix}Address1`]: contact.address1,
  [`${prefix}Address2`]: contact.address2,
  [`${prefix}City`]: contact.city,
  [`${prefix}StateProvince`]: contact.state,
  [`${prefix}StateProvinceChoice`]: contact.stateChoice,
  [`${prefix}PostalCode`]: contact.postalCode,
  [`${prefix}Country`]: contact.country,
  [`${prefix}EmailAddress`]: contact.email,
  [`${prefix}OrganizationName`]: contact.organization,
  [`${prefix}JobTitle`]: contact.jobTitle,
  [`${prefix}Phone`]: contact.phone,
  [`${prefix}PhoneExt`]: contact.phoneExt ?? '',
});

class NamecheapClient {
  private parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
  });

  constructor(private readonly config: NamecheapConfig) {}

  private async request(command: string, params: Record<string, string | number | undefined>) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch is not available in this runtime');
    }
    const query = new URLSearchParams({
      ApiUser: this.config.apiUser,
      ApiKey: this.config.apiKey,
      UserName: this.config.username || this.config.apiUser,
      ClientIp: this.config.clientIp,
      Command: command,
    });
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      query.append(key, String(value));
    });
    const response = await fetch(`${this.config.baseUrl || 'https://api.namecheap.com/xml.response'}?${query.toString()}`, {
      method: 'GET',
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Namecheap request failed (${response.status}): ${message}`);
    }
    const text = await response.text();
    const parsed = this.parser.parse(text);
    const payload = parsed?.ApiResponse;
    const status = payload?.['@_Status'] || 'ERROR';
    if (status !== 'OK') {
      const message = this.extractErrors(payload) || 'Unknown Namecheap error';
      throw new Error(message);
    }
    return payload?.CommandResponse || {};
  }

  async getPricing(): Promise<Map<string, number>> {
    const commandResponse = await this.request('namecheap.users.getPricing', {
      ProductType: 'DOMAIN',
      ProductCategory: 'DOMAINS',
      ActionName: 'REGISTER',
    });
    const items = commandResponse?.UserGetPricingResult?.ProductType;
    const priceMap = new Map<string, number>();
    const productsArray = Array.isArray(items) ? items : items ? [items] : [];
    productsArray.forEach((product: any) => {
      const productCategories = product?.ProductCategory;
      const categories = Array.isArray(productCategories)
        ? productCategories
        : productCategories
        ? [productCategories]
        : [];
      categories.forEach((category: any) => {
        const products = category?.Product;
        const productEntries = Array.isArray(products) ? products : products ? [products] : [];
        productEntries.forEach((entry: any) => {
          const tld = (entry?.['@_Name'] || '').toLowerCase();
          const price = Number(entry?.['@_Price'] || entry?.['@_RetailPrice'] || 0);
          if (tld && Number.isFinite(price) && price > 0) {
            priceMap.set(tld, Math.round(price * 100));
          }
        });
      });
    });
    return priceMap;
  }

  private extractErrors(payload: any): string | null {
    const errors = payload?.Errors?.Error;
    if (!errors) return null;
    if (Array.isArray(errors)) {
      return errors.map((entry) => entry?.['#text'] || entry).filter(Boolean).join('; ');
    }
    return errors?.['#text'] || errors || null;
  }

  async checkDomains(domains: string[]): Promise<Map<string, boolean>> {
    if (!domains.length) return new Map();
    const commandResponse = await this.request('namecheap.domains.check', {
      DomainList: domains.join(','),
    });
    const results = commandResponse?.DomainCheckResult;
    const entries = Array.isArray(results) ? results : results ? [results] : [];
    const availability = new Map<string, boolean>();
    entries.forEach((entry: any) => {
      const domain = (entry?.['@_Domain'] || '').toLowerCase();
      if (!domain) return;
      const available = String(entry?.['@_Available'] || 'false').toLowerCase() === 'true';
      availability.set(domain, available);
    });
    return availability;
  }

  async registerDomain(params: {
    domain: string;
    years?: number;
    contact: DomainContactInput;
    slug?: string;
  }): Promise<DomainPurchaseResult> {
    const normalized = normalizeContact(params.contact);
    const payload: Record<string, string | number | undefined> = {
      DomainName: params.domain,
      Years: params.years ?? 1,
      PromotionCode: normalized.promotionCode ?? '',
      AddFreeWhoisguard: 'yes',
      WGEnabled: 'yes',
      ...buildContactPayload('Registrant', normalized),
      ...buildContactPayload('Tech', normalized),
      ...buildContactPayload('Admin', normalized),
      ...buildContactPayload('AuxBilling', normalized),
    };
    if (params.slug) {
      payload.RegistrantJobTitle = `${normalized.jobTitle} (${params.slug})`;
    }
    const commandResponse = await this.request('namecheap.domains.create', payload);
    const result = commandResponse?.DomainCreateResult || {};
    const registered = String(result?.['@_Registered'] || 'false').toLowerCase() === 'true';
    const orderId = result?.['@_OrderId'] || result?.['@_TransactionId'] || null;
    return {
      provider: 'namecheap',
      providerOrderId: orderId,
      status: registered ? 'registered' : 'processing',
      nameservers: this.extractNameservers(commandResponse),
      verification: {
        transactionId: result?.['@_TransactionId'] || null,
        whoisGuardEnabled:
          String(result?.['@_WhoisguardEnable'] || 'false').toLowerCase() === 'true',
      },
    };
  }

  private extractNameservers(commandResponse: any): string[] {
    const raw = commandResponse?.DomainCreateResult?.Nameserver;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((entry) => (typeof entry === 'string' ? entry : entry?.['#text'])).filter(Boolean);
    }
    if (typeof raw === 'string') return [raw];
    const extracted = raw?.['#text'] || raw;
    return extracted ? [extracted] : [];
  }

  async setHosts(domain: string, records: DnsRecord[]): Promise<void> {
    const { sld, tld } = splitDomain(domain);
    const params: Record<string, string | number> = {
      SLD: sld,
      TLD: tld,
    };
    records.forEach((record, index) => {
      const idx = index + 1;
      params[`HostName${idx}`] = record.host || '@';
      params[`RecordType${idx}`] = record.type.toUpperCase();
      params[`Address${idx}`] = record.value;
      params[`TTL${idx}`] = Math.max(60, record.ttl || 300);
      if (record.type.toUpperCase() === 'MX' && record.priority !== undefined) {
        params[`MXPref${idx}`] = record.priority;
      }
    });
    const commandResponse = await this.request('namecheap.domains.dns.setHosts', params);
    const result = commandResponse?.DomainDNSSetHostsResult;
    const success =
      String(result?.['@_IsSuccess'] || 'false').toLowerCase() === 'true';
    if (!success) {
      throw new Error('Namecheap rejected DNS settings update');
    }
  }
}

export class DomainService {
  private defaultTlds = ['com', 'net', 'ai', 'co'];
  private previewDomain = (process.env.PREVIEW_DOMAIN || 'preview.ai-sitemaker.com').replace(/\/+$/, '');
  private apexIps =
    (process.env.LIVE_APEX_IPS || '76.223.21.61,13.248.155.104')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean) || [];

  private managedProvider: NamecheapClient | null = null;
  private providerName = 'stub-reseller';
  private defaultBasePriceCents: number;
  private pricingCache: { expiresAt: number; map: Map<string, number> } | null = null;
  private pricingCacheTtlMs: number;

  constructor(options: DomainServiceOptions = {}) {
    if (options.namecheap?.apiUser && options.namecheap.apiKey && options.namecheap.clientIp) {
      this.managedProvider = new NamecheapClient(options.namecheap);
      this.providerName = 'namecheap';
    }
    this.defaultBasePriceCents = Math.max(options.pricing?.defaultBasePriceCents ?? 1500, 100);
    this.pricingCacheTtlMs = options.pricing?.cacheTtlMs ?? 30 * 60 * 1000;
  }

  supportsManagedRegistrar(): boolean {
    return Boolean(this.managedProvider);
  }

  getProviderCode(): string {
    return this.providerName;
  }

  async search(query: string, tlds?: string[], limit = 8): Promise<DomainSearchResult[]> {
    const base = this.normalizeLabel(query);
    const suffixes = (tlds && tlds.length ? tlds : this.defaultTlds).slice(0, limit);
    const candidates = suffixes.map((tld) => `${base}.${tld}`);
    if (!this.managedProvider) {
      return suffixes.map((tld, index) => ({
        domain: `${base}.${tld}`,
        tld,
        available: true,
        currency: 'USD',
        priceCents: 3500 + index * 500,
        termYears: 1,
      }));
    }
    const [availability, pricing] = await Promise.all([
      this.managedProvider.checkDomains(candidates),
      this.getPricingMap(),
    ]);
    return suffixes.map((tld) => {
      const domain = `${base}.${tld}`;
      return {
        domain,
        tld,
        available: availability.get(domain.toLowerCase()) ?? false,
        currency: 'USD',
        priceCents: pricing.get(tld) ?? undefined,
        termYears: 1,
      };
    });
  }

  private async getPricingMap(): Promise<Map<string, number>> {
    if (!this.managedProvider) return new Map();
    const now = Date.now();
    if (this.pricingCache && this.pricingCache.expiresAt > now) {
      return this.pricingCache.map;
    }
    const pricing = await this.managedProvider.getPricing().catch(() => new Map<string, number>());
    this.pricingCache = {
      map: pricing,
      expiresAt: now + this.pricingCacheTtlMs,
    };
    return pricing;
  }

  async lookupBasePrice(domain: string): Promise<number> {
    const tld = domain.split('.').pop()?.toLowerCase();
    if (!tld || !this.managedProvider) {
      return this.defaultBasePriceCents;
    }
    const pricing = await this.getPricingMap();
    return pricing.get(tld) ?? this.defaultBasePriceCents;
  }

  async purchaseDomain(params: {
    domain: string;
    slug: string;
    years?: number;
    contact: DomainContactInput;
  }): Promise<DomainPurchaseResult> {
    if (!this.managedProvider) {
      return {
        provider: this.providerName,
        providerOrderId: randomUUID(),
        status: 'processing',
        nameservers: [],
      };
    }
    return this.managedProvider.registerDomain({
      domain: params.domain,
      years: params.years,
      contact: params.contact,
      slug: params.slug,
    });
  }

  async wireDomain(params: { domain: string; dnsConfig: DnsConfig }): Promise<DomainWireResult> {
    if (!this.managedProvider) {
      throw new Error('Automatic DNS wiring is not configured');
    }
    await this.managedProvider.setHosts(params.domain, params.dnsConfig.records);
    return { success: true };
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
