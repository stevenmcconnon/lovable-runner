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

    // Fallback: treat any legacy invocation as a JSON-only launch (no build path).
    const parsedBody = parseJsonBody(event);
    const body =
      parsedBody && Object.keys(parsedBody).length
        ? parsedBody
        : typeof event === 'object' && event !== null
        ? event
        : {};

    const legacyEvent = {
      action: 'RUN_SITE_LAUNCH',
      requestId: body.requestId || body.id || randomUUID(),
      url: body.url,
      description: body.description,
      businessDetails: body.businessDetails || body.business || null,
      prefix: body.prefix || process.env.LOVABLE_DEPLOY_PREFIX,
      slug: body.slug,
    };
    const result = await handleSiteLaunchJob(legacyEvent);
    return json(200, result);
  } catch (error) {
    if (isApiGatewayEvent(event)) {
      return json(error.statusCode || 400, { error: error.message || 'Launch failed' });
    }
    throw error;
  }
};
