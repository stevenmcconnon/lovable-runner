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

const buildClient = (tokenOverride) => {
  const idToken = tokenOverride || process.env.LOVABLE_ID_TOKEN;
  if (!idToken) {
    throw new Error('idToken is required. Set LOVABLE_ID_TOKEN or pass --token.');
  }
  return new LovableClient({ idToken });
};

const handleCreate = async (flags) => {
  const { url, token } = flags;
  if (!url) throw new Error('Missing --url for create.');
  const client = buildClient(token);
  const response = await client.createProjectFromUrl(url, {
    createPath: process.env.LOVABLE_CREATE_PATH,
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
      const retryable = error?.status === 404 || error?.status === 400;
      if (!retryable || i === attempts) throw error;
      await sleep(waitMs);
    }
  }
  throw lastError;
};

const handleBootstrap = async (flags) => {
  const {
    url = 'https://example.com',
    token,
    out,
    zip,
    wait = '5',
    attempts = '10',
  } = flags;

  const waitMs = Number(wait) * 1000 || 5000;
  const maxAttempts = Number(attempts) || 10;

  const client = buildClient(token);
  const createResponse = await client.createProjectFromUrl(url, {
    createPath: process.env.LOVABLE_CREATE_PATH,
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
  const { project, out, zip, token } = flags;
  if (!project) throw new Error('Missing --project for fetch.');
  const client = buildClient(token);
  const { outputDir, zipPath } = await downloadProjectFiles(client, project, {
    outputDir: out,
    zip: Boolean(zip),
  });
  console.log(`Files written to: ${outputDir}`);
  if (zipPath) console.log(`Zip created at: ${zipPath}`);
};

const handlePublish = async (flags) => {
  const { project, token } = flags;
  if (!project) throw new Error('Missing --project for publish.');
  const client = buildClient(token);
  const response = await client.publishProject(project, {}, {
    publishPath: process.env.LOVABLE_PUBLISH_PATH,
  });
  console.log('Publish response:', response);
};

const showHelp = () => {
  console.log(`Usage:
  node src/cli.js <command> [options]

Commands:
  create --url <sourceUrl> [--token <idToken>]
  bootstrap --url <sourceUrl> [--out <dir>] [--zip] [--token <idToken>] [--wait <seconds>] [--attempts <n>]
  fetch  --project <projectId> [--out <dir>] [--zip] [--token <idToken>]
  publish --project <projectId> [--token <idToken>]

Environment:
  LOVABLE_ID_TOKEN       bearer token (from lovable.dev session)
  LOVABLE_API_BASE       defaults to https://lovable-api.com
  LOVABLE_CREATE_PATH    defaults to /projects
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
