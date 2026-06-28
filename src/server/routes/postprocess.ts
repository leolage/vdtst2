import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { inputsRoot, outputsRoot } from '../../shared/paths.js';
import { runChain, type Step } from '../../worker/postprocess.js';
import { stitchSegments } from '../../worker/stitch.js';

function safeName(name: string): string { return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80); }

/** Garante que um caminho de asset está sob inputsRoot (anti path traversal). */
function assetOk(p: string): boolean {
  const root = path.resolve(inputsRoot());
  return path.resolve(p).startsWith(root);
}

const stepSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('audio'), asset: z.string().min(1) }),
  z.object({ tipo: z.literal('legenda'), asset: z.string().min(1) }),
  z.object({ tipo: z.literal('scale'), w: z.number().int().positive(), h: z.number().int() }),
  z.object({ tipo: z.literal('interpolate'), fps: z.number().int().positive() }),
]);

export async function postprocessRoutes(app: FastifyInstance) {
  // upload de asset (áudio/narração/legenda) → devolve o caminho no servidor
  app.post('/assets', async (req, reply) => {
    let saved: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const dir = path.join(inputsRoot(), 'assets');
        await mkdir(dir, { recursive: true });
        saved = path.join(dir, `${Date.now()}-${safeName(part.filename || 'asset')}`);
        await pipeline(part.file, createWriteStream(saved));
      }
    }
    if (!saved) return reply.code(400).send({ error: 'arquivo_ausente' });
    return reply.code(201).send({ path: saved });
  });

  // pós-processa um output (cadeia de passos ffmpeg) → cria um novo output
  app.post('/outputs/:id/postprocess', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ steps: z.array(stepSchema).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido', detalhe: parsed.error.issues });

    const o = await db()('outputs').where({ id }).first();
    if (!o?.path) return reply.code(404).send({ error: 'output_sem_video' });

    for (const s of parsed.data.steps) {
      if ((s.tipo === 'audio' || s.tipo === 'legenda') && !assetOk(s.asset)) {
        return reply.code(400).send({ error: 'asset_invalido', detalhe: 'use um asset enviado em /api/assets' });
      }
    }

    const dir = path.join(path.dirname(o.path), 'processed');
    const outFile = path.join(dir, `pos-${Date.now()}.mp4`);
    try {
      await runChain(o.path, parsed.data.steps as Step[], outFile);
    } catch (e) {
      return reply.code(500).send({ error: 'falha_ffmpeg', detalhe: (e as Error).message });
    }
    const [novoId] = await db()('outputs').insert({
      job_id: o.job_id, scene_id: o.scene_id, tipo: 'video', path: outFile,
      is_final: o.is_final, pos: true,
    });
    return reply.code(201).send({ id: novoId, path: outFile });
  });

  // monta um episódio concatenando vários outputs (na ordem dada)
  app.post('/episodes', async (req, reply) => {
    const parsed = z.object({ nome: z.string().min(1).max(200), output_ids: z.array(z.number().int()).min(2) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload_invalido' });

    const rows = await db()('outputs').whereIn('id', parsed.data.output_ids).select('id', 'path');
    const byId = new Map(rows.map((r) => [r.id, r.path as string]));
    const paths = parsed.data.output_ids.map((i) => byId.get(i)).filter(Boolean) as string[];
    if (paths.length < 2) return reply.code(409).send({ error: 'outputs_insuficientes' });

    const dir = path.join(outputsRoot(), 'episodes');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `ep-${Date.now()}.mp4`);
    try {
      await stitchSegments(paths, file);
    } catch (e) {
      return reply.code(500).send({ error: 'falha_ffmpeg', detalhe: (e as Error).message });
    }
    const [id] = await db()('episodes').insert({ nome: parsed.data.nome, path: file, output_ids_json: JSON.stringify(parsed.data.output_ids) });
    return reply.code(201).send({ id, path: file });
  });

  app.get('/episodes', async () => db()('episodes').select('*').orderBy('id', 'desc'));
}
