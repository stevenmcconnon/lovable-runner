const { runLaunch } = require('./src/launch');

exports.handler = async (event) => {
  try {
    const parsedBody =
      typeof event.body === 'string'
        ? JSON.parse(event.body || '{}')
        : event.body || {};

    const result = await runLaunch({
      url: parsedBody.url,
      token: parsedBody.token,
      base: parsedBody.base,
      createPath: parsedBody.createPath,
      workspace: parsedBody.workspace,
      waitSeconds: parsedBody.wait,
      attempts: parsedBody.attempts,
      bucket: parsedBody.bucket || process.env.LOVABLE_DEPLOY_BUCKET,
      prefix: parsedBody.prefix || process.env.LOVABLE_DEPLOY_PREFIX,
      slug: parsedBody.slug,
      profile: parsedBody.profile,
      skipInstall: parsedBody.skipInstall,
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: result.projectId,
        outputDir: result.outputDir,
        distPath: result.distPath,
        target: result.target,
        url: result.publicUrl,
      }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Launch failed' }),
    };
  }
};
