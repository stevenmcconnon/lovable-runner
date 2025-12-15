const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const CLIENT_ID =
  process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET =
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
  process.env.GOOGLE_OAUTH_REDIRECT_URI ||
  'https://api.ai-sitemaker.com/oauth/google/calendar/callback';

const buildAuthUrl = ({ slug, state }) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    state: JSON.stringify({ slug, token: state }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

const exchangeCodeForTokens = async ({ code }) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`Google token exchange failed: ${payload}`);
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
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`Google token refresh failed: ${payload}`);
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
    throw new Error('No refresh token available for Google calendar sync');
  }
  const result = await refreshAccessToken({ refreshToken });
  return {
    accessToken: result.access_token,
    expiresAt: result.expires_in ? now + result.expires_in * 1000 : null,
    refreshToken: result.refresh_token || refreshToken,
  };
};

const decodeIdToken = (idToken) => {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    console.warn('[calendar/google] failed to decode id_token', error.message);
    return null;
  }
};

const syncAppointment = async ({
  appointment,
  accessToken,
  slug,
  calendarEventId,
}) => {
  if (!appointment.confirmedStart) {
    throw new Error('Appointment must have confirmedStart before syncing to Google');
  }
  const body = {
    summary: `${slug}: ${appointment.customerName || 'New appointment'}`,
    description: appointment.notes || appointment.service || 'Website appointment',
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
      ? [{ email: appointment.customerEmail, displayName: appointment.customerName }]
      : undefined,
    reminders: {
      useDefault: true,
    },
  };

  const method = calendarEventId ? 'PATCH' : 'POST';
  const endpoint = calendarEventId
    ? `${GOOGLE_CALENDAR_URL}/${encodeURIComponent(calendarEventId)}`
    : GOOGLE_CALENDAR_URL;
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
    const error = new Error(`Google calendar sync failed: ${payload}`);
    error.statusCode = response.status;
    throw error;
  }
  const result = await response.json();
  return {
    eventId: result.id,
    htmlLink: result.htmlLink,
  };
};

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  ensureAccessToken,
  syncAppointment,
  decodeIdToken,
};
