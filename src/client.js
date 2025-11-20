const path = require('node:path');
const crypto = require('node:crypto');

const randomId = (prefix) => {
  const suffix = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36);
  return `${prefix}_${suffix}`;
};

const buildPromptFromUrl = (sourceUrl) => {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.replace(/^www\./i, '');
    const root = host.split('.').slice(0, -1).join(' ');
    const businessName = root ? root.replace(/[-_]/g, ' ').replace(/\s+/g, ' ') : host;
    return `Rebuild the website for ${businessName || host} using ${sourceUrl} as the reference. Produce a modern, responsive landing page with clear hero messaging, services, testimonials, and a strong call-to-action.`;
  } catch {
    return `Rebuild the referenced website at ${sourceUrl} with a modern responsive design, refreshed copy, and fast performance.`;
  }
};

const DEFAULT_API_BASE = process.env.LOVABLE_API_BASE || 'https://lovable-api.com';
const DEFAULT_CREATE_PATH =
  process.env.LOVABLE_CREATE_PATH || '/workspaces/{workspaceId}/projects';
const DEFAULT_PUBLISH_PATH =
  process.env.LOVABLE_PUBLISH_PATH || '/projects/{id}/publish';
const DEFAULT_WORKSPACE_ID = process.env.LOVABLE_WORKSPACE_ID;

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
   * @param {string} [options.workspaceId]
   */
  constructor({ apiBase = DEFAULT_API_BASE, idToken, workspaceId } = {}) {
    if (!idToken) {
      throw new Error('LovableClient requires an idToken (bearer token).');
    }
    this.apiBase = apiBase;
    this.idToken = idToken;
    this.workspaceId = workspaceId || DEFAULT_WORKSPACE_ID;
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
  async createProjectFromUrl(sourceUrl, { createPath, workspaceId, prompt } = {}) {
    if (!sourceUrl) throw new Error('sourceUrl is required.');
    const endpointTemplate = createPath || DEFAULT_CREATE_PATH;
    const endpoint = replacePathVariables(endpointTemplate, {
      workspaceId: workspaceId || this.workspaceId || '',
    });
    const promptText = prompt || buildPromptFromUrl(sourceUrl);
    const initialMessage = {
      id: randomId('umsg'),
      message: `${promptText}\nReference: ${sourceUrl}`,
      files: [],
      optimisticImageUrls: [],
      chat_only: false,
      agent_mode_enabled: false,
      ai_message_id: randomId('aimsg'),
    };
    const payload = {
      description: promptText,
      visibility: 'private',
      initial_message: initialMessage,
    };
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
