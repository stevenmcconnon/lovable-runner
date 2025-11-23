import 'fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthContext, UserRole } from './types';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }

  interface FastifyInstance {
    authenticateUser(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    authenticateMachine(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireRoles(request: FastifyRequest, reply: FastifyReply, roles: UserRole[]): Promise<void>;
  }
}
