function sanitizeSlug(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase();
}

function buildDraftJsonPath(slug, filename, extraSegments) {
  var normalizedSlug = sanitizeSlug(slug);
  if (!normalizedSlug) {
    return '/' + filename;
  }
  var base = '/sites/' + normalizedSlug + '/draft/' + filename;
  if (extraSegments && extraSegments.length) {
    base += '/' + extraSegments.join('/');
  }
  return base;
}

function handler(event) {
  var request = event.request || {};
  var uri = typeof request.uri === 'string' && request.uri.length ? request.uri : '/';

  if (!uri.startsWith('/')) {
    uri = '/' + uri;
  }

  var segments = uri.split('/').filter(function (segment) {
    return segment.length > 0;
  });

  if (segments.length === 0) {
    request.uri = '/index.html';
    return request;
  }

  var first = segments[0];
  var second = segments.length > 1 ? segments[1] : '';

  var isJson = second === 'content.json' || second === 'template.json';
  var isCanonical = first === 'site-base';
  var startsWithAssets = first === 'assets';
  var slugThenAssets = !startsWithAssets && second === 'assets';

  if (isJson) {
    request.uri = buildDraftJsonPath(first, second, segments.slice(2));
    return request;
  }

  if (isCanonical || startsWithAssets) {
    request.uri = uri;
    return request;
  }

  if (slugThenAssets) {
    request.uri = '/' + segments.slice(1).join('/');
    return request;
  }

  var rest = segments.slice(1).join('/');
  request.uri = rest ? '/' + rest : '/index.html';
  return request;
}
