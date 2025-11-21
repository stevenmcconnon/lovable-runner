const PLACEHOLDER_PATTERNS = [
  /Welcome to Your Blank App/i,
  /Start building your amazing project here/i,
];

const IGNORE_PATH_PATTERNS = [/README\.md$/i];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_PLACEHOLDER_LIMIT = 30;

const containsPlaceholderContent = (projectData) => {
  if (!projectData?.files || !projectData.files.length) return true;
  return projectData.files.some((file) => {
    if (!file || typeof file.contents !== 'string') return false;
    if (file.name && IGNORE_PATH_PATTERNS.some((pattern) => pattern.test(file.name))) {
      return false;
    }
    return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(file.contents));
  });
};

const waitForProjectReady = async ({
  client,
  projectId,
  attempts = 60,
  waitMs = 10_000,
  placeholderAttemptsBeforeAccept = null,
  onRetry,
}) => {
  if (!client) throw new Error('client is required to poll project readiness.');
  if (!projectId) throw new Error('projectId is required to poll project readiness.');

  let lastError;
  let placeholderCount = 0;
  let placeholderLimitEnabled = true;
  let placeholderLimit;

  if (placeholderAttemptsBeforeAccept === null) {
    placeholderLimitEnabled = false;
  } else if (typeof placeholderAttemptsBeforeAccept === 'number') {
    placeholderLimit = placeholderAttemptsBeforeAccept;
  } else {
    placeholderLimit = DEFAULT_PLACEHOLDER_LIMIT;
  }

  if (
    placeholderLimitEnabled &&
    (placeholderLimit === undefined ||
      Number.isNaN(placeholderLimit) ||
      !Number.isFinite(placeholderLimit) ||
      placeholderLimit <= 0)
  ) {
    placeholderLimitEnabled = false;
  }

  for (let i = 1; i <= attempts; i += 1) {
    try {
      const data = await client.fetchSourceCode(projectId);
      if (containsPlaceholderContent(data)) {
        placeholderCount += 1;
        if (placeholderLimitEnabled && placeholderCount >= placeholderLimit) {
          if (onRetry) {
            onRetry({
              type: 'placeholder-limit',
              attempt: i,
              attempts,
            });
          }
          return data;
        }
        if (onRetry) {
          onRetry({
            type: 'placeholder',
            attempt: i,
            attempts,
            waitSeconds: waitMs / 1000,
          });
        }
        if (i === attempts) return data;
        await sleep(waitMs);
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
      const retryable =
        error?.status === 404 || error?.status === 400 || error?.status === 500;
      if (!retryable || i === attempts) throw error;
      if (onRetry) {
        onRetry({
          type: 'error',
          attempt: i,
          attempts,
          waitSeconds: waitMs / 1000,
          error,
        });
      }
      await sleep(waitMs);
    }
  }
  throw lastError;
};

module.exports = { containsPlaceholderContent, waitForProjectReady };
