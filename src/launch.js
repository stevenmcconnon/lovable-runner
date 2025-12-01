const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AWS = require('aws-sdk');
const { randomUUID } = require('node:crypto');
const { generateSiteWithGemini } = require('./gemini');
const { uploadToS3, buildProject } = require('./deploy');
const { exportProjectToGit } = require('./git-archive');

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

const slugify = (input) => {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
};

const ensureUniqueSlug = async ({ bucket, basePrefix, slugCandidate }) => {
  const s3 = new AWS.S3();
  const sanitizedBase = slugCandidate && slugCandidate.length ? slugCandidate : 'site';
  let attempt = 0;

  const buildPrefixPath = (slugValue) => {
    if (!slugValue) return '';
    return basePrefix
      ? `${basePrefix.replace(/\/$/, '')}/${slugValue}`
      : slugValue;
  };

  while (attempt < 20) {
    const candidate = attempt === 0 ? sanitizedBase : `${sanitizedBase}-${attempt}`;
    const prefixPath = buildPrefixPath(candidate);
    const existing = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: `${prefixPath}/`,
        MaxKeys: 1,
      })
      .promise();
    if (!existing.Contents || existing.Contents.length === 0) {
      return { slug: candidate, prefixPath };
    }
    attempt += 1;
  }

  const fallback = `${sanitizedBase}-${Date.now()}`;
  return { slug: fallback, prefixPath: buildPrefixPath(fallback) };
};

const sanitizePath = (relativePath) => {
  const normalized = path.normalize(relativePath || '').replace(/^(\.\.[/\\])+/, '');
  if (!normalized || normalized === '.' || normalized === '/' || normalized === '\\') {
    return null;
  }
  return normalized;
};

const decodeFile = (file) => {
  if (!file || file.contents === undefined || file.contents === null) return null;
  if (file.encoding === 'base64') {
    return Buffer.from(file.contents, 'base64');
  }
  if (typeof file.contents === 'string' && file.contents.startsWith('data:')) {
    const match = file.contents.match(/^data:[^;]+;base64,(.+)$/);
    if (match?.[1]) return Buffer.from(match[1], 'base64');
  }
  if (typeof file.contents === 'string') return file.contents;
  return Buffer.from(String(file.contents));
};

const writeGeneratedFiles = async (files, outputDir) => {
  await fsp.mkdir(outputDir, { recursive: true });
  for (const file of files) {
    const targetPath = sanitizePath(file.path || file.name);
    if (!targetPath) {
      // eslint-disable-next-line no-console
      console.warn('Skipping file with unsafe/empty path', file);
      continue;
    }
    const data = decodeFile(file);
    if (data === null) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping file with empty data: ${targetPath}`);
      continue;
    }
    const fullPath = path.join(outputDir, targetPath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, data);
  }
  return outputDir;
};

const buildSlugCandidate = ({ businessDetails, url, description, requestId }) => {
  if (businessDetails?.businessName) return slugify(businessDetails.businessName);
  if (url) return slugify(url);
  if (description) return slugify(description.slice(0, 50));
  if (requestId) return slugify(requestId);
  return slugify(`site-${Date.now()}`);
};

const buildTestSiteFiles = ({ url, description }) => {
  const safeUrl = url || 'https://example.com';
  const safeDescription = description || 'Sample site generated in test mode.';
  const timestamp = new Date().toISOString();
  return [
    {
      path: 'index.html',
      contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lovable Test Site</title>
    <link rel="stylesheet" href="assets/styles.css" />
  </head>
  <body>
    <main class="hero">
      <h1>Lovable Test Deployment</h1>
      <p>${safeDescription}</p>
      <p class="meta">Reference URL: ${safeUrl}</p>
      <p class="meta">Generated: ${timestamp}</p>
      <a class="cta" href="${safeUrl}" target="_blank" rel="noreferrer">View Source</a>
    </main>
    <section class="details">
      <h2>Why this exists</h2>
      <ul>
        <li>Validates the upload/deploy pipeline without calling Gemini.</li>
        <li>Confirms bucket permissions and status tracking.</li>
        <li>Use the <code>--simple</code> flag in <code>scripts/test-launch.sh</code> to trigger.</li>
      </ul>
    </section>
  </body>
</html>`,
      encoding: 'utf8',
      contentType: 'text/html',
    },
    {
      path: 'assets/styles.css',
      contents: `:root {
  color-scheme: dark;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #050505;
  color: #f6f6f6;
}
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 4rem clamp(1.5rem, 4vw, 5rem);
  background: radial-gradient(circle at top, rgba(99,102,241,0.15), transparent 55%);
}
.hero {
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 24px;
  padding: clamp(2rem, 4vw, 3.5rem);
  background: rgba(255,255,255,0.02);
  box-shadow: 0 10px 50px rgba(0,0,0,0.4);
}
.hero h1 {
  font-size: clamp(2.5rem, 6vw, 3.5rem);
  margin-bottom: 0.5rem;
}
.meta {
  color: rgba(255,255,255,0.7);
  margin: 0.5rem 0;
}
.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.85rem 1.5rem;
  border-radius: 999px;
  background: linear-gradient(120deg, #6366f1, #8b5cf6);
  color: white;
  text-decoration: none;
  margin-top: 1.5rem;
  font-weight: 600;
}
.details {
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: clamp(1.5rem, 3vw, 2.5rem);
  background: rgba(255,255,255,0.01);
}
.details h2 {
  margin-top: 0;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-size: 0.95rem;
  color: rgba(255,255,255,0.75);
}
.details ul {
  padding-left: 1.2rem;
  color: rgba(255,255,255,0.8);
  line-height: 1.6;
}
`,
      encoding: 'utf8',
      contentType: 'text/css',
    },
  ];
};

const buildTempDir = (...parts) => path.join(os.tmpdir(), ...parts, randomUUID());

const clearS3Prefix = async ({ bucket, prefix }) => {
  if (!prefix) return;
  const normalizedPrefix = prefix.replace(/\/+$/, '');
  const s3 = new AWS.S3();
  let continuationToken = undefined;
  do {
    const listed = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: `${normalizedPrefix}/`,
        ContinuationToken: continuationToken,
      })
      .promise();
    if (listed.Contents?.length) {
      await s3
        .deleteObjects({
          Bucket: bucket,
          Delete: { Objects: listed.Contents.map((item) => ({ Key: item.Key })) },
        })
        .promise();
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
};

const hasPackageJson = (dir) => fs.existsSync(path.join(dir, 'package.json'));

const readPackageJson = async (dir) => {
  const packageJsonPath = path.join(dir, 'package.json');
  const raw = await fsp.readFile(packageJsonPath, 'utf8');
  return JSON.parse(raw);
};

const findExistingBuildDir = (projectDir) => {
  const candidates = ['dist', 'build'];
  for (const folder of candidates) {
    const fullPath = path.join(projectDir, folder);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      return fullPath;
    }
  }
  return null;
};

const maybeBuildForHosting = async (projectDir) => {
  if (!hasPackageJson(projectDir)) {
    return { hostingDir: projectDir, builtFromProject: false, buildArtifacts: null };
  }
  let packageJson;
  try {
    packageJson = await readPackageJson(projectDir);
  } catch (error) {
    console.warn('[launch] Failed to parse package.json; serving raw files', {
      projectDir,
      err: error?.message,
    });
    return { hostingDir: projectDir, builtFromProject: false, buildArtifacts: null };
  }

  const existingBuildDir = findExistingBuildDir(projectDir);
  if (existingBuildDir) {
    return { hostingDir: existingBuildDir, builtFromProject: true, buildArtifacts: 'existing-dist' };
  }

  if (!packageJson?.scripts?.build) {
    return { hostingDir: projectDir, builtFromProject: false, buildArtifacts: null };
  }

  try {
    const distPath = await buildProject(projectDir, { skipInstall: true });
    return { hostingDir: distPath, builtFromProject: true, buildArtifacts: 'built' };
  } catch (error) {
    console.warn('[launch] Build step failed, using raw project output', {
      projectDir,
      err: error?.message,
    });
    return { hostingDir: projectDir, builtFromProject: false, buildArtifacts: null };
  }
};

const runLaunch = async ({
  url,
  description,
  businessDetails,
  requestId,
  onProgress,
  testMode = false,
}) => {
  if (!url && !description) throw new Error('url or description is required');
  const resolvedBucket =
    process.env.LOVABLE_DEPLOY_BUCKET ||
    process.env.DEPLOY_BUCKET ||
    process.env.TEMPLATE_UPLOAD_BUCKET;
  if (!resolvedBucket) throw new Error('bucket is required (set LOVABLE_DEPLOY_BUCKET or DEPLOY_BUCKET).');

  onProgress?.('running');
  let files;
  if (testMode) {
    console.log('[launch] Generating test site (Gemini skipped)', { requestId, sourceUrl: url });
    files = buildTestSiteFiles({ url, description });
  } else {
    console.log('[launch] Generating site with Gemini', { requestId, sourceUrl: url });
    const result = await generateSiteWithGemini({
      sourceUrl: url,
      description,
      businessDetails,
    });
    files = result.files;
    console.log('[launch] Gemini generation complete', { requestId, fileCount: files.length });
  }

  onProgress?.('building');
  const basePrefix =
    process.env.LOVABLE_DEPLOY_PREFIX ||
    process.env.DEPLOY_PREFIX ||
    process.env.PREVIEW_ROOT_PREFIX ||
    '';
  const desiredSlug = buildSlugCandidate({ businessDetails, url, description, requestId });
  const { slug: finalSlug, prefixPath: resolvedPrefix } = await ensureUniqueSlug({
    bucket: resolvedBucket,
    basePrefix,
    slugCandidate: desiredSlug,
  });
  const targetPrefix = resolvedPrefix;

  const requestSuffix = (requestId || randomUUID()).slice(0, 8);
  console.log('[launch] Using slug', { requestId, slug: finalSlug, prefix: resolvedPrefix });
  const outputDir = buildTempDir('gemini-site', finalSlug, requestSuffix);
  await writeGeneratedFiles(files, outputDir);
  console.log('[launch] Files written to disk', { requestId, outputDir });

  const gitArchive = await exportProjectToGit({
    projectDir: outputDir,
    slug: finalSlug,
    requestId: requestId || requestSuffix,
    sourceUrl: url,
    description,
  });
  if (gitArchive) {
    console.log('[launch] Exported project to git', gitArchive);
  }

  const { hostingDir, builtFromProject, buildArtifacts } = await maybeBuildForHosting(outputDir);
  console.log('[launch] Hosting payload prepared', {
    requestId,
    builtFromProject,
    hostingDir,
    buildArtifacts,
  });

  onProgress?.('deploying');
  console.log('[launch] Clearing existing preview prefix', {
    requestId,
    bucket: resolvedBucket,
    prefix: targetPrefix,
  });
  await clearS3Prefix({ bucket: resolvedBucket, prefix: targetPrefix }).catch((error) => {
    console.warn('[launch] Failed to clear prefix (continuing)', { err: error?.message, prefix: targetPrefix });
  });
  console.log('[launch] Uploading to S3', {
    requestId,
    bucket: resolvedBucket,
    prefix: targetPrefix,
  });
  const target = await uploadToS3(hostingDir, { bucket: resolvedBucket, prefix: targetPrefix });
  console.log('[launch] Upload complete', { requestId, target });
  const normalizedPrefix = targetPrefix ? `${targetPrefix.replace(/\/+$/, '')}/` : '';
  const previewDomain = (process.env.PREVIEW_DOMAIN || '').trim().replace(/\/+$/, '');
  const publicUrl = previewDomain
    ? `https://${previewDomain}/${normalizedPrefix}`
    : `https://${resolvedBucket}.s3.amazonaws.com/${normalizedPrefix}`;

  return {
    slug: finalSlug,
    bucket: resolvedBucket,
    prefix: targetPrefix,
    outputDir,
    hostingDir,
    builtFromProject,
    target,
    publicUrl,
    gitArchive,
    requestId,
  };
};

module.exports = { runLaunch, loadDotEnvIfPresent };
