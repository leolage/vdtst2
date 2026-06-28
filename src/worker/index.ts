/**
 * wan-worker — executor de jobs (esqueleto da Fase 1).
 *
 * Fase 4 implementa: pegar próximo job com SELECT ... FOR UPDATE SKIP LOCKED, montar o
 * workflow a partir do template + bindings, abrir túnel SSH ao nó, submeter ao ComfyUI,
 * acompanhar por WebSocket, baixar saída e concatenar segmentos com ffmpeg.
 */
import { db, closeDb } from '../db/knex.js';
import { config } from '../config/index.js';
import { makeLogger } from '../shared/logger.js';

const log = makeLogger('wan-worker');
let parar = false;

async function claimNextJob() {
  // Esqueleto do claim atômico (sem efeito até a Fase 4).
  return db().transaction(async (trx) => {
    const job = await trx('jobs')
      .where({ status: 'queued' })
      .orderBy([{ column: 'prioridade', order: 'asc' }, { column: 'id', order: 'asc' }])
      .forUpdate()
      .skipLocked()
      .first();
    return job ?? null;
  });
}

async function main() {
  log.info({ pollMs: config.worker.pollMs }, 'wan-worker iniciado');
  const stop = () => { parar = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (!parar) {
    try {
      const job = await claimNextJob();
      if (job) {
        log.info({ jobId: job.id }, 'job reservado (execução chega na Fase 4)');
      }
    } catch (err) {
      log.error({ err }, 'falha no loop do worker');
    }
    await new Promise((r) => setTimeout(r, config.worker.pollMs));
  }
  await closeDb();
  process.exit(0);
}

void main();
