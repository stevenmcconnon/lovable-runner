const parseJsonBody = (event) => {
  if (!event) return {};
  if (typeof event.body === 'string') {
    if (!event.body.length) return {};
    try {
      return JSON.parse(event.body);
    } catch (error) {
      const err = new Error('Invalid JSON body');
      err.statusCode = 400;
      err.cause = error;
      throw err;
    }
  }
  if (typeof event.body === 'object' && event.body !== null) {
    return event.body;
  }
  return {};
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

module.exports = { parseJsonBody, json };
