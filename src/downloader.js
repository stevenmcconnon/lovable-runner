const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ensureDir = (dir) => fs.mkdir(dir, { recursive: true });

const decodeFileContents = (file) => {
  if (file.contents === undefined || file.contents === null) {
    return null;
  }
  if (file.binary) {
    return Buffer.from(file.contents, 'base64');
  }
  return file.contents;
};

const writeFilesToDisk = async (files, outputDir) => {
  await ensureDir(outputDir);
  for (const file of files) {
    if (file.contents === undefined || file.contents === null) {
      // Skip entries (likely folders or placeholders) that have no content.
      // eslint-disable-next-line no-console
      console.warn(`Skipping empty file entry: ${file.name}`);
      continue;
    }
    const target = path.join(outputDir, file.name);
    await ensureDir(path.dirname(target));
    const data = decodeFileContents(file);
    if (data === null) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping file with null data: ${file.name}`);
      continue;
    }
    await fs.writeFile(target, data);
  }
};

const zipDirectory = (dir, zipPath) =>
  new Promise((resolve, reject) => {
    const zip = spawn('zip', ['-r', zipPath, '.'], { cwd: dir, stdio: 'inherit' });
    zip.on('exit', (code) => {
      if (code === 0) resolve(zipPath);
      else reject(new Error(`zip failed with code ${code}`));
    });
  });

const downloadProjectFiles = async (
  client,
  projectId,
  { outputDir, zip, projectData: prefetchedData } = {}
) => {
  const projectData = prefetchedData || (await client.fetchSourceCode(projectId));
  const files = projectData?.files || [];
  if (!files.length) {
    throw new Error(`No files returned for project ${projectId}`);
  }

  const finalOutputDir =
    outputDir || path.join(process.cwd(), 'downloads', String(projectId));

  await writeFilesToDisk(files, finalOutputDir);

  let zipPath = null;
  if (zip) {
    zipPath = path.join(
      path.dirname(finalOutputDir),
      `${path.basename(finalOutputDir)}.zip`
    );
    await zipDirectory(finalOutputDir, zipPath);
  }

  return { outputDir: finalOutputDir, zipPath };
};

module.exports = { downloadProjectFiles, writeFilesToDisk, zipDirectory };
