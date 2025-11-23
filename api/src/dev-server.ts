import { buildServer } from './server';

const port = Number(process.env.PORT || 3000);

const start = async () => {
  const app = buildServer();
  try {
    await app.listen({ port, host: '0.0.0.0' });
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://localhost:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
