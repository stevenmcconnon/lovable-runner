#!/usr/bin/env node
const http = require('node:http');
const { runLaunch, loadDotEnvIfPresent } = require('./launch');

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
  if (req.method === 'POST' && req.url === '/launch') {
    try {
      const body = await parseBody(req);
      const result = await runLaunch({
        url: body.url,
        token: body.token,
        base: body.base,
        createPath: body.createPath,
        workspace: body.workspace,
        waitSeconds: body.wait,
        attempts: body.attempts,
        bucket: body.bucket,
        prefix: body.prefix,
        slug: body.slug,
        profile: body.profile,
        skipInstall: body.skipInstall,
        placeholderLimit: body.placeholderLimit,
      });
      send(res, 200, {
        projectId: result.projectId,
        outputDir: result.outputDir,
        distPath: result.distPath,
        target: result.target,
        url: result.publicUrl,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      send(res, 400, { error: error.message || 'Launch failed' });
    }
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Lovable runner API listening on http://localhost:${PORT}`);
});
