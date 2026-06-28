/**
 * Guardrails de ENTRADA do agente.
 *
 * Regra inviolável: prompts (texto_pos/texto_neg) e imagens (path) NUNCA entram no
 * contexto enviado ao LLM. Tudo que o agente vê passa por estas funções, que operam
 * sobre uma allowlist de campos sem conteúdo.
 *
 * As funções puras (projectJobForAgent, sanitizeTraceback, classifyError) são cobertas
 * por test/agent-guardrails.test.ts, que falha o build se algum conteúdo vazar.
 */
import type { Knex } from 'knex';

/** Categorias de erro que o agente enxerga — nunca o traceback cru de origem. */
export type ErroCategoria =
  | 'OOM_VRAM'
  | 'MODELO_AUSENTE'
  | 'NODE_OFFLINE'
  | 'TIMEOUT'
  | 'DESCONHECIDO';

/** Linha crua de job vinda do banco (superset; só usamos campos sem conteúdo). */
export interface RawJobRow {
  id: number;
  scene_id: number;
  status: string;
  node_id: number | null;
  tentativas: number;
  prioridade: number;
  erro_categoria: string | null;
  traceback: string | null;
  agendado_para: string | null;
}

/** Visão SEGURA de um job, sem nenhum conteúdo criativo. */
export interface AgentJobView {
  id: number;
  scene_ref: string; // identificador opaco — não revela nome/conteúdo da cena
  status: string;
  node_id: number | null;
  tentativas: number;
  prioridade: number;
  erro_categoria: ErroCategoria | null;
}

/** Classifica um traceback em categoria; o agente decide pela categoria, não pelo texto. */
export function classifyError(traceback: string | null): ErroCategoria | null {
  if (!traceback) return null;
  const t = traceback.toLowerCase();
  if (t.includes('out of memory') || t.includes('cuda oom') || t.includes('allocate')) return 'OOM_VRAM';
  if (t.includes('no such file') || t.includes('not found') || t.includes('missing') || t.includes('checkpoint'))
    return 'MODELO_AUSENTE';
  if (t.includes('connection refused') || t.includes('econnrefused') || t.includes('offline')) return 'NODE_OFFLINE';
  if (t.includes('timeout') || t.includes('timed out')) return 'TIMEOUT';
  return 'DESCONHECIDO';
}

/**
 * Remove de um texto de erro qualquer coisa que possa ecoar conteúdo criativo:
 * - substrings que casem com prompts conhecidos;
 * - strings citadas longas (heurística para texto livre).
 * Mesmo assim, o traceback sanitizado NÃO é enviado ao LLM por padrão — só a categoria.
 */
export function sanitizeTraceback(traceback: string | null, knownPrompts: string[] = []): string {
  if (!traceback) return '';
  let out = traceback;
  for (const p of knownPrompts) {
    const trimmed = p.trim();
    if (trimmed.length >= 8 && out.includes(trimmed)) {
      out = out.split(trimmed).join('«redigido»');
    }
  }
  // remove strings citadas com mais de 24 chars (provável texto livre/prompt)
  out = out.replace(/(['"])(.{24,}?)\1/g, '$1«redigido»$1');
  return out;
}

/** Projeta uma linha crua de job na visão segura. Função pura, testada no CI. */
export function projectJobForAgent(row: RawJobRow): AgentJobView {
  return {
    id: row.id,
    scene_ref: `s-${row.scene_id}`,
    status: row.status,
    node_id: row.node_id,
    tentativas: row.tentativas,
    prioridade: row.prioridade,
    erro_categoria: (row.erro_categoria as ErroCategoria) ?? classifyError(row.traceback),
  };
}

/** Visão segura de um nó ComfyUI (sem credenciais SSH). */
export interface AgentNodeView {
  id: number;
  nome: string;
  status: string;
  max_concurrent: number;
  queue_len: number;
  vram_free: number | null;
  vram_total: number | null;
  ultimo_health: string | null;
}

export interface AgentContext {
  geradoEm: string;
  jobs: AgentJobView[];
  nodes: AgentNodeView[];
  resumo: { queued: number; running: number; blocked: number; error: number };
}

/**
 * Monta TODO o contexto que vai ao LLM. Seleciona apenas colunas sem conteúdo —
 * texto_pos/texto_neg/images.path nunca são lidos aqui.
 */
export async function buildAgentContext(knex: Knex, nowIso: string): Promise<AgentContext> {
  const jobRows: RawJobRow[] = await knex('jobs')
    .select('id', 'scene_id', 'status', 'node_id', 'tentativas', 'prioridade', 'erro_categoria', 'traceback', 'agendado_para')
    .whereIn('status', ['queued', 'blocked', 'running', 'error'])
    .orderBy([{ column: 'prioridade', order: 'asc' }, { column: 'id', order: 'asc' }])
    .limit(200);

  const nodeRows = await knex('comfy_nodes').select(
    'id', 'nome', 'status', 'max_concurrent', 'queue_len', 'vram_free', 'vram_total', 'ultimo_health',
  );

  const jobs = jobRows.map(projectJobForAgent);
  const resumo = { queued: 0, running: 0, blocked: 0, error: 0 };
  for (const j of jobs) {
    if (j.status in resumo) (resumo as Record<string, number>)[j.status]++;
  }

  return {
    geradoEm: nowIso,
    jobs,
    nodes: nodeRows as AgentNodeView[],
    resumo,
  };
}
