import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { isApiFormat, detectBindings, type Bindings } from '../../workflow/parse.js';

/** Campos JSON podem voltar como string (mysql2) — normaliza para objeto. */
function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v as T;
}

const nomeSchema = z.object({ nome: z.string().min(1).max(200) });

const nodeRef = z.object({ node: z.string(), input: z.string() });
const bindingsSchema = z.object({
  prompt_pos: nodeRef.optional(),
  prompt_neg: nodeRef.optional(),
  image: nodeRef.optional(),
  loras: z.array(z.object({ node: z.string(), name_input: z.string(), weight_input: z.string() })).default([]),
  frames: nodeRef.optional(),
  fps: nodeRef.optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  // listar
  app.get('/projects', async () => {
    const rows = await db()('projects')
      .select('id', 'nome', 'status', 'created_at', 'updated_at')
      .select(db().raw('workflow_json IS NOT NULL as tem_workflow'))
      .orderBy('id', 'desc');
    return rows.map((r) => ({ ...r, tem_workflow: Boolean(r.tem_workflow) }));
  });

  // criar
  app.post('/projects', async (req, reply) => {
    const parsed = nomeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const [id] = await db()('projects').insert({ nome: parsed.data.nome, status: 'rascunho' });
    return reply.code(201).send({ id, nome: parsed.data.nome, status: 'rascunho' });
  });

  // detalhe
  app.get('/projects/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = await db()('projects').where({ id }).first();
    if (!row) return reply.code(404).send({ error: 'nao_encontrado' });
    return {
      ...row,
      workflow_json: asJson(row.workflow_json),
      node_bindings_json: asJson(row.node_bindings_json),
    };
  });

  // atualizar nome/status
  app.patch('/projects/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const schema = z.object({
      nome: z.string().min(1).max(200).optional(),
      status: z.enum(['rascunho', 'pronto', 'arquivado']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const n = await db()('projects').where({ id }).update(parsed.data);
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  // excluir
  app.delete('/projects/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const n = await db()('projects').where({ id }).del();
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  // upload do workflow (JSON API-format) → parseia e guarda binding sugerido
  app.post('/projects/:id/workflow', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const project = await db()('projects').where({ id }).first();
    if (!project) return reply.code(404).send({ error: 'nao_encontrado' });

    const wf = req.body;
    if (!isApiFormat(wf)) {
      return reply.code(400).send({
        error: 'workflow_invalido',
        detalhe: 'Envie o JSON no formato API do ComfyUI (Save (API Format)), não o workflow de UI.',
      });
    }

    const result = detectBindings(wf);
    await db()('projects').where({ id }).update({
      workflow_json: JSON.stringify(wf),
      node_bindings_json: JSON.stringify(result.suggested),
    });
    return result; // { nodes, suggested, warnings }
  });

  // re-parsear o workflow guardado (para a tela de binding)
  app.get('/projects/:id/parse', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = await db()('projects').where({ id }).first();
    if (!row) return reply.code(404).send({ error: 'nao_encontrado' });
    const wf = asJson<Record<string, never>>(row.workflow_json);
    if (!wf || !isApiFormat(wf)) return reply.code(409).send({ error: 'sem_workflow' });
    const result = detectBindings(wf);
    return { ...result, bindings: asJson<Bindings>(row.node_bindings_json) ?? result.suggested };
  });

  // salvar bindings confirmados
  app.put('/projects/:id/bindings', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = bindingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bindings_invalidos', detalhe: parsed.error.issues });
    const project = await db()('projects').where({ id }).first();
    if (!project) return reply.code(404).send({ error: 'nao_encontrado' });
    // exige ao menos prompt positivo para considerar "pronto"
    const pronto = Boolean(parsed.data.prompt_pos);
    await db()('projects').where({ id }).update({
      node_bindings_json: JSON.stringify(parsed.data),
      status: pronto ? 'pronto' : 'rascunho',
    });
    return { ok: true, status: pronto ? 'pronto' : 'rascunho' };
  });
}
