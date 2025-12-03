const normalizeDomainRecord = (entry = {}) => {
  if (typeof entry === 'string') {
    return { domain: entry, type: 'manual', status: 'verified', isPrimary: false };
  }
  const base = entry && typeof entry === 'object' ? entry : {};
  return {
    id: base.id || null,
    accountId: base.accountId || null,
    slug: base.slug || null,
    domain: base.domain || null,
    type: base.type || 'manual',
    provider: base.provider || null,
    status: base.status || 'verified',
    verificationToken: base.verificationToken || null,
    dnsSettings: base.dnsSettings || null,
    verifiedAt: base.verifiedAt || null,
    lastCheckedAt: base.lastCheckedAt || null,
    createdAt: base.createdAt || null,
    updatedAt: base.updatedAt || null,
    isPrimary: Boolean(base.isPrimary),
  };
};

const parseAccountDomainMap = () => {
  const raw = process.env.ACCOUNT_DOMAIN_MAP || process.env.DOMAIN_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const normalized = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      normalized[key] = value.map(normalizeDomainRecord).filter((item) => item.domain);
    });
    return normalized;
  } catch (error) {
    console.warn('[domain-store] Failed to parse ACCOUNT_DOMAIN_MAP (expected JSON object)', error.message);
    return {};
  }
};

let domainMap = parseAccountDomainMap();

const resolveDomainsForUser = (user) => {
  const map = domainMap || {};
  const keys = [
    user?.accountId,
    user?.sub,
    user?.email,
    ...(user?.groups || []),
  ].filter(Boolean);
  const resolved = [];
  keys.forEach((key) => {
    if (map[key]) resolved.push(...map[key]);
  });
  if (map['*']) resolved.push(...map['*']);
  if (map.default) resolved.push(...map.default);
  return resolved.length ? resolved : [];
};

const listDomainsForUser = async ({ user } = {}) => {
  const entries = resolveDomainsForUser(user);
  const byDomain = new Map();
  entries.forEach((entry) => {
    if (entry.domain && !byDomain.has(entry.domain)) {
      byDomain.set(entry.domain, {
        ...entry,
        id: entry.id || entry.domain,
        dns: entry.dnsSettings || null,
      });
    }
  });
  return Array.from(byDomain.values());
};

const getDomainRecord = async ({ user, domain }) => {
  if (!domain) return null;
  const entries = await listDomainsForUser({ user });
  return entries.find((item) => item.domain === domain) || null;
};

const setPrimaryDomain = async ({ slug, domain, user }) => {
  if (!slug || !domain) {
    const error = new Error('slug and domain are required');
    error.statusCode = 400;
    throw error;
  }
  const accessible = resolveDomainsForUser(user);
  const targetEntry = accessible.find(
    (item) => item.domain === domain && (!item.slug || item.slug === slug)
  );
  if (!targetEntry) {
    const error = new Error('Domain not found');
    error.statusCode = 404;
    throw error;
  }

  const clearPrimary = (entries) =>
    entries.forEach((entry) => {
      if (entry.slug === slug) entry.isPrimary = false;
    });

  clearPrimary(accessible);
  targetEntry.isPrimary = true;

  // Persist back to domainMap for this process so subsequent reads reflect the change.
  const map = domainMap || {};
  Object.keys(map).forEach((key) => {
    const entries = map[key];
    if (Array.isArray(entries)) clearPrimary(entries);
  });
  Object.keys(map).forEach((key) => {
    const entries = map[key];
    if (Array.isArray(entries)) {
      entries.forEach((entry) => {
        if (entry.domain === domain && (!entry.slug || entry.slug === slug)) {
          entry.isPrimary = true;
        }
      });
    }
  });

  return { ...targetEntry };
};

module.exports = {
  listDomainsForUser,
  getDomainRecord,
  setPrimaryDomain,
};
