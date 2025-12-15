const PROVIDER_BASE =
  process.env.DOMAIN_REGISTRAR_API ||
  process.env.DOMAIN_REGISTRAR_BASE ||
  null;
const PROVIDER_KEY =
  process.env.DOMAIN_REGISTRAR_API_KEY ||
  process.env.DOMAIN_REGISTRAR_TOKEN ||
  null;

const assertProvider = () => {
  if (!PROVIDER_BASE || !PROVIDER_KEY) {
    const error = new Error(
      'Domain registrar is not configured (DOMAIN_REGISTRAR_API + DOMAIN_REGISTRAR_API_KEY required)'
    );
    error.statusCode = 500;
    throw error;
  }
};

const request = async (path, options = {}) => {
  assertProvider();
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

const checkAvailability = async ({ domain }) => {
  if (!domain) {
    const error = new Error('domain is required');
    error.statusCode = 400;
    throw error;
  }
  const result = await request('domains/check', { body: { domain } });
  return {
    domain,
    available: Boolean(result?.available),
    alternatives: result?.alternatives || [],
  };
};

const registerDomain = async ({ domain, contact, slug }) => {
  if (!domain || !contact?.email) {
    const error = new Error('domain and contact.email are required');
    error.statusCode = 400;
    throw error;
  }
  const result = await request('domains/register', {
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

module.exports = {
  checkAvailability,
  registerDomain,
};
