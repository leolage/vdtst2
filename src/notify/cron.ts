/**
 * wan-cron — tarefas agendadas do sistema.
 *
 * Hoje: a cada hora (alinhado ao início da hora) envia ao Telegram um resumo da fila de
 * jobs. Notificações de vídeo pronto e de erro são por evento (disparadas pelo worker/
 * agente nas fases seguintes), não por cron.
 */
import { db, closeDb } from '../db/knex.js';
import { makeLogger } from '../shared/logger.js';
import { notify } from './telegram.js';

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

/** Milissegundos até o próximo início de hora cheia. */
function msAteProximaHora(): number {
  const agora = new Date();
  const prox = new Date(agora);
  prox.setHours(agora.getHours() + 1, 0, 0, 0);
  return prox.getTime() - agora.getTime();
}

async function main() {
  log.info('wan-cron iniciado (status da fila de hora em hora)');
  const stop = () => { parar = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  // primeira execução: espera até a próxima hora cheia, depois repete a cada hora
  await new Promise((r) => setTimeout(r, msAteProximaHora()));
  while (!parar) {
    try {
      await enviarStatusFila();
    } catch (err) {
      log.error({ err }, 'falha ao enviar status da fila');
    }
    await new Promise((r) => setTimeout(r, 60 * 60 * 1000));
  }
  await closeDb();
  process.exit(0);
}

void main();
