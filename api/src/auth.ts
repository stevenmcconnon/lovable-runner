import path from 'node:path';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { config } from './env';
import { DatabaseService } from './services/database';
import { AuthContext, UserRole } from './types';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', relativePath));
  }
};

const { enforceRateLimit, RateLimitError } = rootRequire('src/rate-limit.js') as {
  enforceRateLimit: (params: {
    slug?: string | null;
    action: string;
    identifier: string;
    limit: number;
    windowMs?: number;
  }) => Promise<void>;
  RateLimitError: new (message?: string) => Error & { statusCode?: number };
};

const ONE_MINUTE_MS = 60 * 1000;
const userAccountRateLimit = Number(process.env.AUTH_RATE_LIMIT_PER_ACCOUNT_PER_MINUTE || 120);
const userIpRateLimit = Number(process.env.AUTH_RATE_LIMIT_PER_IP_PER_MINUTE || 300);
const machineSubRateLimit = Number(process.env.MACHINE_RATE_LIMIT_PER_MINUTE || 240);
const machineIpRateLimit = Number(process.env.MACHINE_RATE_LIMIT_PER_IP_PER_MINUTE || 240);

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

const badRequest = (message = 'Bad Request') => {
  const error = new Error(message);
  // @ts-expect-error add status code
  error.statusCode = 400;
  return error;
};

const toBooleanClaim = (value: unknown): boolean => {
  if (value === true) return true;
  if (value === 'true' || value === '1') return true;
  return false;
};

const extractClientIp = (request: FastifyRequest) =>
  (request.headers['x-forwarded-for'] as string | undefined)?.split(',')?.[0]?.trim() ||
  (request.ip as string | undefined) ||
  'unknown';

const applyRateLimit = async (action: string, identifier: string, limit: number) => {
  if (!enforceRateLimit) return;
  if (!Number.isFinite(limit) || limit <= 0) return;
  await enforceRateLimit({
    slug: null,
    action,
    identifier,
    limit,
    windowMs: ONE_MINUTE_MS,
  });
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

    const resolveAccountContext = async (request: FastifyRequest, userId: string) => {
      const headerAccountId =
        (request.headers['x-account-id'] as string | undefined) ||
        (request.headers['X-Account-Id'] as string | undefined);
      const memberships = await database.listMembershipsForUser(userId);
      if (!memberships.length) {
        return null;
      }
      if (headerAccountId) {
        const match = memberships.find((m) => m.accountId === headerAccountId);
        if (match) return match;
        throw forbidden('Account not accessible');
      }
      if (memberships.length === 1) {
        return memberships[0];
      }
      throw badRequest('Multiple accounts found; specify X-Account-Id');
    };

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
        await database.ensureDefaultAccountMembership(profile.id, profile.accountId);
      }
      let roles = await database.getRolesForUser(profile.id);
      if (!roles.length) {
        await database.ensureRolesForUser(profile.id, ['customer']);
        roles = await database.getRolesForUser(profile.id);
      }
      const membership = await resolveAccountContext(request, profile.id);
      if (membership) {
        profile.accountId = membership.accountId;
      }
      const clientIp = extractClientIp(request);
      try {
        await applyRateLimit('auth:user:ip', `ip:${clientIp}`, userIpRateLimit);
        if (membership?.accountId) {
          await applyRateLimit(
            'auth:user:account',
            `acct:${membership.accountId}`,
            userAccountRateLimit
          );
        }
      } catch (error) {
        if (error instanceof RateLimitError || (error as any)?.statusCode === 429) {
          throw error;
        }
        throw error;
      }
      const context: AuthContext = {
        type: 'user',
        sub: payload.sub,
        email,
        roles,
        profile,
        account: membership
          ? {
              id: membership.accountId,
              role: membership.role as UserRole,
            }
          : undefined,
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
          const scopeClaim = (payload as any).scope;
          const scopes =
            typeof scopeClaim === 'string'
              ? scopeClaim.split(/\s+/).filter(Boolean)
              : Array.isArray(scopeClaim)
              ? scopeClaim
              : [];
          const hasInternalScope = scopes.includes('lovable-backend/internal');
          const machineClaim =
            toBooleanClaim((payload as any).machine) ||
            toBooleanClaim((payload as any)['lovable:machine']) ||
            hasInternalScope;
          if (!machineClaim) {
            throw unauthorized('Machine claim missing');
          }
          const rawPermissions = ((payload as any).permissions || (payload as any)['lovable:permissions']) as
            | Record<string, any>
            | undefined;
          const allowAccountContextClaim =
            (payload as any)['lovable:allowAccountContext'] ??
            (payload as any)['lovable:allow_account_context'] ??
            (payload as any)['lovable:allow-account-context'];
          const adminPermission = toBooleanClaim(rawPermissions?.admin) || hasInternalScope;
          const clientIp = extractClientIp(request);
          try {
            await applyRateLimit('auth:machine:ip', `ip:${clientIp}`, machineIpRateLimit);
            await applyRateLimit('auth:machine:sub', `machine:${payload.sub}`, machineSubRateLimit);
          } catch (error) {
            if (error instanceof RateLimitError || (error as any)?.statusCode === 429) {
              throw error;
            }
            throw error;
          }
          const context: AuthContext = {
            type: 'machine',
            sub: payload.sub,
            roles: adminPermission ? ['admin', 'super-admin'] : [],
            permissions: {
              allowAccountContext: toBooleanClaim(allowAccountContextClaim) || hasInternalScope,
              admin: adminPermission,
              jobs: {
                run: toBooleanClaim(rawPermissions?.jobs?.run) || hasInternalScope,
              },
            },
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
