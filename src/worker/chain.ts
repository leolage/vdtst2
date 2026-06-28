/**
 * Encadeamento de segmentos no worker.
 *
 * Ao concluir um segmento:
 *  - se há um próximo (depende_de = este job, status waiting), promove o ÚLTIMO frame deste
 *    segmento a imagem de input do próximo e o libera para a fila (continuidade);
 *  - se é o último da cadeia, concatena todos os segmentos num vídeo final (is_final).
 *
 * Se um segmento falha, a cadeia downstream é abortada para não ficar pendurada.
 */
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { Knex } from 'knex';
import { makeLogger } from '../shared/logger.js';
import { inputsRoot, chainFinalPath } from '../shared/paths.js';
import { stitchSegments } from './stitch.js';
import { notify } from '../notify/telegram.js';

const log = makeLogger('chain');

async function lastFrameFile(framesDir: string): Promise<string | null> {
  try {
    const files = (await readdir(framesDir)).filter((f) => f.startsWith('frame-')).sort();
    return files.length ? files[files.length - 1] : null;
  } catch { return null; }
}

export interface ChainCtx { framesDir: string; framesCount: number; outputId: number }

/** Avança a cadeia após um segmento concluir com sucesso. */
export async function advanceChain(db: Knex, job: Record<string, unknown>, ctx: ChainCtx): Promise<void> {
  if (!job.chain_key) return;
  const next = await db('jobs').where({ depende_de: Number(job.id), status: 'waiting' }).first();

  if (next) {
    let imageId = next.image_id;
    const frame = ctx.framesCount > 0 ? await lastFrameFile(ctx.framesDir) : null;
    if (frame) {
      const dir = path.join(inputsRoot(), 'chain');
      await mkdir(dir, { recursive: true });
      const dest = path.join(dir, `out${ctx.outputId}-${frame}`);
      await copyFile(path.join(ctx.framesDir, frame), dest);
      const [id] = await db('images').insert({ category_id: null, path: dest, origem_output_id: ctx.outputId, origem_frame: frame });
      imageId = Number(id);
    } else {
      log.warn({ job: job.id }, 'sem frame para continuidade; próximo segmento usa a imagem original');
    }
    await db('jobs').where({ id: next.id }).update({ image_id: imageId, status: 'queued', agendado_para: null });
    log.info({ chain: job.chain_key, next: next.id, frame }, 'próximo segmento liberado');
    return;
  }

  // sem próximo → pode ser o fim da cadeia
  await maybeStitch(db, job);
}

async function maybeStitch(db: Knex, job: Record<string, unknown>): Promise<void> {
  const chainKey = String(job.chain_key);
  const pendentes = await db('jobs').where({ chain_key: chainKey }).whereNotIn('status', ['done', 'error']).count<{ c: number }[]>('* as c');
  if (Number(pendentes[0].c) > 0) return; // ainda há segmentos rodando/esperando

  const segs = await db('jobs').where({ chain_key: chainKey, status: 'done' })
    .orderBy('segmento_idx').select('output_path', 'scene_id', 'project_id');
  const paths = segs.map((s) => s.output_path).filter(Boolean) as string[];
  if (paths.length < 2) return; // nada a concatenar

  const projectId = Number(job.project_id);
  const sceneId = Number(job.scene_id);
  const final = chainFinalPath(projectId, sceneId, chainKey);
  try {
    await stitchSegments(paths, final);
    await db('outputs').insert({ job_id: null, scene_id: sceneId, tipo: 'video', path: final, is_final: true });
    log.info({ chain: chainKey, segmentos: paths.length, final }, 'vídeo final concatenado');
    await notify.videoPronto(final, `cena ${sceneId} (final, ${paths.length} segmentos)`);
  } catch (err) {
    log.error({ chain: chainKey, err: (err as Error).message }, 'falha ao concatenar segmentos');
  }
}

/** Aborta a cadeia downstream quando um segmento falha (evita jobs waiting pendurados). */
export async function abortChainDownstream(db: Knex, job: Record<string, unknown>): Promise<void> {
  if (!job.chain_key) return;
  const n = await db('jobs').where({ chain_key: String(job.chain_key), status: 'waiting' })
    .update({ status: 'error', erro_categoria: 'CHAIN_ABORTADA' });
  if (n) log.warn({ chain: job.chain_key, abortados: n }, 'cadeia abortada após falha de segmento');
}
