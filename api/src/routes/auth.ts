import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';

const authCallbackSchema = z
  .object({
    code: z.string().min(1),
    redirectUri: z.string().min(1).optional(),
    redirect_uri: z.string().min(1).optional(),
  });

const setAuthCorsHeaders = (reply: FastifyReply) => {
  reply
    .header('Access-Control-Allow-Origin', config.frontend.origin)
    .header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    .header('Access-Control-Allow-Credentials', 'true');
};

const parseJsonSafely = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const registerAuthRoutes = (app: FastifyInstance) => {
  const tokenEndpoint = `https://${config.cognito.domain}/oauth2/token`;
  const allowedRedirectUri = config.frontend.authCallbackUrl.replace(/\/$/, '');

  const handleCallbackRequest = async (
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
    options: { fallbackRedirectUri?: string } = {}
  ) => {
    setAuthCorsHeaders(reply);
    let incomingPayload: unknown = payload;
    if (typeof incomingPayload === 'string') {
      try {
        incomingPayload = JSON.parse(incomingPayload);
      } catch {
        // Leave as string so validation fails with a useful error
      }
    }
    // eslint-disable-next-line no-console
    console.log('Received callback payload:', incomingPayload);
    const parsed = authCallbackSchema.safeParse(incomingPayload);
    if (!parsed.success) {
      return reply.code(400).send({
        message: 'Invalid request payload.',
        details: parsed.error.flatten(),
      });
    }

    const incomingRedirect =
      parsed.data.redirectUri ??
      parsed.data.redirect_uri ??
      options.fallbackRedirectUri ??
      allowedRedirectUri;
    if (!incomingRedirect) {
      return reply.code(400).send({
        message: 'redirectUri is required.',
      });
    }
    const redirectUriNormalized = incomingRedirect.replace(/\/$/, '');
    if (redirectUriNormalized !== allowedRedirectUri) {
      return reply.code(400).send({
        message: 'Invalid redirect URI.',
      });
    }

    if (!config.cognito.appClientId) {
      request.log.error('COGNITO_CLIENT_ID is not configured');
      return reply.code(500).send({ message: 'Internal server error.' });
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.cognito.appClientId,
      code: parsed.data.code,
      redirect_uri: allowedRedirectUri,
    });
    if (config.cognito.appClientSecret) {
      params.append('client_secret', config.cognito.appClientSecret);
    }

    let response: Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to reach Cognito token endpoint');
      return reply.code(502).send({ message: 'Error contacting Cognito.' });
    }

    const payloadFromCognito = await parseJsonSafely(response);

    if (!response.ok) {
      request.log.error(
        { cognitoStatus: response.status, cognitoPayload: payloadFromCognito },
        'Cognito token exchange failed'
      );
      const status =
        response.status >= 400 && response.status < 500 ? 400 : response.status || 502;
      const message =
        status === 400 ? 'Invalid or expired authorization code.' : 'Error contacting Cognito.';
      return reply.code(status).send({ message });
    }

    if (
      typeof payloadFromCognito !== 'object' ||
      payloadFromCognito === null ||
      !('access_token' in payloadFromCognito) ||
      !('id_token' in payloadFromCognito)
    ) {
      request.log.error(
        { cognitoStatus: response.status, cognitoPayload: payloadFromCognito },
        'Unexpected response from Cognito'
      );
      return reply.code(502).send({ message: 'Error contacting Cognito.' });
    }

    return reply.send({
      accessToken: (payloadFromCognito as any).access_token,
      idToken: (payloadFromCognito as any).id_token,
      refreshToken: (payloadFromCognito as any).refresh_token,
      expiresIn: (payloadFromCognito as any).expires_in,
      tokenType: (payloadFromCognito as any).token_type,
    });
  };

  app.options('/auth/callback', async (request, reply) => {
    setAuthCorsHeaders(reply);
    reply.code(204).send();
  });

  app.get('/auth/callback', async (request, reply) => {
    await handleCallbackRequest(request, reply, request.query ?? {}, {
      fallbackRedirectUri: allowedRedirectUri,
    });
  });

  app.post('/auth/callback', async (request, reply) => {
    await handleCallbackRequest(request, reply, request.body);
  });
};
