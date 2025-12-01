#!/usr/bin/env node
const http = require('node:http');
const { runLaunch, loadDotEnvIfPresent } = require('./launch');
const { runUpdate, approveUpdate, listUpdates } = require('./update');


loadDotEnvIfPresent();

const PORT = process.env.PORT || 3000;

const send = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // Hard cap to avoid abuse: 1MB
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/launch') {
      const body = await parseBody(req);
      const result = await runLaunch({
        url: body.url,
        prefix: body.prefix,
        slug: body.slug,
        description: body.description,
        businessDetails: body.businessDetails || body.business,
      });
      send(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/update') {
      const body = await parseBody(req);
      const result = await runUpdate({
        projectId: body.projectId,
        url: body.url,
        instructions: body.instructions,
        token: body.token,
        base: body.base,
        createPath: body.createPath,
        workspace: body.workspace,
        waitSeconds: body.wait,
        attempts: body.attempts,
        bucket: body.bucket,
        prefix: body.prefix,
        profile: body.profile,
        skipInstall: body.skipInstall,
        placeholderLimit: body.placeholderLimit,
        requestedBy: body.requestedBy,
      });
      send(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/approve-update') {
      const body = await parseBody(req);
      const result = await approveUpdate({
        projectId: body.projectId,
        draftId: body.draftId,
        bucket: body.bucket,
        livePrefix: body.livePrefix || body.prefix,
        approvedBy: body.approvedBy,
      });
      send(res, 200, result);
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/updates')) {
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const projectId = urlObj.searchParams.get('projectId');
      const limitParam = urlObj.searchParams.get('limit');
      const drafts = await listUpdates({
        projectId,
        limit: limitParam ? Number(limitParam) : undefined,
      });
      send(res, 200, { items: drafts });
      return;
    }

    send(res, 404, { error: 'Not found' });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    send(res, error.statusCode || 500, { error: error.message || 'Request failed' });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Lovable runner API listening on http://localhost:${PORT}`);
});
