const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const AWS = require('aws-sdk');

const run = (cmd, args, cwd, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        HOME: '/tmp',
        npm_config_cache: '/tmp/.npm-cache',
        npm_config_tmp: '/tmp/.npm-tmp',
        ...opts.env,
      },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
  });

const findDistFolder = (projectDir) => {
  const candidates = ['dist', 'build'];
  for (const candidate of candidates) {
    const full = path.join(projectDir, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
  }
  return null;
};

const ensurePublicAssetsSynced = async (projectDir, distPath) => {
  const publicDir = path.join(projectDir, 'public');
  try {
    const stats = await fsp.stat(publicDir);
    if (!stats.isDirectory()) return;
  } catch {
    return;
  }
  await fsp.cp(publicDir, distPath, {
    recursive: true,
    force: true,
  });
};

const buildProject = async (projectDir, { skipInstall } = {}) => {
  if (!skipInstall) {
    await run('npm', ['install', '--include=dev'], projectDir, {
      env: {
        NODE_ENV: 'development',
        npm_config_production: 'false',
        NPM_CONFIG_PRODUCTION: 'false',
      },
    });
  }
  await run('npm', ['run', 'build'], projectDir);
  const distPath = findDistFolder(projectDir);
  if (!distPath) {
    throw new Error('No dist/build folder found after build.');
  }
  await ensurePublicAssetsSynced(projectDir, distPath);
  return distPath;
};

const listFilesRecursive = async (dir, baseDir = dir) => {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath, baseDir);
      }
      return [{ fullPath, relativePath: path.relative(baseDir, fullPath) }];
    })
  );
  return files.flat();
};

const getContentType = (filePath = '') => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
};

const uploadToS3 = async (distPath, { bucket, prefix }) => {
  if (!bucket) throw new Error('S3 bucket is required.');
  const s3 = new AWS.S3();
  const files = await listFilesRecursive(distPath, distPath);
  const targetPrefix = prefix ? prefix.replace(/\/$/, '') : '';

  for (const file of files) {
    const key = targetPrefix ? `${targetPrefix}/${file.relativePath}` : file.relativePath;
    const body = await fsp.readFile(file.fullPath);
    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: getContentType(file.relativePath),
      })
      .promise();
  }

  const target = targetPrefix ? `s3://${bucket}/${targetPrefix}` : `s3://${bucket}`;
  return target;
};

const buildAndUpload = async (
  projectDir,
  { bucket, prefix, profile, skipInstall } = {}
) => {
  const distPath = await buildProject(projectDir, { skipInstall });
  const target = await uploadToS3(distPath, { bucket, prefix, profile });
  return { distPath, target };
};

module.exports = { buildAndUpload, buildProject, uploadToS3 };
