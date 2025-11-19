const path = require('node:path');

const DEFAULT_API_BASE = process.env.LOVABLE_API_BASE || 'https://lovable-api.com';
const DEFAULT_CREATE_PATH = process.env.LOVABLE_CREATE_PATH || '/projects';
const DEFAULT_PUBLISH_PATH =
  process.env.LOVABLE_PUBLISH_PATH || '/projects/{id}/publish';

const joinUrl = (base, suffix) => {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return normalizedBase + normalizedSuffix;
};

const replacePathVariables = (template, variables = {}) =>
  template.replace(/{([a-zA-Z0-9_]+)}/g, (_, key) => variables[key] ?? '');

class LovableClient {
  /**
   * @param {Object} options
   * @param {string} options.apiBase
   * @param {string} options.idToken
   */
  constructor({ apiBase = DEFAULT_API_BASE, idToken } = {}) {
    if (!idToken) {
      throw new Error('LovableClient requires an idToken (bearer token).');
    }
    this.apiBase = apiBase;
    this.idToken = idToken;
  }

  async request(pathname, { method = 'GET', body, headers = {} } = {}) {
    const url = joinUrl(this.apiBase, pathname);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.idToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(
        `Request failed (${response.status} ${response.statusText}) for ${url}`
      );
      error.status = response.status;
      error.body = text;
      throw error;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /**
   * Kick off a Lovable project generation from a source URL.
   * @param {string} sourceUrl
   * @param {Object} options
   * @param {string} [options.createPath]
   */
  async createProjectFromUrl(sourceUrl, { createPath } = {}) {
    if (!sourceUrl) throw new Error('sourceUrl is required.');
    const endpoint = createPath || DEFAULT_CREATE_PATH;
    const payload = { url: sourceUrl };
    return this.request(endpoint, { method: 'POST', body: payload });
  }

  /**
   * Fetch source code metadata/files for a project.
   * @param {string} projectId
   */
  async fetchSourceCode(projectId) {
    if (!projectId) throw new Error('projectId is required.');
    const endpoint = path.posix.join('/projects', projectId, 'source-code');
    return this.request(endpoint, { method: 'GET' });
  }

  /**
   * Publish a project.
   * @param {string} projectId
   * @param {Object} [payload] optional body if API requires it
   * @param {Object} [options]
   * @param {string} [options.publishPath] path template with `{id}` placeholder
   */
  async publishProject(projectId, payload = {}, { publishPath } = {}) {
    if (!projectId) throw new Error('projectId is required.');
    const template = publishPath || DEFAULT_PUBLISH_PATH;
    const endpoint = replacePathVariables(template, { id: projectId });
    return this.request(endpoint, { method: 'POST', body: payload });
  }
}

module.exports = { LovableClient, joinUrl, replacePathVariables };
