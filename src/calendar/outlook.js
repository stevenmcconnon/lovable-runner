const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const EVENTS_URL = 'https://graph.microsoft.com/v1.0/me/events';

const CLIENT_ID = process.env.OUTLOOK_CALENDAR_CLIENT_ID || process.env.MS_CLIENT_ID;
const CLIENT_SECRET =
  process.env.OUTLOOK_CALENDAR_CLIENT_SECRET || process.env.MS_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.OUTLOOK_CALENDAR_REDIRECT_URI ||
  process.env.MS_REDIRECT_URI ||
  'https://api.ai-sitemaker.com/oauth/outlook/calendar/callback';

const SCOPES = [
  'offline_access',
  'Calendars.ReadWrite',
  'User.Read',
];

const buildAuthUrl = ({ slug, state }) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state: JSON.stringify({ slug, token: state }),
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
};

const exchangeCodeForTokens = async ({ code }) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code,
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`Outlook token exchange failed: ${payload}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
};

const refreshAccessToken = async ({ refreshToken }) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: REDIRECT_URI,
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`Outlook token refresh failed: ${payload}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
};

const ensureAccessToken = async ({ token, refreshToken, expiresAt }) => {
  const now = Date.now();
  if (token && expiresAt && now < expiresAt - 15000) {
    return { accessToken: token };
  }
  if (!refreshToken) {
    throw new Error('No refresh token available for Outlook calendar sync');
  }
  const result = await refreshAccessToken({ refreshToken });
  return {
    accessToken: result.access_token,
    expiresAt: result.expires_in ? now + result.expires_in * 1000 : null,
    refreshToken: result.refresh_token || refreshToken,
  };
};

const fetchProfile = async ({ accessToken }) => {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`Outlook profile fetch failed: ${payload}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
};

const syncAppointment = async ({
  appointment,
  accessToken,
  calendarEventId,
}) => {
  if (!appointment.confirmedStart) {
    throw new Error('Appointment must have confirmedStart before syncing to Outlook');
  }
  const body = {
    subject: `${appointment.slug || 'Website'}: ${appointment.customerName || 'Appointment'}`,
    body: {
      contentType: 'HTML',
      content: appointment.notes || appointment.service || 'Website appointment',
    },
    start: {
      dateTime: appointment.confirmedStart,
      timeZone: appointment.timezone || 'UTC',
    },
    end: {
      dateTime:
        appointment.confirmedEnd ||
        new Date(
          new Date(appointment.confirmedStart).getTime() +
            (appointment.durationMinutes || 60) * 60000
        ).toISOString(),
      timeZone: appointment.timezone || 'UTC',
    },
    attendees: appointment.customerEmail
      ? [
          {
            emailAddress: {
              address: appointment.customerEmail,
              name: appointment.customerName,
            },
            type: 'required',
          },
        ]
      : [],
  };
  const method = calendarEventId ? 'PATCH' : 'POST';
  const endpoint = calendarEventId
    ? `${EVENTS_URL}/${encodeURIComponent(calendarEventId)}`
    : EVENTS_URL;
  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`Outlook calendar sync failed: ${payload}`);
    error.statusCode = response.status;
    throw error;
  }
  const result = await response.json();
  return {
    eventId: result.id,
    webLink: result.webLink,
  };
};

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  ensureAccessToken,
  syncAppointment,
  fetchProfile,
};
