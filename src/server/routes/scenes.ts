import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { explodeScene } from '../../domain/jobs.js';

export async function sceneRoutes(app: FastifyInstance) {
  // ---- cenas ----
  app.get('/projects/:id/scenes', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return db()('scenes').where({ project_id: projectId }).orderBy('ordem').orderBy('id');
  });

  app.post('/projects/:id/scenes', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const parsed = z.object({
      nome: z.string().min(1).max(200),
      ordem: z.number().int().optional(),
      categoria_id: z.number().int().nullable().optional(),
      segmentos: z.number().int().min(1).optional(),
      dur_segmento: z.number().positive().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const [id] = await db()('scenes').insert({ project_id: projectId, ...parsed.data });
    return reply.code(201).send({ id, project_id: projectId, ...parsed.data });
  });

  app.get('/scenes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const scene = await db()('scenes').where({ id }).first();
    if (!scene) return reply.code(404).send({ error: 'nao_encontrado' });
    const [prompts, loras, sceneImages] = await Promise.all([
      db()('prompts').where({ scene_id: id }).orderBy('ordem').orderBy('id'),
      db()('scene_loras').where({ scene_id: id }),
      db()('scene_images').where({ scene_id: id }).pluck('image_id'),
    ]);
    return { ...scene, prompts, loras, image_ids: sceneImages };
  });

  app.patch('/scenes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({
      nome: z.string().min(1).max(200).optional(),
      ordem: z.number().int().optional(),
      categoria_id: z.number().int().nullable().optional(),
      segmentos: z.number().int().min(1).optional(),
      dur_segmento: z.number().positive().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const n = await db()('scenes').where({ id }).update(parsed.data);
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  app.delete('/scenes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('scenes').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // ---- prompts ----
  app.post('/scenes/:id/prompts', async (req, reply) => {
    const sceneId = Number((req.params as { id: string }).id);
    const parsed = z.object({
      texto_pos: z.string().min(1),
      texto_neg: z.string().optional(),
      ordem: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const [id] = await db()('prompts').insert({ scene_id: sceneId, ...parsed.data });
    return reply.code(201).send({ id, scene_id: sceneId, ...parsed.data });
  });

  app.patch('/prompts/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({
      texto_pos: z.string().min(1).optional(),
      texto_neg: z.string().optional(),
      ordem: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const n = await db()('prompts').where({ id }).update(parsed.data);
    if (!n) return reply.code(404).send({ error: 'nao_encontrado' });
    return { ok: true };
  });

  app.delete('/prompts/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('prompts').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // ---- loras da cena ----
  app.post('/scenes/:id/loras', async (req, reply) => {
    const sceneId = Number((req.params as { id: string }).id);
    const parsed = z.object({ lora_nome: z.string().min(1).max(255), peso: z.number().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const [id] = await db()('scene_loras').insert({ scene_id: sceneId, lora_nome: parsed.data.lora_nome, peso: parsed.data.peso ?? 1.0 });
    return reply.code(201).send({ id });
  });

  app.delete('/loras/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('scene_loras').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // ---- imagens da cena (substitui o conjunto) ----
  app.put('/scenes/:id/images', async (req, reply) => {
    const sceneId = Number((req.params as { id: string }).id);
    const parsed = z.object({ image_ids: z.array(z.number().int()) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    await db().transaction(async (trx) => {
      await trx('scene_images').where({ scene_id: sceneId }).del();
      if (parsed.data.image_ids.length) {
        await trx('scene_images').insert(parsed.data.image_ids.map((image_id) => ({ scene_id: sceneId, image_id })));
      }
    });
    return { ok: true, total: parsed.data.image_ids.length };
  });

  // ---- gerar jobs (explosão da cena) ----
  app.post('/scenes/:id/generate-jobs', async (req, reply) => {
    const sceneId = Number((req.params as { id: string }).id);
    const scene = await db()('scenes').where({ id: sceneId }).first();
    if (!scene) return reply.code(404).send({ error: 'nao_encontrado' });

    const [promptIds, imageIds] = await Promise.all([
      db()('prompts').where({ scene_id: sceneId }).pluck('id'),
      db()('scene_images').where({ scene_id: sceneId }).pluck('image_id'),
    ]);

    const seeds = explodeScene({
      projectId: scene.project_id, sceneId, segmentos: scene.segmentos, promptIds, imageIds,
    });
    if (seeds.length === 0) return reply.code(409).send({ error: 'sem_prompts', detalhe: 'Adicione ao menos um prompt antes de gerar jobs.' });

    await db()('jobs').insert(seeds);
    return reply.code(201).send({ criados: seeds.length });
  });
}
