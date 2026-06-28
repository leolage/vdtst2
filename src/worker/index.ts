/**
 * wan-worker — reserva jobs `queued` e os executa no ComfyUI (Fase 4).
 *
 * Claim atômico com SELECT ... FOR UPDATE SKIP LOCKED para permitir vários workers em
 * paralelo sem pegar o mesmo job.
 */
import { db, closeDb } from '../db/knex.js';
import { config } from '../config/index.js';
import { makeLogger } from '../shared/logger.js';
import { processJob } from './pipeline.js';

const log = makeLogger('wan-worker');
let parar = false;

async function claimNextJob(): Promise<Record<string, unknown> | null> {
  return db().transaction(async (trx) => {
    const job = await trx('jobs')
      .where({ status: 'queued' })
      .andWhere((b) => b.whereNull('agendado_para').orWhere('agendado_para', '<=', trx.fn.now()))
      .orderBy([{ column: 'prioridade', order: 'asc' }, { column: 'id', order: 'asc' }])
      .forUpdate().skipLocked().first();
    if (!job) return null;
    await trx('jobs').where({ id: job.id }).update({ status: 'running' });
    return job;
  });
}

async function main() {
  log.info({ pollMs: config.worker.pollMs }, 'wan-worker iniciado');
  const stop = () => { parar = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (!parar) {
    let trabalhou = false;
    try {
      const job = await claimNextJob();
      if (job) { trabalhou = true; await processJob(job); }
    } catch (err) {
      log.error({ err }, 'falha no loop do worker');
    }
    if (!trabalhou) await new Promise((r) => setTimeout(r, config.worker.pollMs));
  }
  await closeDb();
  process.exit(0);
}

void main();
