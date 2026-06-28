/**
 * Executor do agendador: avalia os schedules ativos e gera jobs no tempo certo,
 * espaçando-os (stagger) e respeitando um teto de fila. É o que dá o "agendei a novela
 * e ela vai saindo sozinha".
 */
import type { Knex } from 'knex';
import { makeLogger } from '../shared/logger.js';
import { explodeScene, type JobSeed } from '../domain/jobs.js';
import { deveRodar, proximoRun, staggerTimes, type Regra } from '../domain/schedule.js';

const log = makeLogger('scheduler');

function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

export interface RunResult { criados: number; motivo?: string }

/** Gera os jobs de um schedule (sem checar o relógio). Usado pelo loop e pelo "rodar agora". */
async function gerarDoSchedule(db: Knex, row: Record<string, unknown>, now: Date): Promise<RunResult> {
  const regra = asJson<Regra>(row.regra_json);
  if (!regra) return { criados: 0, motivo: 'regra inválida' };

  if (regra.max_fila != null) {
    const [{ c }] = await db('jobs').where({ status: 'queued' }).count<{ c: number }[]>('* as c');
    if (Number(c) >= regra.max_fila) return { criados: 0, motivo: 'fila cheia' };
  }

  const projectId = Number(row.project_id);
  const sceneIds = regra.scene_ids?.length
    ? regra.scene_ids
    : await db('scenes').where({ project_id: projectId }).pluck('id');

  const seeds: JobSeed[] = [];
  for (const sceneId of sceneIds) {
    const scene = await db('scenes').where({ id: sceneId }).first();
    if (!scene) continue;
    const [promptIds, imageIds] = await Promise.all([
      db('prompts').where({ scene_id: sceneId }).pluck('id'),
      db('scene_images').where({ scene_id: sceneId }).pluck('image_id'),
    ]);
    seeds.push(...explodeScene({ projectId, sceneId: Number(sceneId), segmentos: scene.segmentos, promptIds, imageIds }));
  }
  if (seeds.length === 0) return { criados: 0, motivo: 'nada para gerar (sem cenas/prompts)' };

  const times = staggerTimes(seeds.length, regra.stagger_min ?? 0, now);
  await db('jobs').insert(seeds.map((s, i) => ({ ...s, agendado_para: times[i] })));
  return { criados: seeds.length };
}

/** Avalia todos os schedules ativos e dispara os que devem rodar. */
export async function evaluateSchedules(db: Knex, now: Date): Promise<void> {
  const schedules = await db('schedules').where({ ativo: true });
  for (const row of schedules) {
    const regra = asJson<Regra>(row.regra_json);
    if (!regra) continue;
    const ultimo = row.ultimo_run ? new Date(row.ultimo_run as string) : null;
    if (!deveRodar(regra, ultimo, now)) continue;

    const res = await gerarDoSchedule(db, row, now);
    if (res.criados > 0) {
      await db('schedules').where({ id: row.id }).update({ ultimo_run: now, proximo_run: proximoRun(regra, now, now) });
      log.info({ schedule: row.id, criados: res.criados }, 'schedule disparado');
    } else {
      log.debug({ schedule: row.id, motivo: res.motivo }, 'schedule não gerou (tentará de novo)');
    }
  }
}

/** Dispara um schedule específico imediatamente (botão "rodar agora"). */
export async function runScheduleNow(db: Knex, id: number, now: Date): Promise<RunResult> {
  const row = await db('schedules').where({ id }).first();
  if (!row) return { criados: 0, motivo: 'não encontrado' };
  const res = await gerarDoSchedule(db, row, now);
  const regra = asJson<Regra>(row.regra_json);
  if (res.criados > 0 && regra) {
    await db('schedules').where({ id }).update({ ultimo_run: now, proximo_run: proximoRun(regra, now, now) });
  }
  return res;
}
