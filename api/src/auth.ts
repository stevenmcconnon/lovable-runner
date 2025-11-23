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

export const buildAuthPlugin = (database: DatabaseService): FastifyPluginAsync =>
  fastifyPlugin(async function authPlugin(fastify: FastifyInstance) {
    const userVerifier = createUserVerifier();
    const machineVerifier = createMachineVerifier();

    fastify.decorate('authenticateUser', async (request: FastifyRequest): Promise<void> => {
      const token = extractToken(request);
      if (!token) throw unauthorized();
      let payload;
      try {
        payload = await userVerifier.verify(token);
      } catch (error) {
        throw unauthorized('Invalid or expired token');
      }
      const profile = await database.getProfileByCognitoSub(payload.sub);
      if (!profile) {
        // eslint-disable-next-line no-console
        console.warn('[auth] profile not found for sub', payload.sub);
        throw forbidden('Profile not found');
      }
      const roles = await database.getRolesForUser(profile.id);
      const email = typeof payload.email === 'string' ? payload.email : undefined;
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
