import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { proximoRun, type Regra } from '../../domain/schedule.js';
import { runScheduleNow } from '../../scheduler/run.js';

const regraSchema = z.object({
  tipo: z.enum(['once', 'interval']),
  inicio: z.string().min(1),
  cada_min: z.number().int().positive().optional(),
  scene_ids: z.array(z.number().int()).optional(),
  stagger_min: z.number().int().nonnegative().optional(),
  max_fila: z.number().int().positive().optional(),
});

function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

export async function scheduleRoutes(app: FastifyInstance) {
  app.get('/projects/:id/schedules', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const rows = await db()('schedules').where({ project_id: projectId }).orderBy('id', 'desc');
    return rows.map((r) => ({ ...r, regra: asJson<Regra>(r.regra_json) }));
  });

  app.post('/projects/:id/schedules', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const parsed = z.object({ nome: z.string().max(200).optional(), ativo: z.boolean().optional(), regra: regraSchema })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido', detalhe: parsed.error.issues });
    if (parsed.data.regra.tipo === 'interval' && !parsed.data.regra.cada_min) {
      return reply.code(400).send({ error: 'cada_min_obrigatorio' });
    }
    const now = new Date();
    const [id] = await db()('schedules').insert({
      project_id: projectId,
      nome: parsed.data.nome ?? null,
      ativo: parsed.data.ativo ?? true,
      regra_json: JSON.stringify(parsed.data.regra),
      proximo_run: proximoRun(parsed.data.regra, null, now),
    });
    return reply.code(201).send({ id });
  });

  app.patch('/schedules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ nome: z.string().max(200).optional(), ativo: z.boolean().optional(), regra: regraSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const patch: Record<string, unknown> = {};
    if (parsed.data.nome !== undefined) patch.nome = parsed.data.nome;
    if (parsed.data.ativo !== undefined) patch.ativo = parsed.data.ativo;
    if (parsed.data.regra) {
      patch.regra_json = JSON.stringify(parsed.data.regra);
      patch.proximo_run = proximoRun(parsed.data.regra, null, new Date());
    }
    const n = await db()('schedules').where({ id }).update(patch);
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  app.delete('/schedules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('schedules').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // dispara agora (gera os jobs imediatamente)
  app.post('/schedules/:id/run-now', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const res = await runScheduleNow(db(), id, new Date());
    if (res.criados === 0) return reply.code(409).send({ error: 'nada_gerado', detalhe: res.motivo });
    return { criados: res.criados };
  });
}
