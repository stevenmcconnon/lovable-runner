import crypto from 'node:crypto';
import AWS from 'aws-sdk';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';
import { DatabaseService } from '../services/database';

const authCallbackSchema = z
  .object({
    code: z.string().min(1),
    redirectUri: z.string().min(1).optional(),
    redirect_uri: z.string().min(1).optional(),
  });

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const meUpdateSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  companyName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  location: z.string().max(200).optional(),
  photoUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
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

export const registerAuthRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;
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

  app.post('/auth/signup', async (request, reply) => {
    setAuthCorsHeaders(reply);
    const body = signupSchema.parse(request.body);
    try {
      requireCognitoClientConfig();
      const params: AWS.CognitoIdentityServiceProvider.SignUpRequest = {
        ClientId: config.cognito.appClientId as string,
        Username: body.email,
        Password: body.password,
        UserAttributes: [
          { Name: 'email', Value: body.email },
          { Name: 'email_verified', Value: 'true' },
          body.fullName ? { Name: 'name', Value: body.fullName } : null,
        ].filter(Boolean) as AWS.CognitoIdentityServiceProvider.AttributeType[],
      };
      const secretHash = buildSecretHash(body.email);
      if (secretHash) params.SecretHash = secretHash;
      const response = await cognitoClient.signUp(params).promise();
      if (response.UserSub) {
        try {
          const profile = await db.createProfileRecord({
            email: body.email,
            fullName: body.fullName,
            cognitoSub: response.UserSub,
          });
          await db.ensureRolesForUser(profile.id, ['customer']);
        } catch (error) {
          request.log.warn({ err: error }, 'Failed to create profile for signup (continuing)');
        }
      }
      reply.code(201).send({
        message: 'Signup successful. Check your email to confirm your account.',
      });
    } catch (error: any) {
      request.log.error({ err: error }, 'Signup failed');
      const status =
        error?.code === 'UsernameExistsException' ? 409 : error?.statusCode || 500;
      reply.code(status).send({ message: error?.message || 'Signup failed' });
    }
  });

  app.post('/auth/login', async (request, reply) => {
    setAuthCorsHeaders(reply);
    const body = loginSchema.parse(request.body);
    try {
      requireCognitoClientConfig();
      const authParams: Record<string, string> = {
        USERNAME: body.email,
        PASSWORD: body.password,
      };
      const secretHash = buildSecretHash(body.email);
      if (secretHash) authParams.SECRET_HASH = secretHash;
      const response = await cognitoClient
        .initiateAuth({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: config.cognito.appClientId as string,
          AuthParameters: authParams,
        })
        .promise();
      if (!response.AuthenticationResult) {
        return reply.code(401).send({ message: 'Invalid email or password' });
      }
      reply.send({
        accessToken: response.AuthenticationResult.AccessToken,
        idToken: response.AuthenticationResult.IdToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
        expiresIn: response.AuthenticationResult.ExpiresIn,
        tokenType: response.AuthenticationResult.TokenType,
      });
    } catch (error: any) {
      request.log.error({ err: error }, 'Login failed');
      const status =
        error?.code === 'NotAuthorizedException' || error?.code === 'UserNotFoundException'
          ? 401
          : error?.statusCode || 500;
      reply.code(status).send({ message: error?.message || 'Login failed' });
    }
  });

  app.post('/auth/forgot-password', async (request, reply) => {
    setAuthCorsHeaders(reply);
    const body = forgotPasswordSchema.parse(request.body);
    try {
      requireCognitoClientConfig();
      const params: AWS.CognitoIdentityServiceProvider.ForgotPasswordRequest = {
        ClientId: config.cognito.appClientId as string,
        Username: body.email,
      };
      const secretHash = buildSecretHash(body.email);
      if (secretHash) params.SecretHash = secretHash;
      await cognitoClient.forgotPassword(params).promise();
      reply.send({ message: 'Password reset instructions sent if the email exists.' });
    } catch (error: any) {
      request.log.error({ err: error }, 'Forgot password failed');
      const status = error?.statusCode || 500;
      reply.code(status).send({ message: error?.message || 'Unable to start reset flow' });
    }
  });

  app.get(
    '/me',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = request.auth?.profile;
      if (!profile) return reply.code(404).send({ message: 'Profile not found' });
      const details = await db.getProfileDetails(profile.id);
      return reply.send({
        profile,
        roles: request.auth?.roles ?? [],
        details,
        userId: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        cognitoSub: profile.cognitoSub,
      });
    }
  );

  app.patch(
    '/me',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = request.auth?.profile;
      if (!profile) return reply.code(404).send({ message: 'Profile not found' });
      const body = meUpdateSchema.parse(request.body ?? {});
      let updatedProfile = profile;
      if (body.fullName) {
        const result = await db.updateProfileById(profile.id, { fullName: body.fullName });
        if (result) {
          updatedProfile = result;
          if (request.auth) {
            request.auth.profile = result;
          }
        }
      }
      const detailFields = {
        companyName: body.companyName,
        title: body.title,
        phone: body.phone,
        location: body.location,
        photoUrl: body.photoUrl,
        metadata: body.metadata ?? null,
      };
      const hasDetailUpdate = Object.values(detailFields).some(
        (value) => value !== undefined && value !== null
      );
      let details = await db.getProfileDetails(profile.id);
      if (hasDetailUpdate) {
        details = await db.upsertProfileDetails(profile.id, detailFields);
      }
      reply.send({
        profile: updatedProfile,
        roles: request.auth?.roles ?? [],
        details,
        userId: updatedProfile.id,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        cognitoSub: updatedProfile.cognitoSub,
      });
    }
  );

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
const cognitoClient = new AWS.CognitoIdentityServiceProvider({ region: config.awsRegion });

const buildSecretHash = (username: string) => {
  if (!config.cognito.appClientSecret || !config.cognito.appClientId) return undefined;
  const hmac = crypto.createHmac('sha256', config.cognito.appClientSecret);
  hmac.update(`${username}${config.cognito.appClientId}`);
  return hmac.digest('base64');
};

const requireCognitoClientConfig = () => {
  if (!config.cognito.appClientId) {
    throw new Error('COGNITO_CLIENT_ID is not configured');
  }
  return true;
};
