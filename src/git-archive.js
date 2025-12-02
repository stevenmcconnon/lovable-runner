const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');

const GIT_REPO_URL =
  process.env.SITES_MONOREPO_URL || process.env.LOVABLE_SITES_MONOREPO || process.env.SITES_GIT_REPO;

const GIT_BRANCH = process.env.SITES_MONOREPO_BRANCH || 'main';
const GIT_ROOT_DIR = (process.env.SITES_MONOREPO_ROOT || 'sites').replace(/^\/+|\/+$/g, '') || '';
const GIT_USER_NAME = process.env.SITES_GIT_USER || 'Lovable Runner';
const GIT_USER_EMAIL = process.env.SITES_GIT_EMAIL || 'runner@ai-sitemaker.com';
const GIT_EXPORT_FLAG = process.env.SITES_EXPORT_ENABLED ?? process.env.SITES_ARCHIVE_ENABLED;
const isGitExportEnabled = () => {
  if (GIT_EXPORT_FLAG != null) {
    const normalized = String(GIT_EXPORT_FLAG).trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0';
  }
  return Boolean(GIT_REPO_URL);
};

const runGit = (args, { cwd } = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: stdout?.trim?.() || '', stderr: stderr?.trim?.() || '' });
    });
    child.stdin?.end();
  });

const shouldSkipPath = (relativePath) => {
  if (!relativePath) return false;
  const normalized = relativePath.split(path.sep);
  return normalized.some((segment) => segment === 'node_modules' || segment === '.git');
};

const copyProjectTree = async (sourceDir, targetDir) => {
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(targetDir), { recursive: true });
  await fsp.cp(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => !shouldSkipPath(path.relative(sourceDir, src)),
  });
};

const writeMetadataFile = async ({ targetDir, slug, requestId, sourceUrl, description }) => {
  const metadata = {
    slug,
    requestId,
    sourceUrl,
    description,
    exportedAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(targetDir, 'lovable.json'), JSON.stringify(metadata, null, 2), 'utf8');
};

const buildRelativeGitPath = (slug, requestLabel) => {
  const segments = [];
  if (GIT_ROOT_DIR) segments.push(GIT_ROOT_DIR);
  segments.push(slug, requestLabel);
  return segments.join('/');
};

const exportProjectToGit = async ({ projectDir, slug, requestId, sourceUrl, description }) => {
  if (!GIT_REPO_URL || !isGitExportEnabled()) {
    return null;
  }
  const workDir = path.join(os.tmpdir(), 'lovable-sites', randomUUID());
  const label = requestId || randomUUID();
  const relativeGitPath = buildRelativeGitPath(slug, label);
  const targetDir = path.join(workDir, ...relativeGitPath.split('/'));
  const commitMessage = `feat(site): ${slug} ${label}`;

  try {
    await runGit(['clone', '--single-branch', '--branch', GIT_BRANCH, GIT_REPO_URL, workDir]);
  } catch (error) {
    console.warn('[git-archive] Failed to clone repository', {
      repo: GIT_REPO_URL,
      branch: GIT_BRANCH,
      err: error.stderr || error.message,
    });
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  try {
    await runGit(['config', 'user.name', GIT_USER_NAME], { cwd: workDir });
    await runGit(['config', 'user.email', GIT_USER_EMAIL], { cwd: workDir });
    await copyProjectTree(projectDir, targetDir);
    await writeMetadataFile({ targetDir, slug, requestId: label, sourceUrl, description });
    await runGit(['add', relativeGitPath], { cwd: workDir });

    let committed = false;
    try {
      await runGit(['commit', '-m', commitMessage], { cwd: workDir });
      committed = true;
    } catch (error) {
      if (error.stderr?.includes('nothing to commit')) {
        console.log('[git-archive] No changes to commit for', relativeGitPath);
      } else {
        throw error;
      }
    }

    if (committed) {
      await runGit(['push', 'origin', GIT_BRANCH], { cwd: workDir });
      const { stdout: commitSha } = await runGit(['rev-parse', 'HEAD'], { cwd: workDir });
      return {
        repoUrl: GIT_REPO_URL,
        branch: GIT_BRANCH,
        path: relativeGitPath,
        commit: commitSha,
        committed: true,
        commitMessage,
      };
    }
    return {
      repoUrl: GIT_REPO_URL,
      branch: GIT_BRANCH,
      path: relativeGitPath,
      committed: false,
      commitMessage,
    };
  } catch (error) {
    console.warn('[git-archive] Failed to export project', { err: error.stderr || error.message });
    return null;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = { exportProjectToGit };
