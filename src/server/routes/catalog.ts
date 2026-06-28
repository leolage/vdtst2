import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { outputsRoot } from '../../shared/paths.js';
import { resolveEffective, type GenBase, type GenOverrides } from '../../domain/effective.js';

/** Caminho relativo à raiz de outputs (para montar a URL em /api/media/...). */
function rel(p: string | null): string | null {
  if (!p) return null;
  const r = path.relative(outputsRoot(), p);
  return r.startsWith('..') ? null : r.split(path.sep).join('/');
}

function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

const loraSpec = z.object({ lora_nome: z.string(), peso: z.number() });
const overridesSchema = z.object({
  texto_pos: z.string().optional(),
  texto_neg: z.string().nullable().optional(),
  image_id: z.number().int().nullable().optional(),
  prompt_id: z.number().int().optional(),
  loras: z.array(loraSpec).optional(),
  frames: z.number().int().nullable().optional(),
  fps: z.number().int().nullable().optional(),
  segmento_idx: z.number().int().optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  // listar jobs (filtros opcionais)
  app.get('/jobs', async (req) => {
    const { status, scene_id } = req.query as { status?: string; scene_id?: string };
    const q = db()('jobs')
      .select('id', 'project_id', 'scene_id', 'prompt_id', 'image_id', 'segmento_idx',
        'status', 'nota', 'observacao', 'erro_categoria', 'output_path', 'criado_em')
      .orderBy('id', 'desc')
      .limit(500);
    if (status) q.where({ status });
    if (scene_id) q.where({ scene_id: Number(scene_id) });
    return q;
  });

  // dar nota / anotar um trabalho (catálogo do que deu certo e do que não)
  app.patch('/jobs/:id/rate', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({
      nota: z.number().int().min(1).max(5).nullable().optional(),
      observacao: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const n = await db()('jobs').where({ id }).update(parsed.data);
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  // catálogo: trabalhos avaliados ou com erro, para consulta do que funciona
  app.get('/catalog', async () => {
    return db()('jobs')
      .select('id', 'scene_id', 'status', 'nota', 'observacao', 'erro_categoria', 'output_path')
      .where((b) => b.whereNotNull('nota').orWhereNotNull('observacao').orWhere({ status: 'error' }))
      .orderBy([{ column: 'nota', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(500);
  });

  // detalhe completo de um job (tela de debug do vídeo)
  app.get('/jobs/:id/detail', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const job = await db()('jobs').where({ id }).first();
    if (!job) return reply.code(404).send({ error: 'nao_encontrado' });

    const [project, scene, prompt, image, loras] = await Promise.all([
      db()('projects').select('id', 'nome', 'node_bindings_json').where({ id: job.project_id }).first(),
      db()('scenes').where({ id: job.scene_id }).first(),
      job.prompt_id ? db()('prompts').where({ id: job.prompt_id }).first() : Promise.resolve(null),
      job.image_id ? db()('images').where({ id: job.image_id }).first() : Promise.resolve(null),
      db()('scene_loras').where({ scene_id: job.scene_id }),
    ]);

    const overrides = asJson<GenOverrides>(job.overrides_json);
    const base: GenBase = {
      texto_pos: prompt?.texto_pos ?? '',
      texto_neg: prompt?.texto_neg ?? null,
      image_id: job.image_id,
      loras: (loras as Array<{ lora_nome: string; peso: number }>).map((l) => ({ lora_nome: l.lora_nome, peso: l.peso })),
      frames: null,
      fps: null,
      segmento_idx: job.segmento_idx,
    };
    const effective = resolveEffective(base, overrides);

    return {
      job: {
        id: job.id, status: job.status, nota: job.nota, observacao: job.observacao,
        erro_categoria: job.erro_categoria, traceback: job.traceback, output_path: job.output_path,
        node_id: job.node_id, comfy_prompt_id: job.comfy_prompt_id, tentativas: job.tentativas,
        params_snapshot: asJson(job.params_json),
      },
      project: project ? { id: project.id, nome: project.nome, bindings: asJson(project.node_bindings_json) } : null,
      scene, prompt, image, loras, overrides, effective,
    };
  });

  // reenviar com ajustes — cria um novo job (não altera o original, preserva o catálogo)
  app.post('/jobs/:id/resubmit', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ overrides: overridesSchema.optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'overrides_invalidos', detalhe: parsed.error.issues });

    const old = await db()('jobs').where({ id }).first();
    if (!old) return reply.code(404).send({ error: 'nao_encontrado' });
    const ov = parsed.data.overrides;

    const [newId] = await db()('jobs').insert({
      project_id: old.project_id,
      scene_id: old.scene_id,
      prompt_id: ov?.prompt_id ?? old.prompt_id,
      image_id: ov?.image_id !== undefined ? ov.image_id : old.image_id,
      segmento_idx: ov?.segmento_idx ?? old.segmento_idx,
      prioridade: old.prioridade,
      status: 'queued',
      overrides_json: ov ? JSON.stringify(ov) : null,
    });
    return reply.code(201).send({ id: newId, origem_job: id });
  });

  // ---- outputs (galeria/golden) ----
  app.get('/outputs', async (req) => {
    const { scene_id, golden, aprovado } = req.query as { scene_id?: string; golden?: string; aprovado?: string };
    const q = db()('outputs').select('*').orderBy('id', 'desc').limit(500);
    if (scene_id) q.where({ scene_id: Number(scene_id) });
    if (golden === 'true') q.where({ golden: true });
    if (aprovado === 'true') q.where({ aprovado: true });
    if (aprovado === 'false') q.where({ aprovado: false });
    const rows = await q;
    return rows.map((o) => ({
      ...o,
      video_rel: rel(o.path),
      thumb_rel: rel(o.thumb_path),
      frames_rel: rel(o.frames_dir),
    }));
  });

  // frames de um output (para revisar e promover)
  app.get('/outputs/:id/frames', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const o = await db()('outputs').where({ id }).first();
    if (!o) return reply.code(404).send({ error: 'nao_encontrado' });
    if (!o.frames_dir) return { frames: [], frames_rel: null };
    try {
      const files = (await readdir(o.frames_dir)).filter((f) => f.startsWith('frame-')).sort();
      return { frames: files, frames_rel: rel(o.frames_dir) };
    } catch {
      return { frames: [], frames_rel: rel(o.frames_dir) };
    }
  });

  // aprovar / reprovar um output (revisão da galeria)
  app.patch('/outputs/:id/approve', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ aprovado: z.boolean().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const n = await db()('outputs').where({ id }).update({ aprovado: parsed.data.aprovado });
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  // marcar/desmarcar uma cena/resultado como golden (perfeito)
  app.patch('/outputs/:id/golden', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ golden: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const n = await db()('outputs').where({ id }).update({ golden: parsed.data.golden });
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });
}
