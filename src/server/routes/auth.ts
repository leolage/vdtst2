import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../../db/knex.js';

const loginSchema = z.object({
  login: z.string().min(1).max(64),
  senha: z.string().min(1).max(200),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });

    const { login, senha } = parsed.data;
    const user = await db()('users').where({ login }).first();
    // compara mesmo sem usuário para não vazar timing
    const hash = user?.senha_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(senha, hash);

    if (!user || !ok) return reply.code(401).send({ error: 'credenciais_invalidas' });

    req.session.userId = user.id;
    req.session.login = user.login;
    return { ok: true, login: user.login };
  });

  app.post('/logout', async (req) => {
    await req.session.destroy();
    return { ok: true };
  });

  app.get('/me', async (req, reply) => {
    if (!req.session.userId) return reply.code(401).send({ error: 'nao_autenticado' });
    return { login: req.session.login };
  });
}
