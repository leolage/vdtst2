/**
 * Notificações via Telegram (bot → grupo).
 *
 * Três gatilhos no sistema:
 *  - vídeo novo concluído  → enviado assim que o job termina (evento, Fase 4/6)
 *  - erro de job           → enviado quando um job falha (evento, Fase 6)
 *  - status da fila        → resumo de hora em hora (cron, ver src/notify/cron.ts)
 *
 * O módulo só age se TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID estiverem configurados;
 * caso contrário, vira no-op (não quebra o sistema). NÃO há aqui restrição de conteúdo:
 * estas mensagens vão para VOCÊ, não para o LLM — os guardrails do agente são outra coisa.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { makeLogger } from '../shared/logger.js';

const log = makeLogger('telegram');

function enabled(): boolean {
  return Boolean(config.telegram.botToken && config.telegram.chatId);
}

function api(method: string): string {
  return `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;
}

/** Envia uma mensagem de texto ao grupo. */
export async function sendMessage(text: string): Promise<void> {
  if (!enabled()) return;
  try {
    const res = await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegram.chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) log.warn({ status: res.status }, 'falha ao enviar mensagem ao Telegram');
  } catch (err) {
    log.warn({ err }, 'erro de rede ao enviar mensagem ao Telegram');
  }
}

/** Envia um vídeo (arquivo local) ao grupo, com legenda opcional. */
export async function sendVideo(filePath: string, caption?: string): Promise<void> {
  if (!enabled()) return;
  try {
    const data = await readFile(filePath);
    const form = new FormData();
    form.append('chat_id', String(config.telegram.chatId));
    if (caption) form.append('caption', caption);
    form.append('video', new Blob([data]), path.basename(filePath));
    const res = await fetch(api('sendVideo'), { method: 'POST', body: form });
    if (!res.ok) log.warn({ status: res.status, filePath }, 'falha ao enviar vídeo ao Telegram');
  } catch (err) {
    log.warn({ err, filePath }, 'erro ao enviar vídeo ao Telegram');
  }
}

/** Atalhos semânticos usados pelos gatilhos do sistema. */
export const notify = {
  videoPronto: (filePath: string, cena: string) =>
    sendVideo(filePath, `🎬 Vídeo pronto — ${cena}`),

  erroJob: (jobId: number, categoria: string) =>
    sendMessage(`❌ <b>Job ${jobId} falhou</b>\nCategoria: <code>${categoria}</code>`),

  statusFila: (r: { queued: number; running: number; blocked: number; error: number }) =>
    sendMessage(
      `📊 <b>Status da fila</b>\n` +
        `Na fila: ${r.queued}\nRodando: ${r.running}\n` +
        `Bloqueados: ${r.blocked}\nErros: ${r.error}`,
    ),
};
