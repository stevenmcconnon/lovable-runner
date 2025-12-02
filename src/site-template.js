const fsp = require('node:fs/promises');
const path = require('node:path');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'site-base');

const copyTemplateTo = async (targetDir) => {
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(targetDir), { recursive: true });
  await fsp.cp(TEMPLATE_DIR, targetDir, { recursive: true });
};

const writeSiteJson = async (projectDir, siteJson) => {
  const target = path.join(projectDir, 'src', 'content', 'site.json');
  await fsp.writeFile(target, JSON.stringify(siteJson, null, 2));
};

module.exports = { TEMPLATE_DIR, copyTemplateTo, writeSiteJson };
