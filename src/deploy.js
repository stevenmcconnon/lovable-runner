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

const buildProject = async (projectDir, { skipInstall } = {}) => {
  if (!skipInstall) {
    await run('npm', ['install'], projectDir);
  }
  await run('npm', ['run', 'build'], projectDir);
  const distPath = findDistFolder(projectDir);
  if (!distPath) {
    throw new Error('No dist/build folder found after build.');
  }
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
