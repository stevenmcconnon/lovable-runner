#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { LovableClient } = require('./client');
const { downloadProjectFiles } = require('./downloader');
const { buildAndUpload } = require('./deploy');
const { waitForProjectReady } = require('./project-readiness');
const { runLaunch } = require('./launch');

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
  try {
    const response = await client.createProjectFromUrl(url, {
      createPath: createPathFlag || process.env.LOVABLE_CREATE_PATH,
      workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
    });
    console.log('Create response:', response);
  } catch (error) {
    console.error(error.message);
    if (error.body) console.error('Response body:', error.body);
    throw error;
  }
};

const extractProjectId = (createResponse) => {
  if (!createResponse) return null;
  if (createResponse.id) return createResponse.id;
  if (createResponse.projectId) return createResponse.projectId;
  if (createResponse.project?.id) return createResponse.project.id;
  return null;
};

const normalizePlaceholderLimitInput = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num) || num <= 0) return null;
  return num;
};

const resolvePlaceholderLimit = (flagValue) => {
  const direct = normalizePlaceholderLimitInput(flagValue);
  if (direct !== undefined) return direct;
  const envValue = normalizePlaceholderLimitInput(process.env.LOVABLE_PLACEHOLDER_LIMIT);
  if (envValue !== undefined) return envValue;
  const legacyValue = normalizePlaceholderLimitInput(
    process.env.LOVABLE_PLACEHOLDER_ATTEMPTS
  );
  if (legacyValue !== undefined) return legacyValue;
  return undefined;
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
    'placeholder-limit': placeholderLimitFlag,
  } = flags;

  const waitMs = Number(wait) * 1000 || 5000;
  const maxAttempts = Number(attempts) || 10;
  const placeholderLimitValue = resolvePlaceholderLimit(placeholderLimitFlag);

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

  const projectData = await waitForProjectReady({
    client,
    projectId,
    attempts: maxAttempts,
    waitMs,
    placeholderAttemptsBeforeAccept: placeholderLimitValue,
    onRetry: ({ type, attempt, attempts: total, waitSeconds, error }) => {
      if (type === 'placeholder') {
        console.log(
          `Project content placeholder detected (attempt ${attempt}/${total}). Waiting ${waitSeconds}s...`
        );
      } else if (type === 'placeholder-limit') {
        console.log(
          `Placeholder limit reached after ${attempt} attempts. Proceeding with current source.`
        );
      } else {
        console.log(
          `Source not ready (attempt ${attempt}/${total}, status ${error?.status}). Retrying in ${waitSeconds}s...`
        );
      }
    },
  });
  console.log(`Project ${projectId} ready. Downloading files...`);

  const { outputDir, zipPath } = await downloadProjectFiles(client, projectId, {
    outputDir: out,
    zip: Boolean(zip),
    projectData,
  });
  console.log(`Files written to: ${outputDir}`);
  if (zipPath) console.log(`Zip created at: ${zipPath}`);

  return projectData;
};

const handleOneShot = async (flags) => {
  const {
    url,
    token,
    base,
    'create-path': createPathFlag,
    workspace,
    wait = '10',
    attempts = '60',
    bucket,
    prefix,
    slug,
    profile,
    'skip-install': skipInstall,
    'placeholder-limit': placeholderLimitFlag,
  } = flags;

  if (!url) throw new Error('Missing --url.');

  if (!bucket && !process.env.LOVABLE_DEPLOY_BUCKET) {
    throw new Error('Missing bucket. Set LOVABLE_DEPLOY_BUCKET or pass --bucket.');
  }

  const result = await runLaunch({
    url,
    token,
    base,
    createPath: createPathFlag,
    workspace,
    waitSeconds: wait,
    attempts,
    bucket,
    prefix,
    slug,
    profile,
    skipInstall,
    placeholderLimit: resolvePlaceholderLimit(placeholderLimitFlag),
  });

  console.log('--- One-shot complete ---');
  console.log(`Slug: ${result.slug}`);
  console.log(`Content JSON: ${result.contentUrl} (${result.contentKey})`);
  console.log(`Template JSON: ${result.templateUrl} (${result.templateKey})`);
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

const handleDeployS3 = async (flags) => {
  const {
    bucket,
    prefix,
    profile,
    'project-dir': projectDirFlag,
    'project-id': projectIdFlag,
    'skip-install': skipInstall,
  } = flags;

  if (!bucket) throw new Error('Missing --bucket for S3 deploy.');

  const projectDir =
    projectDirFlag ||
    (projectIdFlag
      ? path.join(process.cwd(), 'downloads', projectIdFlag)
      : null);

  if (!projectDir) {
    throw new Error('Provide --project-dir or --project-id (uses downloads/<id>).');
  }

  const resolvedPrefix = prefix || path.basename(projectDir);

  const { distPath, target } = await buildAndUpload(projectDir, {
    bucket,
    prefix: resolvedPrefix,
    profile,
    skipInstall: Boolean(skipInstall),
  });

  console.log(`Built from: ${projectDir}`);
  console.log(`Dist folder: ${distPath}`);
  console.log(`Uploaded to: ${target}`);
};

const showHelp = () => {
  console.log(`Usage:
  node src/cli.js <command> [options]

Commands:
  create --url <sourceUrl> [--token <idToken>] [--base <apiBase>] [--create-path <path>] [--workspace <id>]
  bootstrap --url <sourceUrl> [--out <dir>] [--zip] [--token <idToken>] [--base <apiBase>] [--create-path <path>] [--workspace <id>] [--wait <seconds>] [--attempts <n>] [--placeholder-limit <n>]
  launch --url <sourceUrl> [--token <idToken>] [--base <apiBase>] [--create-path <path>] [--workspace <id>] [--wait <seconds>] [--attempts <n>] [--placeholder-limit <n>] [--bucket <name>] [--prefix <base-prefix>] [--slug <slug>] [--profile <aws-profile>] [--skip-install]
  fetch  --project <projectId> [--out <dir>] [--zip] [--token <idToken>] [--base <apiBase>]
  publish --project <projectId> [--token <idToken>] [--base <apiBase>] [--publish-path <path>]
  deploy-s3 --bucket <name> [--project-dir <path> | --project-id <id>] [--prefix <path>] [--profile <aws-profile>] [--skip-install]

Environment:
  LOVABLE_ID_TOKEN       bearer token (from lovable.dev session)
  LOVABLE_API_BASE       defaults to https://api.lovable.dev
  LOVABLE_WORKSPACE_ID   workspace id used for create path templating
  LOVABLE_CREATE_PATH    defaults to /workspaces/{workspaceId}/projects
  LOVABLE_PUBLISH_PATH   defaults to /projects/{id}/publish
  LOVABLE_DEPLOY_BUCKET  default S3 bucket for launch/deploy-s3
  LOVABLE_DEPLOY_PREFIX  optional base prefix; slug is appended (e.g., "lovable")
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
    } else if (command === 'launch') {
      await handleOneShot(flags);
    } else if (command === 'fetch') {
      await handleFetch(flags);
    } else if (command === 'publish') {
      await handlePublish(flags);
    } else if (command === 'deploy-s3') {
      await handleDeployS3(flags);
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
