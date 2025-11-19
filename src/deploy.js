const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const run = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
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

const uploadToS3 = async (distPath, { bucket, prefix, profile }) => {
  if (!bucket) throw new Error('S3 bucket is required.');
  const target = prefix ? `s3://${bucket}/${prefix}` : `s3://${bucket}`;
  const args = ['s3', 'sync', distPath, target];
  if (profile) {
    args.push('--profile', profile);
  }
  await run('aws', args, distPath);
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
