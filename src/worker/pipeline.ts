/**
 * Pipeline de execução de UM job no ComfyUI.
 *
 *   carrega cena/prompt/imagem/loras → resolve efetivos → roteia para um nó →
 *   abre túnel SSH → (envia imagem) → injeta no workflow → POST /prompt →
 *   aguarda /history → baixa vídeo → extrai frames (no nó, mais parrudo) →
 *   registra output → notifica Telegram.
 *
 * I/O real (SSH/ComfyUI) — não testado neste ambiente; usa peças puras já testadas.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from 'ssh2';
import { db } from '../db/knex.js';
import { config } from '../config/index.js';
import { makeLogger } from '../shared/logger.js';
import { decrypt } from '../shared/crypto.js';
import { connect, openTunnel } from '../comfy/ssh.js';
import { ComfyClient } from '../comfy/client.js';
import { resolveEffective, type GenBase, type GenOverrides } from '../domain/effective.js';
import { buildPrompt } from '../workflow/inject.js';
import type { ApiWorkflow, Bindings } from '../workflow/parse.js';
import { selectNode, type NodeState } from './router.js';
import { classifyError } from '../agent/context.js';
import { extractLocal, extractRemote } from './frames.js';
import { jobDir, videoPath, framesDir } from '../shared/paths.js';
import { notify } from '../notify/telegram.js';
import { advanceChain, abortChainDownstream } from './chain.js';

const log = makeLogger('worker');

function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

/** Detecta o checkpoint exigido pelo workflow (para roteamento por capacidade). */
function requiredModel(template: ApiWorkflow): string | null {
  const CKPT = ['CheckpointLoaderSimple', 'UNETLoader', 'CheckpointLoader'];
  for (const node of Object.values(template)) {
    if (!CKPT.includes(node.class_type)) continue;
    const v = node.inputs.ckpt_name ?? node.inputs.unet_name;
    if (typeof v === 'string') return v;
  }
  return null;
}

function nodeStates(rows: Array<Record<string, unknown>>): NodeState[] {
  return rows.map((r) => ({
    id: Number(r.id),
    status: r.status as NodeState['status'],
    max_concurrent: Number(r.max_concurrent),
    queue_len: Number(r.queue_len),
    vram_free: r.vram_free == null ? null : Number(r.vram_free),
    loras: asJson<string[]>(r.loras_json) ?? [],
    modelos: asJson<string[]>(r.modelos_json) ?? [],
  }));
}

export async function processJob(job: Record<string, unknown>): Promise<void> {
  const jobId = Number(job.id);
  let conn: Client | null = null;
  let tunnelClose: (() => void) | null = null;

  try {
    const project = await db()('projects').where({ id: job.project_id }).first();
    const scene = await db()('scenes').where({ id: job.scene_id }).first();
    if (!project?.workflow_json || !project.node_bindings_json) throw new Error('Projeto sem workflow/bindings.');
    const template = asJson<ApiWorkflow>(project.workflow_json)!;
    const bindings = asJson<Bindings>(project.node_bindings_json)!;

    const [promptRow, sceneLoras] = await Promise.all([
      job.prompt_id ? db()('prompts').where({ id: job.prompt_id }).first() : null,
      db()('scene_loras').where({ scene_id: job.scene_id }),
    ]);
    const overrides = asJson<GenOverrides>(job.overrides_json);
    const base: GenBase = {
      texto_pos: promptRow?.texto_pos ?? '',
      texto_neg: promptRow?.texto_neg ?? null,
      image_id: job.image_id == null ? null : Number(job.image_id),
      loras: (sceneLoras as Array<{ lora_nome: string; peso: number }>).map((l) => ({ lora_nome: l.lora_nome, peso: l.peso })),
      frames: null,
      fps: null,
      segmento_idx: Number(job.segmento_idx),
    };
    const eff = resolveEffective(base, overrides);

    // roteamento por capacidade/carga
    const req = { loras: eff.loras.map((l) => l.lora_nome), modelo: requiredModel(template) };
    const route = selectNode(nodeStates(await db()('comfy_nodes').select('*')), req);
    if (!route.ok) {
      await db()('jobs').where({ id: jobId }).update({ status: 'blocked', erro_categoria: route.categoria, traceback: route.motivo });
      log.info({ jobId, motivo: route.motivo }, 'job bloqueado');
      return;
    }

    const node = await db()('comfy_nodes').where({ id: route.nodeId }).first();
    const privateKey = decrypt(node.ssh_key_ref);
    conn = await connect({ host: node.ssh_host, port: node.ssh_port, username: node.ssh_user, privateKey });
    const tunnel = await openTunnel(conn, node.comfy_port);
    tunnelClose = tunnel.close;
    const client = new ComfyClient(`http://127.0.0.1:${tunnel.localPort}`);

    // imagem de input
    let imageName: string | null = null;
    if (eff.image_id != null) {
      const img = await db()('images').where({ id: eff.image_id }).first();
      if (img?.path) imageName = await client.uploadImage(await readFile(img.path), path.basename(img.path));
    }

    const promptWf = buildPrompt(template, bindings, {
      texto_pos: eff.texto_pos, texto_neg: eff.texto_neg, imageName,
      loras: eff.loras, frames: eff.frames, fps: eff.fps,
    });

    const comfyPromptId = await client.queuePrompt(promptWf, `wan-${jobId}`);
    await db()('jobs').where({ id: jobId }).update({
      status: 'running', node_id: node.id, comfy_prompt_id: comfyPromptId,
      iniciado_em: db().fn.now(), params_json: JSON.stringify({ effective: eff, node_id: node.id }),
    });

    const out = await client.waitForResult(comfyPromptId, config.comfy.jobTimeoutMs, config.comfy.pollMs);

    // baixa o vídeo para a pasta estruturada
    const ref = { projectId: Number(job.project_id), sceneId: Number(job.scene_id), jobId };
    await mkdir(jobDir(ref), { recursive: true });
    const vpath = videoPath(ref);
    await writeFile(vpath, await client.view(out));

    // extrai frames (no nó remoto, mais parrudo; ou local como fallback)
    const fdir = framesDir(ref);
    let framesCount = 0;
    try {
      if (config.frames.extractOnNode) {
        const remoteVideo = path.posix.join(config.comfy.outputDir, out.subfolder || '', out.filename);
        const remoteTmp = `/tmp/wan-frames-${jobId}`;
        framesCount = await extractRemote(conn, remoteVideo, remoteTmp, fdir, config.frames.extractFps, config.frames.format);
      } else {
        framesCount = await extractLocal(vpath, fdir, config.frames.extractFps, config.frames.format);
      }
    } catch (e) {
      log.warn({ jobId, err: (e as Error).message }, 'extração de frames falhou (vídeo preservado)');
    }

    const [outputId] = await db()('outputs').insert({
      job_id: jobId, scene_id: job.scene_id, tipo: 'video', path: vpath,
      frames_dir: framesCount ? fdir : null, frames_count: framesCount,
    });
    await db()('jobs').where({ id: jobId }).update({ status: 'done', output_path: vpath, terminado_em: db().fn.now() });

    log.info({ jobId, vpath, framesCount }, 'job concluído');
    await notify.videoPronto(vpath, scene?.nome ?? `cena ${job.scene_id}`);

    // encadeamento: libera o próximo segmento (com frame de continuidade) ou concatena
    await advanceChain(db(), job, { framesDir: fdir, framesCount, outputId: Number(outputId) });
  } catch (err) {
    const msg = (err as Error).message;
    const categoria = classifyError(msg) ?? 'DESCONHECIDO';
    await db()('jobs').where({ id: jobId }).update({
      status: 'error', erro_categoria: categoria, traceback: msg,
      tentativas: Number(job.tentativas ?? 0) + 1, terminado_em: db().fn.now(),
    });
    log.error({ jobId, categoria, msg }, 'job falhou');
    await notify.erroJob(jobId, categoria);
    await abortChainDownstream(db(), job).catch(() => undefined);
  } finally {
    try { tunnelClose?.(); } catch { /* ignore */ }
    try { conn?.end(); } catch { /* ignore */ }
  }
}
