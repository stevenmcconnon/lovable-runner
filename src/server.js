#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { runLaunch, loadDotEnvIfPresent } = require('./launch');
const { runUpdate, approveUpdate, listUpdates } = require('./update');
const { updateSite } = require('./site-edit');
const { loadSiteConfig, listSitesForUser } = require('./site-store');
const { generateSitePatchWithOpenAI } = require('./openai');
const { createSiteAssetUpload, listSiteAssets } = require('./asset-store');
const { listDomainsForUser, getDomainRecord, setPrimaryDomain } = require('./domain-store');

loadDotEnvIfPresent();

const PORT = process.env.PORT || 3000;
const OPENAPI_SPEC_PATH = path.join(__dirname, '..', 'openapi', 'openapi.json');
let openApiDocument = null;

try {
  if (fs.existsSync(OPENAPI_SPEC_PATH)) {
    const raw = fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8');
    openApiDocument = JSON.parse(raw);
  }
} catch (error) {
  console.warn('[server] Failed to load OpenAPI document', error.message);
}

const send = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
};

const sendHtml = (res, status, html) => {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.end(html);
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

const buildUserFromHeaders = (headers = {}) => ({
  email: headers['x-user-email'] || null,
  sub: headers['x-user-id'] || headers['x-user-sub'] || null,
  accountId: headers['x-account-id'] || null,
  groups: headers['x-user-groups']
    ? String(headers['x-user-groups'])
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [],
});

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const { pathname } = urlObj;
    const limitParam = urlObj.searchParams.get('limit');

    if (req.method === 'GET' && pathname === '/domains') {
      const user = buildUserFromHeaders(req.headers);
      const items = await listDomainsForUser({ user });
      send(res, 200, { items });
      return;
    }

    const domainDetailMatch = pathname.match(/^\/domains\/([^/]+)$/);
    if (req.method === 'GET' && domainDetailMatch) {
      const user = buildUserFromHeaders(req.headers);
      const domainName = decodeURIComponent(domainDetailMatch[1]);
      const record = await getDomainRecord({ user, domain: domainName });
      if (!record) {
        send(res, 404, { error: 'Domain not found' });
        return;
      }
      send(res, 200, { domain: record, dns: record.dnsSettings || null });
      return;
    }

    const setPrimaryMatch = pathname.match(/^\/sites\/([^/]+)\/domains\/([^/]+)\/primary$/);
    if (req.method === 'POST' && setPrimaryMatch) {
      const slug = decodeURIComponent(setPrimaryMatch[1]);
      const domainName = decodeURIComponent(setPrimaryMatch[2]);
      const user = buildUserFromHeaders(req.headers);
      const updated = await setPrimaryDomain({ slug, domain: domainName, user });
      send(res, 200, { domain: updated, dns: updated.dnsSettings || null });
      return;
    }

    if (req.method === 'GET' && pathname === '/sites') {
      const user = buildUserFromHeaders(req.headers);
      const items = await listSitesForUser({
        user,
        limit: limitParam ? Number(limitParam) : undefined,
      });
      send(res, 200, { items });
      return;
    }

    if (req.method === 'GET' && pathname === '/openapi.json') {
      if (!openApiDocument) {
        send(res, 404, { error: 'OpenAPI document not available' });
        return;
      }
      send(res, 200, openApiDocument);
      return;
    }

    if (req.method === 'GET' && pathname === '/docs') {
      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AI SiteMaker API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #redoc-container { height: 100%; }
  </style>
</head>
<body>
  <redoc spec-url="/openapi.json"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;
      sendHtml(res, 200, html);
      return;
    }

    if (req.method === 'POST' && pathname === '/launch') {
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

    if (req.method === 'POST' && pathname === '/update') {
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

    if (req.method === 'POST' && pathname === '/approve-update') {
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

    if (req.method === 'GET' && pathname.startsWith('/updates')) {
      const projectId = urlObj.searchParams.get('projectId');
      const drafts = await listUpdates({
        projectId,
        limit: limitParam ? Number(limitParam) : undefined,
      });
      send(res, 200, { items: drafts });
      return;
    }

    const assetMatch = pathname.match(/^\/sites\/([^/]+)\/assets$/);
    if (assetMatch) {
      const slug = decodeURIComponent(assetMatch[1]);
      if (req.method === 'GET') {
        const assets = await listSiteAssets({ slug });
        send(res, 200, assets);
        return;
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const upload = await createSiteAssetUpload({
          slug,
          filename: body.filename,
          contentType: body.contentType,
          expiresIn: body.expiresIn,
        });
        send(res, 200, upload);
        return;
      }
    }

    const instructionMatch = pathname.match(/^\/sites\/([^/]+)\/instructions$/);
    if (instructionMatch && req.method === 'POST') {
      const slug = decodeURIComponent(instructionMatch[1]);
      const body = await parseBody(req);
      if (!body.instructions || !body.instructions.trim()) {
        send(res, 400, { error: 'instructions are required' });
        return;
      }
      const record = await loadSiteConfig(slug);
      if (!record?.site) {
        send(res, 404, { error: 'Site not found' });
        return;
      }
      let assetContext = [];
      if (Array.isArray(body.assets)) {
        assetContext = body.assets.filter((item) => item && (item.url || item.assetUrl));
      }
      try {
        const listed = await listSiteAssets({ slug, limit: 50 });
        const derived = listed.items.map((item) => ({
          name: item.key.split('/').pop(),
          url: item.url,
          description: `${Math.round((item.size || 0) / 1024)} KB`,
        }));
        assetContext = [...derived, ...assetContext];
      } catch (error) {
        console.warn('[server] Failed to list assets for instructions', error.message);
      }
      const patchResult = await generateSitePatchWithOpenAI({
        site: record.site,
        instructions: body.instructions,
        assets: assetContext,
      });
      const result = await updateSite({
        slug,
        patch: patchResult.patch,
        regenerateImages: body.regenerateImages,
        requestId: body.requestId,
        description: body.description || patchResult.summary,
        sourceUrl: body.sourceUrl,
      });
      send(res, 200, { ...result, patchSummary: patchResult.summary, assetContextCount: assetContext.length });
      return;
    }

    const siteMatch = pathname.match(/^\/sites\/([^/]+)$/);
    if (siteMatch) {
      const slug = decodeURIComponent(siteMatch[1]);
      if (req.method === 'GET') {
        const record = await loadSiteConfig(slug);
        if (!record) {
          send(res, 404, { error: 'Site not found' });
          return;
        }
        send(res, 200, record);
        return;
      }
      if (req.method === 'PATCH') {
        const body = await parseBody(req);
        const result = await updateSite({
          slug,
          patch: body.patch,
          site: body.site,
          regenerateImages: body.regenerateImages,
          requestId: body.requestId,
          description: body.description,
          sourceUrl: body.sourceUrl,
        });
        send(res, 200, result);
        return;
      }
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
  console.log(`AI SiteMaker runner API listening on http://localhost:${PORT}`);
});
