/**
 * Roteamento de um job para um nó ComfyUI.
 *
 * Escolhe um nó `up` com fila < max_concurrent E que possua os LoRAs/checkpoint exigidos
 * pela cena. Sem capacidade → job fica `blocked` com motivo claro (em vez de falhar na GPU).
 * Função pura, testada.
 */

export interface NodeState {
  id: number;
  status: 'up' | 'down' | 'paused';
  max_concurrent: number;
  queue_len: number;
  vram_free: number | null;
  loras: string[];     // nomes de LoRA disponíveis no nó
  modelos: string[];   // checkpoints disponíveis no nó
}

export interface JobRequirements {
  loras: string[];        // nomes exigidos
  modelo?: string | null; // checkpoint exigido (opcional)
}

export type RouteResult =
  | { ok: true; nodeId: number }
  | { ok: false; categoria: 'NODE_OFFLINE' | 'SEM_CAPACIDADE' | 'FILA_CHEIA'; motivo: string };

function temCapacidade(node: NodeState, req: JobRequirements): boolean {
  if (req.modelo && !node.modelos.includes(req.modelo)) return false;
  return req.loras.every((l) => node.loras.includes(l));
}

export function selectNode(nodes: NodeState[], req: JobRequirements): RouteResult {
  const up = nodes.filter((n) => n.status === 'up');
  if (up.length === 0) return { ok: false, categoria: 'NODE_OFFLINE', motivo: 'Nenhum nó ComfyUI disponível.' };

  const capazes = up.filter((n) => temCapacidade(n, req));
  if (capazes.length === 0) {
    return {
      ok: false,
      categoria: 'SEM_CAPACIDADE',
      motivo: `Nenhum nó possui o necessário (loras: ${req.loras.join(', ') || '—'}${req.modelo ? `, modelo: ${req.modelo}` : ''}).`,
    };
  }

  const livres = capazes.filter((n) => n.queue_len < n.max_concurrent);
  if (livres.length === 0) return { ok: false, categoria: 'FILA_CHEIA', motivo: 'Todos os nós capazes estão com a fila cheia.' };

  // menor fila; desempate por mais VRAM livre
  livres.sort((a, b) => a.queue_len - b.queue_len || (b.vram_free ?? 0) - (a.vram_free ?? 0));
  return { ok: true, nodeId: livres[0].id };
}
