#!/usr/bin/env node
const path = require('node:path');
const { LovableClient } = require('./client');
const { downloadProjectFiles } = require('./downloader');

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
  const [, , command, ...rest] = process.argv;
  const flags = parseArgs(rest);

  try {
    if (!command || command === 'help' || flags.help) {
      showHelp();
      return;
    }

    if (command === 'create') {
      await handleCreate(flags);
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
