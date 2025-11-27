import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { config } from './env';
import { DatabaseService } from './services/database';
import { AuthContext, UserRole } from './types';

const unauthorized = (message = 'Unauthorized') => {
  const error = new Error(message);
  // @ts-expect-error add status code
  error.statusCode = 401;
  return error;
};

const forbidden = (message = 'Forbidden') => {
  const error = new Error(message);
  // @ts-expect-error add status code
  error.statusCode = 403;
  return error;
};

const createUserVerifier = () =>
  CognitoJwtVerifier.create({
    userPoolId: config.cognito.userPoolId,
    tokenUse: 'access',
    clientId: config.cognito.appClientId,
  });

const createMachineVerifier = () =>
  config.cognito.machineClientId
    ? CognitoJwtVerifier.create({
        userPoolId: config.cognito.userPoolId,
        tokenUse: 'access',
        clientId: config.cognito.machineClientId,
      })
    : null;

const extractToken = (request: FastifyRequest) => {
  const header = request.headers.authorization;
  if (!header) return null;
  const [, token] = header.split(' ');
  return token || null;
};

const fetchCognitoUserInfo = async (accessToken: string, logger: FastifyRequest['log']) => {
  const endpoint = `https://${config.cognito.domain}/oauth2/userInfo`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      logger?.warn(
        { status: response.status, statusText: response.statusText },
        'Failed to fetch Cognito userInfo'
      );
      return null;
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') return null;
    return {
      email: typeof (data as any).email === 'string' ? (data as any).email : undefined,
      name: typeof (data as any).name === 'string' ? (data as any).name : undefined,
      username: typeof (data as any).username === 'string' ? (data as any).username : undefined,
    };
  } catch (error) {
    logger?.warn({ err: error }, 'Error while calling Cognito userInfo endpoint');
    return null;
  }
};

export const buildAuthPlugin = (database: DatabaseService): FastifyPluginAsync =>
  fastifyPlugin(async function authPlugin(fastify: FastifyInstance) {
    const userVerifier = createUserVerifier();
    const machineVerifier = createMachineVerifier();

    fastify.decorate('authenticateUser', async (request: FastifyRequest): Promise<void> => {
      const token = extractToken(request);
      if (!token) throw unauthorized();
      let payload: any;
      try {
        payload = await userVerifier.verify(token);
      } catch (error) {
        throw unauthorized('Invalid or expired token');
      }
      const usernameClaim =
        typeof payload.username === 'string'
          ? payload.username
          : typeof payload['cognito:username'] === 'string'
          ? payload['cognito:username']
          : undefined;
      let email =
        typeof payload.email === 'string'
          ? payload.email
          : usernameClaim && usernameClaim.includes('@')
          ? usernameClaim
          : undefined;
      let fullName = typeof payload.name === 'string' ? payload.name : undefined;
      if (!email) {
        const userInfo = await fetchCognitoUserInfo(token, request.log);
        if (userInfo?.email) {
          email = userInfo.email;
        } else if (userInfo?.username && userInfo.username.includes('@')) {
          email = userInfo.username;
        }
        if (!fullName && userInfo?.name) {
          fullName = userInfo.name;
        }
      }
      if (!email) {
        // eslint-disable-next-line no-console
        console.warn('[auth] email missing from token payload', payload);
        throw forbidden('Profile not found');
      }
      let profile = await database.getProfileByCognitoSub(payload.sub);
      if (!profile) {
        profile = await database.createProfileFromCognito({
          cognitoSub: payload.sub,
          email,
          fullName,
        });
        await database.ensureRolesForUser(profile.id, ['customer']);
      }
      let roles = await database.getRolesForUser(profile.id);
      if (!roles.length) {
        await database.ensureRolesForUser(profile.id, ['customer']);
        roles = await database.getRolesForUser(profile.id);
      }
      const context: AuthContext = {
        type: 'user',
        sub: payload.sub,
        email,
        roles,
        profile,
      };
      request.auth = context;
    });

    fastify.decorate(
      'authenticateMachine',
      async (request: FastifyRequest): Promise<void> => {
        if (!machineVerifier) {
          throw unauthorized('Machine credentials not configured');
        }
        const token = extractToken(request);
        if (!token) throw unauthorized();
        try {
          const payload = await machineVerifier.verify(token);
          const context: AuthContext = {
            type: 'machine',
            sub: payload.sub,
            roles: ['super-admin'],
          };
          request.auth = context;
        } catch (error) {
          throw unauthorized('Invalid machine token');
        }
      }
    );

    fastify.decorate(
      'requireRoles',
      async (request: FastifyRequest, reply: FastifyReply, roles: UserRole[]) => {
        if (!request.auth || !request.auth.roles) throw unauthorized();
        if (!roles.some((role) => request.auth?.roles.includes(role))) {
          throw forbidden('Insufficient role');
        }
      }
    );
  });
