import { createWriteStream } from 'node:fs';
import { mkdir, copyFile, access } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { inputsRoot } from '../../shared/paths.js';

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

export async function imageRoutes(app: FastifyInstance) {
  // ---- categorias ----
  app.get('/image-categories', async () => {
    return db()('image_categories').select('*').orderBy('nome');
  });

  app.post('/image-categories', async (req, reply) => {
    const parsed = z.object({ nome: z.string().min(1).max(120), descricao: z.string().max(500).optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });
    const [id] = await db()('image_categories').insert(parsed.data);
    return reply.code(201).send({ id, ...parsed.data });
  });

  app.delete('/image-categories/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('image_categories').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // ---- imagens ----
  app.get('/images', async (req) => {
    const { category_id } = req.query as { category_id?: string };
    const q = db()('images').select('*').orderBy('id', 'desc');
    if (category_id) q.where({ category_id: Number(category_id) });
    return q;
  });

  // upload (multipart: campo de arquivo "file" + campo "category_id")
  app.post('/images', async (req, reply) => {
    let categoryId: number | null = null;
    let savedPath: string | null = null;

    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'category_id') {
        categoryId = part.value ? Number(part.value) : null;
      } else if (part.type === 'file' && part.fieldname === 'file') {
        const dir = path.join(inputsRoot(), categoryId ? `cat-${categoryId}` : 'sem-categoria');
        await mkdir(dir, { recursive: true });
        savedPath = path.join(dir, `${Date.now()}-${safeName(part.filename || 'img')}`);
        await pipeline(part.file, createWriteStream(savedPath));
      }
    }
    if (!savedPath) return reply.code(400).send({ error: 'arquivo_ausente' });

    const [id] = await db()('images').insert({ category_id: categoryId, path: savedPath });
    return reply.code(201).send({ id, category_id: categoryId, path: savedPath });
  });

  app.delete('/images/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await db()('images').where({ id }).del();
    return reply.code(reply.statusCode).send({ ok: true });
  });

  // ---- promover um frame golden para a biblioteca (encadeamento de cenas) ----
  app.post('/outputs/:id/promote-frame', async (req, reply) => {
    const outputId = Number((req.params as { id: string }).id);
    const parsed = z.object({ frame: z.string().min(1).max(200), category_id: z.number().int().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });

    const output = await db()('outputs').where({ id: outputId }).first();
    if (!output) return reply.code(404).send({ error: 'output_nao_encontrado' });
    if (!output.frames_dir) return reply.code(409).send({ error: 'sem_frames', detalhe: 'Este output não tem frames extraídos.' });

    const src = path.join(output.frames_dir, parsed.data.frame);
    try { await access(src); } catch { return reply.code(404).send({ error: 'frame_inexistente', detalhe: src }); }

    const dir = path.join(inputsRoot(), 'promoted');
    await mkdir(dir, { recursive: true });
    const dest = path.join(dir, `out${outputId}-${safeName(parsed.data.frame)}`);
    await copyFile(src, dest);

    const [id] = await db()('images').insert({
      category_id: parsed.data.category_id ?? null,
      path: dest,
      origem_output_id: outputId,
      origem_frame: parsed.data.frame,
    });
    return reply.code(201).send({ id, path: dest, origem_output_id: outputId, origem_frame: parsed.data.frame });
  });
}
