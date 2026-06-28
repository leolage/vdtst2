/**
 * Guardrail de SAÍDA do agente: allowlist fixa de ações.
 *
 * O LLM só pode escolher entre estas ações, e cada uma aceita APENAS argumentos de
 * metadados (ids, prioridade, mensagem, motivo) — nunca prompt, imagem ou caminho.
 * `validateAction` rejeita qualquer ação fora da lista ou com qualquer chave estranha,
 * então mesmo que o modelo invente um campo de conteúdo, ele é barrado em código.
 *
 * As definições e o validador são puros/testáveis; a execução faz DB/SSH.
 */
import type { Knex } from 'knex';
import type { Client } from 'ssh2';
import { config } from '../config/index.js';
import { decrypt } from '../shared/crypto.js';
import { connect, exec } from '../comfy/ssh.js';
import { notify } from '../notify/telegram.js';

/** Definições das ferramentas no formato de tool-use do Claude. */
export const ACTION_TOOLS = [
  { name: 'dispatch_job', description: 'Liberar um job bloqueado para a fila quando há capacidade.', input_schema: schema(['job_id'], { job_id: int() }) },
  { name: 'retry_job', description: 'Reenfileirar um job que falhou (retry).', input_schema: schema(['job_id'], { job_id: int() }) },
  { name: 'mark_failed', description: 'Desistir de um job, marcando-o como erro definitivo.', input_schema: schema(['job_id'], { job_id: int() }) },
  { name: 'reprioritize', description: 'Mudar a prioridade de um job (menor = mais cedo).', input_schema: schema(['job_id', 'prioridade'], { job_id: int(), prioridade: int() }) },
  { name: 'pause_node', description: 'Pausar um nó ComfyUI (não recebe novos jobs).', input_schema: schema(['node_id'], { node_id: int() }) },
  { name: 'resume_node', description: 'Retomar um nó ComfyUI pausado.', input_schema: schema(['node_id'], { node_id: int() }) },
  { name: 'restart_node', description: 'Reiniciar o processo do ComfyUI num nó travado (via SSH).', input_schema: schema(['node_id'], { node_id: int() }) },
  { name: 'escalate', description: 'Notificar o operador humano sobre algo que precisa de atenção.', input_schema: schema(['mensagem'], { mensagem: str() }) },
] as const;

type ActionName = (typeof ACTION_TOOLS)[number]['name'];

const ALLOWED_KEYS: Record<ActionName, string[]> = {
  dispatch_job: ['job_id', 'motivo'],
  retry_job: ['job_id', 'motivo'],
  mark_failed: ['job_id', 'motivo'],
  reprioritize: ['job_id', 'prioridade', 'motivo'],
  pause_node: ['node_id', 'motivo'],
  resume_node: ['node_id', 'motivo'],
  restart_node: ['node_id', 'motivo'],
  escalate: ['mensagem', 'motivo'],
};

const NAMES = new Set<string>(ACTION_TOOLS.map((a) => a.name));

export interface ValidAction { name: ActionName; input: Record<string, unknown> }
export type ValidationResult = { ok: true; action: ValidAction } | { ok: false; reason: string };

/** Valida nome + chaves contra a allowlist. Puro. Barra qualquer campo de conteúdo. */
export function validateAction(name: string, input: unknown): ValidationResult {
  if (!NAMES.has(name)) return { ok: false, reason: `ação desconhecida: ${name}` };
  if (!input || typeof input !== 'object') return { ok: false, reason: 'input inválido' };
  const allowed = ALLOWED_KEYS[name as ActionName];
  for (const k of Object.keys(input as object)) {
    if (!allowed.includes(k)) return { ok: false, reason: `campo não permitido em ${name}: ${k}` };
  }
  return { ok: true, action: { name: name as ActionName, input: input as Record<string, unknown> } };
}

/** Executa uma ação já validada e registra em agent_decisions. I/O (DB/SSH). */
export async function executeAction(db: Knex, a: ValidAction): Promise<string> {
  const motivo = typeof a.input.motivo === 'string' ? a.input.motivo : null;
  let resultado = 'ok';

  switch (a.name) {
    case 'dispatch_job':
      await db('jobs').where({ id: Number(a.input.job_id) }).whereIn('status', ['blocked']).update({ status: 'queued', erro_categoria: null, traceback: null });
      break;
    case 'retry_job':
      await db('jobs').where({ id: Number(a.input.job_id) }).whereIn('status', ['error', 'blocked']).update({ status: 'queued', erro_categoria: null, traceback: null });
      break;
    case 'mark_failed':
      await db('jobs').where({ id: Number(a.input.job_id) }).update({ status: 'error', erro_categoria: 'DESISTIDO' });
      break;
    case 'reprioritize':
      await db('jobs').where({ id: Number(a.input.job_id) }).update({ prioridade: Number(a.input.prioridade) });
      break;
    case 'pause_node':
      await db('comfy_nodes').where({ id: Number(a.input.node_id) }).update({ status: 'paused' });
      break;
    case 'resume_node':
      await db('comfy_nodes').where({ id: Number(a.input.node_id) }).update({ status: 'up' });
      break;
    case 'restart_node':
      resultado = await restartNode(db, Number(a.input.node_id));
      break;
    case 'escalate':
      await notify.escalar(String(a.input.mensagem));
      resultado = 'notificado';
      break;
  }

  await db('agent_decisions').insert({ acao: a.name, alvo_json: JSON.stringify(a.input), motivo, custo_tokens: null });
  return resultado;
}

async function restartNode(db: Knex, nodeId: number): Promise<string> {
  const node = await db('comfy_nodes').where({ id: nodeId }).first();
  if (!node) return 'nó não encontrado';
  let conn: Client | null = null;
  try {
    conn = await connect({ host: node.ssh_host, port: node.ssh_port, username: node.ssh_user, privateKey: decrypt(node.ssh_key_ref) });
    const r = await exec(conn, config.comfy.restartCmd);
    return r.code === 0 ? 'reiniciado' : `falha (${r.code}): ${r.stderr.slice(-200)}`;
  } finally {
    try { conn?.end(); } catch { /* ignore */ }
  }
}

// helpers de schema JSON (sem campos de conteúdo)
function int() { return { type: 'integer' as const }; }
function str() { return { type: 'string' as const }; }
function schema(required: string[], props: Record<string, unknown>) {
  return {
    type: 'object' as const,
    properties: { ...props, motivo: { type: 'string', description: 'por que esta ação (curto)' } },
    required,
    additionalProperties: false,
  };
}
