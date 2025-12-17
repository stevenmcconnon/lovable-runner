const { XMLParser } = require('fast-xml-parser');

const PROVIDER_BASE =
  process.env.DOMAIN_REGISTRAR_API || process.env.DOMAIN_REGISTRAR_BASE || null;
const PROVIDER_KEY =
  process.env.DOMAIN_REGISTRAR_API_KEY || process.env.DOMAIN_REGISTRAR_TOKEN || null;

const NAMECHEAP_API_USER = process.env.NAMECHEAP_API_USER || null;
const NAMECHEAP_API_KEY = process.env.NAMECHEAP_API_KEY || null;
const NAMECHEAP_USERNAME =
  process.env.NAMECHEAP_USERNAME || process.env.NAMECHEAP_API_USER || null;
const NAMECHEAP_CLIENT_IP =
  process.env.NAMECHEAP_CLIENT_IP ||
  process.env.STATIC_EGRESS_IP ||
  process.env.DOMAIN_REGISTRAR_CLIENT_IP ||
  null;
const NAMECHEAP_BASE =
  process.env.NAMECHEAP_API_BASE ||
  (process.env.NAMECHEAP_MODE === 'sandbox'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

const useExternalRegistrar = () => Boolean(PROVIDER_BASE && PROVIDER_KEY);

const assertExternalRegistrar = () => {
  if (!useExternalRegistrar()) {
    const error = new Error(
      'Domain registrar is not configured (DOMAIN_REGISTRAR_API + DOMAIN_REGISTRAR_API_KEY required)'
    );
    error.statusCode = 500;
    throw error;
  }
};

const ensureNamecheapConfigured = () => {
  if (!NAMECHEAP_API_USER || !NAMECHEAP_API_KEY || !NAMECHEAP_CLIENT_IP) {
    const error = new Error(
      'Namecheap API is not configured (NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_CLIENT_IP required)'
    );
    error.statusCode = 500;
    throw error;
  }
};

const externalRegistrarRequest = async (path, options = {}) => {
  assertExternalRegistrar();
  const url = `${PROVIDER_BASE.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available in this runtime (Node.js 18+ required)');
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROVIDER_KEY}`,
    },
    body: JSON.stringify(options.body || {}),
  });
  if (!response.ok) {
    const message = await response.text();
    const error = new Error(
      `Domain registrar request failed (${response.status}): ${message}`
    );
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
};

const formatPhoneNumber = (value, countryCode) => {
  if (!value) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const prefix = String(countryCode || '').replace(/[^\d]/g, '') || '1';
  return `+${prefix}.${digits}`;
};

const buildStateChoice = (country) => {
  if (!country) return 'STATE';
  const upper = country.toUpperCase();
  if (upper === 'US' || upper === 'CA') return 'STATE';
  return 'PROVINCE';
};

const normalizeContact = (contact = {}) => {
  const name = contact.name || '';
  const [firstWord, ...rest] = name.trim().split(/\s+/).filter(Boolean);
  const firstName = contact.firstName || contact.givenName || firstWord;
  const lastName =
    contact.lastName ||
    contact.familyName ||
    (rest.length ? rest.join(' ') : firstWord ? 'Customer' : null);
  const email = (contact.email || '').trim().toLowerCase();
  const address1 = contact.address1 || contact.address || null;
  const city = contact.city || null;
  const state = contact.state || contact.region || contact.province || null;
  const postalCode = contact.postalCode || contact.zip || contact.postcode || null;
  const country = (contact.country || contact.countryCode || '').toUpperCase();
  const phone = formatPhoneNumber(contact.phone, contact.phoneCountryCode || contact.countryCode);

  const requiredFields = {
    email,
    firstName,
    lastName,
    address1,
    city,
    state,
    postalCode,
    country,
    phone,
  };
  const missing = Object.entries(requiredFields)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    const error = new Error(
      `Contact is missing required fields: ${missing
        .map((field) => field.replace(/([A-Z])/g, ' $1').toLowerCase())
        .join(', ')}`
    );
    error.statusCode = 400;
    throw error;
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
    phone,
    phoneExt: contact.phoneExt || '',
    stateChoice: buildStateChoice(country),
  };
};

const buildContactPayload = (prefix, contact) => ({
  [`${prefix}FirstName`]: contact.firstName,
  [`${prefix}LastName`]: contact.lastName,
  [`${prefix}Address1`]: contact.address1,
  [`${prefix}Address2`]: contact.address2 || '',
  [`${prefix}City`]: contact.city,
  [`${prefix}StateProvince`]: contact.state,
  [`${prefix}StateProvinceChoice`]: contact.stateChoice,
  [`${prefix}PostalCode`]: contact.postalCode,
  [`${prefix}Country`]: contact.country,
  [`${prefix}EmailAddress`]: contact.email,
  [`${prefix}OrganizationName`]: contact.organization,
  [`${prefix}JobTitle`]: contact.jobTitle,
  [`${prefix}Phone`]: contact.phone,
  [`${prefix}PhoneExt`]: contact.phoneExt,
});

const parseNamecheapErrors = (payload) => {
  const errors = payload?.Errors?.Error;
  if (!errors) return null;
  if (Array.isArray(errors)) {
    return errors.map((entry) => entry?.['#text'] || entry).filter(Boolean).join('; ');
  }
  return errors?.['#text'] || errors || null;
};

const namecheapRequest = async (command, params = {}) => {
  ensureNamecheapConfigured();
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available in this runtime (Node.js 18+ required)');
  }
  const query = new URLSearchParams({
    ApiUser: NAMECHEAP_API_USER,
    ApiKey: NAMECHEAP_API_KEY,
    UserName: NAMECHEAP_USERNAME || NAMECHEAP_API_USER,
    ClientIp: NAMECHEAP_CLIENT_IP,
    Command: command,
  });
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    query.append(key, value);
  });
  const response = await fetch(`${NAMECHEAP_BASE}?${query.toString()}`, { method: 'GET' });
  if (!response.ok) {
    const message = await response.text();
    const error = new Error(`Namecheap request failed (${response.status}): ${message}`);
    error.statusCode = response.status;
    throw error;
  }
  const text = await response.text();
  const parsed = xmlParser.parse(text);
  const payload = parsed?.ApiResponse;
  const status = payload?.['@_Status'] || 'ERROR';
  if (status !== 'OK') {
    const message = parseNamecheapErrors(payload) || 'Unknown Namecheap error';
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }
  return payload?.CommandResponse || {};
};

const checkAvailabilityWithExternalRegistrar = async ({ domain }) => {
  const result = await externalRegistrarRequest('domains/check', { body: { domain } });
  return {
    domain,
    available: Boolean(result?.available),
    alternatives: result?.alternatives || [],
  };
};

const checkAvailabilityWithNamecheap = async ({ domain }) => {
  const commandResponse = await namecheapRequest('namecheap.domains.check', {
    DomainList: domain,
  });
  const result = commandResponse?.DomainCheckResult;
  const resolved = Array.isArray(result)
    ? result.find((entry) => entry?.['@_Domain'])
    : result;
  const available = String(resolved?.['@_Available'] || 'false').toLowerCase() === 'true';
  return {
    domain,
    available,
    alternatives: [],
  };
};

const checkAvailability = async ({ domain }) => {
  if (!domain) {
    const error = new Error('domain is required');
    error.statusCode = 400;
    throw error;
  }
  if (useExternalRegistrar()) {
    return checkAvailabilityWithExternalRegistrar({ domain });
  }
  ensureNamecheapConfigured();
  return checkAvailabilityWithNamecheap({ domain });
};

const registerWithExternalRegistrar = async ({ domain, contact, slug }) => {
  const result = await externalRegistrarRequest('domains/register', {
    body: {
      domain,
      contact,
      metadata: { slug },
    },
  });
  return {
    orderId: result?.orderId,
    status: result?.status || 'pending',
    nameservers: result?.nameservers || [],
    verification: result?.verification || null,
  };
};

const extractNameservers = (commandResponse) => {
  const raw = commandResponse?.DomainCreateResult?.Nameserver;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? entry : entry?.['#text']))
      .filter(Boolean);
  }
  if (typeof raw === 'string') return [raw];
  const extracted = raw?.['#text'] || raw;
  return extracted ? [extracted] : [];
};

const registerWithNamecheap = async ({ domain, contact, slug, years }) => {
  const normalized = normalizeContact(contact || {});
  const payload = {
    DomainName: domain,
    Years: years || contact?.years || 1,
    ...buildContactPayload('Registrant', normalized),
    ...buildContactPayload('Tech', normalized),
    ...buildContactPayload('Admin', normalized),
    ...buildContactPayload('AuxBilling', normalized),
    PromotionCode: contact?.promotionCode || '',
  };
  if (slug) {
    payload.RegistrantJobTitle = `${normalized.jobTitle} (${slug})`;
  }
  const commandResponse = await namecheapRequest('namecheap.domains.create', payload);
  const result = commandResponse?.DomainCreateResult || {};
  const registered =
    String(result?.['@_Registered'] || 'false').toLowerCase() === 'true';
  const orderId = result?.['@_OrderId'] || result?.['@_TransactionId'] || null;
  return {
    orderId,
    status: registered ? 'registered' : 'processing',
    nameservers: extractNameservers(commandResponse),
    verification: {
      transactionId: result?.['@_TransactionId'] || null,
      whoisGuardEnabled:
        String(result?.['@_WhoisguardEnable'] || 'false').toLowerCase() === 'true',
    },
  };
};

const registerDomain = async ({ domain, contact, slug, years }) => {
  if (!domain || !contact?.email) {
    const error = new Error('domain and contact.email are required');
    error.statusCode = 400;
    throw error;
  }
  if (useLegacyProvider()) {
    return registerWithLegacyProvider({ domain, contact, slug });
  }
  ensureNamecheapConfigured();
  return registerWithNamecheap({ domain, contact, slug, years });
};

module.exports = {
  checkAvailability,
  registerDomain,
};
