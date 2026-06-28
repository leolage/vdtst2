/**
 * Inserção de jobs com encadeamento e stagger. Usado pela rota de cenas (geração manual)
 * e pelo agendador. I/O sobre o banco; a montagem das unidades é pura (domain/chaining).
 */
import type { Knex } from 'knex';
import { staggerTimes } from '../domain/schedule.js';
import { buildUnits, chainKeyOf, type ScenePlan } from '../domain/chaining.js';

export interface InsertOpts {
  staggerMin?: number;
  baseTime?: Date;
}

/** Insere os jobs dos planos de cena; retorna quantos foram criados. */
export async function insertJobs(db: Knex, plans: ScenePlan[], opts: InsertOpts = {}): Promise<number> {
  const units = buildUnits(plans);
  const times = staggerTimes(units.length, opts.staggerMin ?? 0, opts.baseTime ?? new Date());
  let criados = 0;

  for (let u = 0; u < units.length; u++) {
    const unit = units[u];
    const at = times[u];

    if (unit.length === 1) {
      await db('jobs').insert({ ...unit[0], agendado_para: at });
      criados++;
      continue;
    }

    // cadeia: só o 1º segmento entra na fila; os demais ficam waiting, ligados em sequência
    const chain_key = chainKeyOf(unit[0]);
    let prevId: number | null = null;
    for (let i = 0; i < unit.length; i++) {
      const row: Record<string, unknown> = {
        ...unit[i],
        chain_key,
        status: i === 0 ? 'queued' : 'waiting',
        agendado_para: i === 0 ? at : null,
        depende_de: prevId,
      };
      const inserted = (await db('jobs').insert(row)) as number[];
      prevId = Number(inserted[0]);
      criados++;
    }
  }
  return criados;
}
