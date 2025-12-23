const { PutCommand, UpdateCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamoDocumentClient } = require('./aws-clients');
const { randomUUID } = require('crypto');

const TABLE_NAME =
  process.env.SITE_APPOINTMENTS_TABLE ||
  process.env.APPOINTMENTS_TABLE_NAME ||
  process.env.LOVABLE_APPOINTMENTS_TABLE;
const SETTINGS_TABLE =
  process.env.APPOINTMENT_SETTINGS_TABLE ||
  process.env.SITE_APPOINTMENT_SETTINGS_TABLE ||
  process.env.LOVABLE_APPOINTMENT_SETTINGS_TABLE;

const getClient = () => dynamoDocumentClient;

const ensureTable = (name, message) => {
  if (!name) {
    const error = new Error(message);
    error.statusCode = 500;
    throw error;
  }
  return name;
};

const patchAppointmentSettings = async ({ slug, updates }) => {
  ensureTable(
    SETTINGS_TABLE,
    'APPOINTMENT_SETTINGS_TABLE environment variable is not set.'
  );
  const docClient = getClient();
  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':updatedAt': new Date().toISOString() };
  const expressions = ['#updatedAt = :updatedAt'];
  Object.entries(updates || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    const nameKey = `#${key}`;
    const valueKey = `:${key}`;
    names[nameKey] = key;
    values[valueKey] = value;
    expressions.push(`${nameKey} = ${valueKey}`);
  });
  const result = await docClient.send(
    new UpdateCommand({
      TableName: SETTINGS_TABLE,
      Key: { slug },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );
  return result.Attributes;
};

const determineDefaultDuration = (service) => {
  if (!service) return 60;
  const normalized = String(service).toLowerCase();
  if (normalized.includes('consult')) return 30;
  if (normalized.includes('mini') || normalized.includes('check-in')) return 20;
  if (normalized.includes('deluxe') || normalized.includes('remodel')) return 90;
  return 60;
};

const createAppointment = async ({
  slug,
  submittedBy,
  sectionId,
  fields,
  sourceUrl,
  accountId,
}) => {
  ensureTable(TABLE_NAME, 'SITE_APPOINTMENTS_TABLE environment variable is not set.');
  const docClient = getClient();
  const timestamp = new Date().toISOString();
  const appointmentId = `${timestamp}#${randomUUID()}`;
  const record = {
    accountId: accountId || null,
    slug,
    appointmentId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'pending',
    sectionId: sectionId || null,
    customerName:
      fields?.find((field) => /name/i.test(field.label || ''))?.value || null,
    customerEmail:
      fields?.find((field) => /email/i.test(field.label || ''))?.value || null,
    customerPhone:
      fields?.find((field) => /phone|cell/i.test(field.label || ''))?.value || null,
    preferredDate:
      fields?.find((field) => /date/i.test(field.label || ''))?.value || null,
    preferredTime:
      fields?.find((field) => /time/i.test(field.label || ''))?.value || null,
    service:
      fields?.find((field) => /service|package/i.test(field.label || ''))?.value ||
      null,
    durationMinutes: determineDefaultDuration(
      fields?.find((field) => /service|package/i.test(field.label || ''))?.value
    ),
    notes:
      fields?.find((field) => /notes|details/i.test(field.label || ''))?.value ||
      null,
    submittedBy: submittedBy || null,
    sourceUrl: sourceUrl || null,
    fields: fields || [],
  };
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );
  return record;
};

const listAppointments = async ({ slug, limit = 50, status, cursor, accountId }) => {
  ensureTable(TABLE_NAME, 'SITE_APPOINTMENTS_TABLE environment variable is not set.');
  const docClient = getClient();
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: '#slug = :slug',
    ExpressionAttributeNames: { '#slug': 'slug' },
    ExpressionAttributeValues: { ':slug': slug },
    ScanIndexForward: false,
    Limit: limit,
  };
  if (status) {
    params.FilterExpression = '#status = :status';
    params.ExpressionAttributeNames['#status'] = 'status';
    params.ExpressionAttributeValues[':status'] = status;
  }
  if (accountId) {
    const accountFilter = '(#accountId = :accountId OR attribute_not_exists(#accountId))';
    params.FilterExpression = params.FilterExpression
      ? `${params.FilterExpression} AND ${accountFilter}`
      : accountFilter;
    params.ExpressionAttributeNames['#accountId'] = 'accountId';
    params.ExpressionAttributeValues[':accountId'] = accountId;
  }
  if (cursor) {
    params.ExclusiveStartKey = cursor;
  }
  const result = await docClient.send(new QueryCommand(params));
  return {
    items: result.Items || [],
    nextCursor: result.LastEvaluatedKey || null,
  };
};

const updateAppointmentStatus = async ({
  slug,
  appointmentId,
  status,
  confirmedStart,
  confirmedEnd,
  metadata,
  accountId,
}) => {
  ensureTable(TABLE_NAME, 'SITE_APPOINTMENTS_TABLE environment variable is not set.');
  const docClient = getClient();
  const expressions = ['#updatedAt = :now'];
  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':now': new Date().toISOString() };
  if (status) {
    expressions.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = status;
  }
  if (confirmedStart) {
    expressions.push('#confirmedStart = :confirmedStart');
    names['#confirmedStart'] = 'confirmedStart';
    values[':confirmedStart'] = confirmedStart;
  }
  if (confirmedEnd) {
    expressions.push('#confirmedEnd = :confirmedEnd');
    names['#confirmedEnd'] = 'confirmedEnd';
    values[':confirmedEnd'] = confirmedEnd;
  }
  if (metadata) {
    expressions.push('#metadata = :metadata');
    names['#metadata'] = 'metadata';
    values[':metadata'] = metadata;
  }
  if (accountId) {
    expressions.push('#accountId = if_not_exists(#accountId, :accountId)');
    names['#accountId'] = 'accountId';
    values[':accountId'] = accountId;
  }
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { slug, appointmentId },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
  return { slug, appointmentId, status, confirmedStart, confirmedEnd };
};

const saveAppointmentSettings = (params = {}) => {
  const { slug, ...rest } = params;
  if (!slug) {
    throw new Error('slug is required to save appointment settings');
  }
  const updates = {};
  if (rest.availability !== undefined) {
    updates.availability = rest.availability || null;
  }
  if (rest.timezone !== undefined) {
    updates.timezone = rest.timezone || 'UTC';
  }
  if (rest.calendarProvider !== undefined) {
    updates.calendarProvider = rest.calendarProvider || null;
  }
  if (rest.calendarAccountEmail !== undefined) {
    updates.calendarAccountEmail = rest.calendarAccountEmail || null;
  }
  if (rest.calendarIcsToken !== undefined) {
    updates.calendarIcsToken = rest.calendarIcsToken || null;
  }
  if (rest.oauthState !== undefined) {
    updates.oauthState = rest.oauthState;
  }
  if (rest.oauthStateExpiresAt !== undefined) {
    updates.oauthStateExpiresAt = rest.oauthStateExpiresAt;
  }
  if (rest.oauthStateProvider !== undefined) {
    updates.oauthStateProvider = rest.oauthStateProvider;
  }
  if (rest.accountId !== undefined) {
    updates.accountId = rest.accountId || null;
  }
  if (!Object.keys(updates).length) {
    return getAppointmentSettings({ slug, accountId: rest.accountId });
  }
  return patchAppointmentSettings({ slug, updates, accountId: rest.accountId });
};

const getAppointmentSettings = async ({ slug, accountId }) => {
  ensureTable(
    SETTINGS_TABLE,
    'APPOINTMENT_SETTINGS_TABLE environment variable is not set.'
  );
  const docClient = getClient();
  const result = await docClient.send(
    new GetCommand({
      TableName: SETTINGS_TABLE,
      Key: { slug },
    })
  );
  if (result.Item) {
    if (accountId && result.Item.accountId && result.Item.accountId !== accountId) {
      return null;
    }
    return result.Item;
  }
  return {
    slug,
    accountId: accountId || null,
    availability: null,
    timezone: 'UTC',
    calendarProvider: null,
    calendarToken: null,
    calendarRefreshToken: null,
    calendarExpiresAt: null,
    calendarAccountEmail: null,
    calendarIcsToken: null,
    oauthState: null,
    oauthStateExpiresAt: null,
    oauthStateProvider: null,
  };
};

const setOAuthState = async ({ slug, provider, state, expiresAt }) =>
  patchAppointmentSettings({
    slug,
    updates: {
      oauthState: state,
      oauthStateProvider: provider,
      oauthStateExpiresAt: expiresAt,
    },
  });

const clearOAuthState = async ({ slug }) =>
  patchAppointmentSettings({
    slug,
    updates: {
      oauthState: null,
      oauthStateProvider: null,
      oauthStateExpiresAt: null,
    },
  });

const getAppointment = async ({ slug, appointmentId, accountId }) => {
  ensureTable(TABLE_NAME, 'SITE_APPOINTMENTS_TABLE environment variable is not set.');
  const docClient = getClient();
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { slug, appointmentId },
    })
  );
  const item = result.Item || null;
  if (!item) return null;
  if (accountId && item.accountId && item.accountId !== accountId) return null;
  return item;
};

const setAppointmentCalendarEvent = async ({
  slug,
  appointmentId,
  provider,
  eventId,
  eventLink,
}) => {
  ensureTable(TABLE_NAME, 'SITE_APPOINTMENTS_TABLE environment variable is not set.');
  const docClient = getClient();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { slug, appointmentId },
      UpdateExpression:
        'SET #calendarEventId = :eventId, #calendarEventLink = :eventLink, #calendarEventProvider = :provider, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#calendarEventId': 'calendarEventId',
        '#calendarEventLink': 'calendarEventLink',
        '#calendarEventProvider': 'calendarEventProvider',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':eventId': eventId || null,
        ':eventLink': eventLink || null,
        ':provider': provider || null,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );
};

const buildICS = ({ slug, appointments = [], siteName }) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI SiteMaker//Appointments//EN',
  ];
  appointments.forEach((appointment) => {
    const uid = `${appointment.appointmentId}@${slug}`;
    const dtStart = appointment.confirmedStart || appointment.preferredDate;
    if (!dtStart) return;
    const dtStamp = appointment.createdAt || new Date().toISOString();
    const dtEnd =
      appointment.confirmedEnd ||
      appointment.preferredTime ||
      new Date(
        new Date(dtStart).getTime() + appointment.durationMinutes * 60000
      ).toISOString();
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtStamp.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
    lines.push(`DTSTART:${dtStart.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
    lines.push(`DTEND:${dtEnd.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
    lines.push(
      `SUMMARY:${siteName || 'Appointment'} - ${appointment.customerName || 'Client'}`
    );
    lines.push(
      `DESCRIPTION:${appointment.service || 'Consultation'}\\n${appointment.notes || ''}`
    );
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
};

module.exports = {
  createAppointment,
  listAppointments,
  getAppointment,
  updateAppointmentStatus,
  saveAppointmentSettings,
  getAppointmentSettings,
  patchAppointmentSettings,
  setOAuthState,
  clearOAuthState,
  setAppointmentCalendarEvent,
  buildICS,
};
