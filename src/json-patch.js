// Minimal JSON Patch applier (RFC 6902-ish) for LLM-generated patches.
// Supports: add, remove, replace, move, copy, test (test is ignored).

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const decodePathSegment = (seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~');

const splitPath = (path) => {
  if (!path || path === '/') return [];
  return String(path)
    .split('/')
    .slice(1)
    .map(decodePathSegment);
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const getContainerAndKey = (doc, path) => {
  const parts = splitPath(path);
  if (parts.length === 0) return { parent: null, key: null, parts };
  let parent = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (Array.isArray(parent)) {
      const idx = p === '-' ? parent.length : Number(p);
      if (!Number.isFinite(idx)) throw new Error(`Invalid array index in path: ${path}`);
      parent[idx] = parent[idx] ?? {};
      parent = parent[idx];
    } else {
      if (!isObject(parent[p])) parent[p] = {};
      parent = parent[p];
    }
  }
  return { parent, key: parts[parts.length - 1], parts };
};

const getValueAt = (doc, path) => {
  const parts = splitPath(path);
  let cur = doc;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = p === '-' ? cur.length : Number(p);
      cur = cur[idx];
    } else {
      cur = cur[p];
    }
  }
  return cur;
};

const removeAt = (doc, path) => {
  const { parent, key } = getContainerAndKey(doc, path);
  if (parent == null) return undefined;
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) return undefined;
    return parent.splice(idx, 1)[0];
  }
  const old = parent[key];
  delete parent[key];
  return old;
};

const addAt = (doc, path, value) => {
  const { parent, key, parts } = getContainerAndKey(doc, path);
  if (parent == null) {
    // add at root
    return value;
  }
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(value);
      return doc;
    }
    const idx = Number(key);
    if (!Number.isFinite(idx)) throw new Error(`Invalid array index in path: ${path}`);
    parent.splice(idx, 0, value);
    return doc;
  }
  parent[key] = value;
  return doc;
};

const replaceAt = (doc, path, value) => {
  const { parent, key } = getContainerAndKey(doc, path);
  if (parent == null) return value;
  if (Array.isArray(parent)) {
    const idx = key === '-' ? parent.length : Number(key);
    if (!Number.isFinite(idx)) throw new Error(`Invalid array index in path: ${path}`);
    parent[idx] = value;
    return doc;
  }
  parent[key] = value;
  return doc;
};

const normalizePatch = (patch) => {
  if (!patch) return [];
  if (Array.isArray(patch)) return patch;
  if (Array.isArray(patch.operations)) return patch.operations;
  if (Array.isArray(patch.ops)) return patch.ops;
  // Some models return { patch: [...] }
  if (Array.isArray(patch.patch)) return patch.patch;
  return [];
};

const applyJsonPatch = (siteConfig, patch) => {
  const ops = normalizePatch(patch);
  const doc = deepClone(siteConfig);

  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const kind = String(op.op || op.type || '').toLowerCase();
    const path = op.path;
    if (!kind || !path) continue;

    if (kind === 'add') {
      const next = addAt(doc, path, deepClone(op.value));
      // root replacement
      if (next !== doc) return next;
      continue;
    }

    if (kind === 'remove') {
      removeAt(doc, path);
      continue;
    }

    if (kind === 'replace') {
      const next = replaceAt(doc, path, deepClone(op.value));
      if (next !== doc) return next;
      continue;
    }

    if (kind === 'move') {
      if (!op.from) continue;
      const value = getValueAt(doc, op.from);
      removeAt(doc, op.from);
      addAt(doc, path, deepClone(value));
      continue;
    }

    if (kind === 'copy') {
      if (!op.from) continue;
      const value = getValueAt(doc, op.from);
      addAt(doc, path, deepClone(value));
      continue;
    }

    if (kind === 'test') {
      // Ignore tests (LLM patches sometimes include them).
      continue;
    }
  }

  return doc;
};

module.exports = { applyJsonPatch };
