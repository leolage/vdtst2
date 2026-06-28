import type { FastifyInstance } from 'fastify';
import { db } from '../../db/knex.js';

export async function healthRoutes(app: FastifyInstance) {
  // público (liberado no preHandler) — usado por nginx/monitoramento
  app.get('/health', async (_req, reply) => {
    try {
      await db().raw('select 1');
      return { ok: true, db: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });
}
