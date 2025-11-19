#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { LovableClient } = require('./client');
const { downloadProjectFiles } = require('./downloader');

const loadDotEnvIfPresent = () => {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    });
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.replace(/^--/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildClient = (tokenOverride, apiBaseOverride, workspaceIdOverride) => {
  const idToken = tokenOverride || process.env.LOVABLE_ID_TOKEN;
  if (!idToken) {
    throw new Error('idToken is required. Set LOVABLE_ID_TOKEN or pass --token.');
  }
  return new LovableClient({
    idToken,
    apiBase: apiBaseOverride || process.env.LOVABLE_API_BASE,
    workspaceId: workspaceIdOverride || process.env.LOVABLE_WORKSPACE_ID,
  });
};

const handleCreate = async (flags) => {
  const { url, token, base, 'create-path': createPathFlag, workspace } = flags;
  if (!url) throw new Error('Missing --url for create.');
  const client = buildClient(token, base, workspace);
  const response = await client.createProjectFromUrl(url, {
    createPath: createPathFlag || process.env.LOVABLE_CREATE_PATH,
    workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
  });
  console.log('Create response:', response);
};

const extractProjectId = (createResponse) => {
  if (!createResponse) return null;
  if (createResponse.id) return createResponse.id;
  if (createResponse.projectId) return createResponse.projectId;
  if (createResponse.project?.id) return createResponse.project.id;
  return null;
};

const fetchWithRetry = async (client, projectId, attempts, waitMs) => {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await client.fetchSourceCode(projectId);
    } catch (error) {
      lastError = error;
      const retryable =
        error?.status === 404 ||
        error?.status === 400 ||
        error?.status === 500;
      if (!retryable || i === attempts) throw error;
      console.log(
        `Source not ready (attempt ${i}/${attempts}, status ${error?.status}). Retrying in ${
          waitMs / 1000
        }s...`
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
};

const handleBootstrap = async (flags) => {
  const {
    url = 'https://example.com',
    token,
    base,
    'create-path': createPathFlag,
    workspace,
    out,
    zip,
    wait = '5',
    attempts = '10',
  } = flags;

  const waitMs = Number(wait) * 1000 || 5000;
  const maxAttempts = Number(attempts) || 10;

  const client = buildClient(token, base, workspace);
  const createResponse = await client.createProjectFromUrl(url, {
    createPath: createPathFlag || process.env.LOVABLE_CREATE_PATH,
    workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
  });
  const projectId = extractProjectId(createResponse);

  if (!projectId) {
    throw new Error(
      'Could not determine project id from create response. See output above.'
    );
  }

  console.log(`Created project ${projectId}. Waiting for generation...`);

  const projectData = await fetchWithRetry(
    client,
    projectId,
    maxAttempts,
    waitMs
  );
  console.log(`Project ${projectId} ready. Downloading files...`);

  const { outputDir, zipPath } = await downloadProjectFiles(client, projectId, {
    outputDir: out,
    zip: Boolean(zip),
  });
  console.log(`Files written to: ${outputDir}`);
  if (zipPath) console.log(`Zip created at: ${zipPath}`);

  return projectData;
};

const handleFetch = async (flags) => {
  const { project, out, zip, token, base } = flags;
  if (!project) throw new Error('Missing --project for fetch.');
  const client = buildClient(token, base);
  const { outputDir, zipPath } = await downloadProjectFiles(client, project, {
    outputDir: out,
    zip: Boolean(zip),
  });
  console.log(`Files written to: ${outputDir}`);
  if (zipPath) console.log(`Zip created at: ${zipPath}`);
};

const handlePublish = async (flags) => {
  const { project, token, base, 'publish-path': publishPathFlag } = flags;
  if (!project) throw new Error('Missing --project for publish.');
  const client = buildClient(token, base);
  const response = await client.publishProject(project, {}, {
    publishPath: publishPathFlag || process.env.LOVABLE_PUBLISH_PATH,
  });
  console.log('Publish response:', response);
};

const showHelp = () => {
  console.log(`Usage:
  node src/cli.js <command> [options]

Commands:
  create --url <sourceUrl> [--token <idToken>] [--base <apiBase>] [--create-path <path>] [--workspace <id>]
  bootstrap --url <sourceUrl> [--out <dir>] [--zip] [--token <idToken>] [--base <apiBase>] [--create-path <path>] [--workspace <id>] [--wait <seconds>] [--attempts <n>]
  fetch  --project <projectId> [--out <dir>] [--zip] [--token <idToken>] [--base <apiBase>]
  publish --project <projectId> [--token <idToken>] [--base <apiBase>] [--publish-path <path>]

Environment:
  LOVABLE_ID_TOKEN       bearer token (from lovable.dev session)
  LOVABLE_API_BASE       defaults to https://api.lovable.dev
  LOVABLE_WORKSPACE_ID   workspace id used for create path templating
  LOVABLE_CREATE_PATH    defaults to /workspaces/{workspaceId}/projects
  LOVABLE_PUBLISH_PATH   defaults to /projects/{id}/publish
`);
};

const main = async () => {
  loadDotEnvIfPresent();
  const [, , command, ...rest] = process.argv;
  const flags = parseArgs(rest);

  try {
    if (!command || command === 'help' || flags.help) {
      showHelp();
      return;
    }

    if (command === 'create') {
      await handleCreate(flags);
    } else if (command === 'bootstrap') {
      await handleBootstrap(flags);
    } else if (command === 'fetch') {
      await handleFetch(flags);
    } else if (command === 'publish') {
      await handlePublish(flags);
    } else {
      showHelp();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    if (error.body) console.error('Response body:', error.body);
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}
