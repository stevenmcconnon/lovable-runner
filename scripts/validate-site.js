#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { validateSiteQuality } = require('../src/site-schema');

const file = process.argv[2];
if (!file) {
  console.error('Usage: validate-site <path-to-site-json-or-content.json>');
  process.exit(2);
}

const raw = fs.readFileSync(path.resolve(file), 'utf8');
const json = JSON.parse(raw);
const site = json.site || json.siteConfig || json;

const result = validateSiteQuality(site);
if (!result.valid) {
  console.error('INVALID');
  result.errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}

console.log('VALID');
process.exit(0);
