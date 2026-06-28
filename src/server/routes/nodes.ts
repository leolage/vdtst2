import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { encrypt } from '../../shared/crypto.js';
import { checkNode } from '../../comfy/health.js';

const PUBLIC_COLS = [
  'id', 'nome', 'ssh_host', 'ssh_port', 'ssh_user', 'comfy_port', 'status',
  'max_concurrent', 'vram_total', 'vram_free', 'queue_len', 'modelos_json',
  'loras_json', 'ultimo_health',
] as const;

const createSchema = z.object({
  nome: z.string().min(1).max(120),
  ssh_host: z.string().min(1).max(255),
  ssh_port: z.number().int().default(22),
  ssh_user: z.string().min(1).max(64),
  ssh_key: z.string().min(1),            // chave privada em texto — cifrada antes de salvar
  comfy_port: z.number().int().default(8188),
  max_concurrent: z.number().int().min(1).default(1),
});

export async function nodeRoutes(app: FastifyInstance) {
  app.get('/nodes', async () => {
    return db()('comfy_nodes').select(PUBLIC_COLS as unknown as string[]).orderBy('id'); // nunca devolve a chave
  });

  app.post('/nodes', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido', detalhe: parsed.error.issues });
    const { ssh_key, ...rest } = parsed.data;
    let ssh_key_ref: string;
    try { ssh_key_ref = encrypt(ssh_key); }
    catch (e) { return reply.code(500).send({ error: 'cripto_indisponivel', detalhe: (e as Error).message }); }
    const [id] = await db()('comfy_nodes').insert({ ...rest, ssh_key_ref, status: 'down' });
    return reply.code(201).send({ id });
  });

  app.patch('/nodes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const schema = z.object({
      nome: z.string().min(1).max(120).optional(),
      ssh_host: z.string().min(1).max(255).optional(),
      ssh_port: z.number().int().optional(),
      ssh_user: z.string().min(1).max(64).optional(),
      ssh_key: z.string().min(1).optional(),
      comfy_port: z.number().int().optional(),
      max_concurrent: z.number().int().min(1).optional(),
      status: z.enum(['up', 'down', 'paused']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const { ssh_key, ...rest } = parsed.data;
    const patch: Record<string, unknown> = { ...rest };
    if (ssh_key) patch.ssh_key_ref = encrypt(ssh_key);
    const n = await db()('comfy_nodes').where({ id }).update(patch);
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  app.delete('/nodes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('comfy_nodes').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // testa conexão SSH + API agora e atualiza o health
  app.post('/nodes/:id/test', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const node = await db()('comfy_nodes').where({ id }).first();
    if (!node) return reply.code(404).send({ error: 'nao_encontrado' });
    const result = await checkNode(node);
    return result;
  });
}
