/**
 * wan-cron — tarefas periódicas.
 *
 *  - a cada minuto: avalia os schedules e gera jobs no tempo certo (agendamento "novela");
 *  - de hora em hora: envia ao Telegram o resumo da fila.
 *
 * Notificações de vídeo pronto e de erro são por evento (worker/agente), não por cron.
 */
import { db, closeDb } from '../db/knex.js';
import { makeLogger } from '../shared/logger.js';
import { notify } from './telegram.js';
import { evaluateSchedules } from '../scheduler/run.js';

const log = makeLogger('wan-cron');
let parar = false;

async function enviarStatusFila() {
  const rows = await db()('jobs')
    .select('status')
    .count<{ status: string; n: number }[]>('* as n')
    .whereIn('status', ['queued', 'running', 'blocked', 'error'])
    .groupBy('status');
  const resumo = { queued: 0, running: 0, blocked: 0, error: 0 };
  for (const r of rows as Array<{ status: string; n: number | string }>) {
    if (r.status in resumo) (resumo as Record<string, number>)[r.status] = Number(r.n);
  }
  log.info({ resumo }, 'status horário da fila');
  await notify.statusFila(resumo);
}

async function main() {
  log.info('wan-cron iniciado (schedules a cada minuto, status de hora em hora)');
  const stop = () => { parar = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  let ultimaHoraStatus = -1;
  while (!parar) {
    const agora = new Date();
    try {
      await evaluateSchedules(db(), agora);
    } catch (err) {
      log.error({ err }, 'falha ao avaliar schedules');
    }
    // status no topo de cada hora (uma vez por hora)
    if (agora.getMinutes() === 0 && agora.getHours() !== ultimaHoraStatus) {
      ultimaHoraStatus = agora.getHours();
      await enviarStatusFila().catch((err) => log.error({ err }, 'falha no status da fila'));
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
  await closeDb();
  process.exit(0);
}

void main();
