const getUserContext = (event) => {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ||
    event?.requestContext?.authorizer?.claims ||
    {};

  const groupsClaim =
    claims['cognito:groups'] ||
    claims['cognito:preferred_role'] ||
    claims['custom:groups'];

  const groups = Array.isArray(groupsClaim)
    ? groupsClaim
    : typeof groupsClaim === 'string'
    ? groupsClaim.split(',').map((value) => value.trim()).filter(Boolean)
    : [];

  return {
    sub: claims.sub || claims['cognito:username'] || null,
    email: claims.email || null,
    name: claims.name || null,
    groups,
  };
};

const requireRole = (user, allowedGroups = []) => {
  if (!allowedGroups || !allowedGroups.length) return;
  const userGroups = user?.groups || [];
  const authorized = userGroups.some((group) => allowedGroups.includes(group));
  if (!authorized) {
    const error = new Error('Forbidden');
    error.statusCode = 403;
    throw error;
  }
};

module.exports = { getUserContext, requireRole };
