const { randomUUID } = require('node:crypto');
const { handleEditRequestJob, handleSiteLaunchJob } = require('./src/jobs');
const { parseJsonBody, json } = require('./src/http');
const { handleHttpEvent, isApiGatewayEvent } = require('./src/api');

exports.handler = async (event) => {
  try {
    // eslint-disable-next-line no-console
    console.log('Lambda event received', {
      isApi: Boolean(isApiGatewayEvent(event)),
      action: event?.action,
      keys: event && typeof event === 'object' ? Object.keys(event) : typeof event,
    });
    if (isApiGatewayEvent(event)) {
      return await handleHttpEvent(event);
    }
    if (event?.action === 'RUN_EDIT_REQUEST') {
      const result = await handleEditRequestJob(event);
      return json(200, result);
    }
    if (event?.action === 'RUN_SITE_LAUNCH') {
      const result = await handleSiteLaunchJob(event);
      return json(200, result);
    }

    // No other actions supported; reject to avoid legacy build path.
    return json(400, { error: 'Unsupported action. Use RUN_SITE_LAUNCH or RUN_EDIT_REQUEST.' });
  } catch (error) {
    if (isApiGatewayEvent(event)) {
      return json(error.statusCode || 400, { error: error.message || 'Launch failed' });
    }
    throw error;
  }
};
