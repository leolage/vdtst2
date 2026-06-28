/**
 * Health-check dos nós ComfyUI: conecta por SSH, abre túnel para a API, lê system_stats /
 * queue / object_info (capacidades) e nvidia-smi (VRAM), e atualiza comfy_nodes.
 *
 * Chamado pelo agente (supervisor) periodicamente e pelo endpoint /nodes/:id/test.
 * I/O real — não testado aqui.
 */
import type { Client } from 'ssh2';
import { db } from '../db/knex.js';
import { decrypt } from '../shared/crypto.js';
import { makeLogger } from '../shared/logger.js';
import { connect, openTunnel, exec } from './ssh.js';
import { ComfyClient, parseCapabilities } from './client.js';
import { parseNvidiaSmi, queueLength } from './nvidia.js';

const log = makeLogger('comfy-health');

export interface NodeRow {
  id: number;
  nome: string;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_key_ref: string;
  comfy_port: number;
}

export interface HealthResult {
  ok: boolean;
  status: 'up' | 'down';
  queue_len?: number;
  vram_total?: number | null;
  vram_free?: number | null;
  loras?: number;
  modelos?: number;
  erro?: string;
}

export async function checkNode(node: NodeRow): Promise<HealthResult> {
  let conn: Client | null = null;
  let tunnelClose: (() => void) | null = null;
  try {
    const privateKey = decrypt(node.ssh_key_ref);
    conn = await connect({ host: node.ssh_host, port: node.ssh_port, username: node.ssh_user, privateKey });
    const tunnel = await openTunnel(conn, node.comfy_port);
    tunnelClose = tunnel.close;
    const client = new ComfyClient(`http://127.0.0.1:${tunnel.localPort}`);

    const [queue, objectInfo, smi] = await Promise.all([
      client.queue(),
      client.objectInfo(),
      exec(conn, 'nvidia-smi --query-gpu=memory.total,memory.free --format=csv,noheader,nounits').catch(() => null),
    ]);

    const cap = parseCapabilities(objectInfo);
    const mem = smi ? parseNvidiaSmi(smi.stdout) : null;
    const queue_len = queueLength(queue);

    await db()('comfy_nodes').where({ id: node.id }).update({
      status: 'up',
      queue_len,
      vram_total: mem?.total ?? null,
      vram_free: mem?.free ?? null,
      modelos_json: JSON.stringify(cap.modelos),
      loras_json: JSON.stringify(cap.loras),
      ultimo_health: db().fn.now(),
    });

    return { ok: true, status: 'up', queue_len, vram_total: mem?.total ?? null, vram_free: mem?.free ?? null, loras: cap.loras.length, modelos: cap.modelos.length };
  } catch (err) {
    await db()('comfy_nodes').where({ id: node.id }).update({ status: 'down', ultimo_health: db().fn.now() });
    log.warn({ node: node.nome, err: (err as Error).message }, 'health falhou');
    return { ok: false, status: 'down', erro: (err as Error).message };
  } finally {
    try { tunnelClose?.(); } catch { /* ignore */ }
    try { conn?.end(); } catch { /* ignore */ }
  }
}

/** Percorre todos os nós e atualiza a saúde de cada um. */
export async function pollAllNodes(): Promise<void> {
  const nodes = await db()('comfy_nodes').select(
    'id', 'nome', 'ssh_host', 'ssh_port', 'ssh_user', 'ssh_key_ref', 'comfy_port',
  );
  await Promise.all((nodes as NodeRow[]).map((n) => checkNode(n).catch(() => undefined)));
}
