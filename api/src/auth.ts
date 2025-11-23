import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './env';
import { SupabaseService } from './services/supabase';
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

export const buildAuthPlugin = (supabase: SupabaseService): FastifyPluginAsync => {
  const userVerifier = createUserVerifier();
  const machineVerifier = createMachineVerifier();

  return async function authPlugin(fastify: FastifyInstance) {
    fastify.decorate('authenticateUser', async (request: FastifyRequest): Promise<void> => {
      const token = extractToken(request);
      if (!token) throw unauthorized();
      let payload;
      try {
        payload = await userVerifier.verify(token);
      } catch (error) {
        throw unauthorized('Invalid or expired token');
      }
      const profile = await supabase.getProfileByCognitoSub(payload.sub);
      if (!profile) throw forbidden('Profile not found');
      const roles = await supabase.getRolesForUser(profile.id);
      const context: AuthContext = {
        type: 'user',
        sub: payload.sub,
        email: payload.email,
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
  };
};
