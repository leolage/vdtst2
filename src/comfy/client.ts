/**
 * Cliente HTTP da API do ComfyUI (acessada via túnel SSH em http://127.0.0.1:<porta>).
 *
 * A maior parte é I/O (não testada aqui); os parsers de resposta (parseCapabilities,
 * findOutputFile) são puros e testados em test/comfy-parse.test.ts.
 */
import type { ApiWorkflow } from '../workflow/parse.js';

export interface OutputFile { filename: string; subfolder: string; type: string }

const LORA_LOADERS = ['LoraLoader', 'LoraLoaderModelOnly'];
const CKPT_LOADERS = ['CheckpointLoaderSimple', 'UNETLoader', 'CheckpointLoader'];

/** Extrai LoRAs e checkpoints disponíveis a partir de /object_info. Puro. */
export function parseCapabilities(objectInfo: Record<string, unknown>): { loras: string[]; modelos: string[] } {
  const pick = (cls: string, field: string): string[] => {
    const node = objectInfo[cls] as { input?: { required?: Record<string, unknown> } } | undefined;
    const spec = node?.input?.required?.[field];
    if (Array.isArray(spec) && Array.isArray(spec[0])) return spec[0] as string[];
    return [];
  };
  const loras = new Set<string>();
  for (const c of LORA_LOADERS) pick(c, 'lora_name').forEach((x) => loras.add(x));
  const modelos = new Set<string>();
  for (const c of CKPT_LOADERS) {
    pick(c, 'ckpt_name').forEach((x) => modelos.add(x));
    pick(c, 'unet_name').forEach((x) => modelos.add(x));
  }
  return { loras: [...loras], modelos: [...modelos] };
}

/** Acha o arquivo de vídeo/imagem na saída de /history. Puro. */
export function findOutputFile(historyEntry: unknown): OutputFile | null {
  const outputs = (historyEntry as { outputs?: Record<string, Record<string, unknown>> })?.outputs;
  if (!outputs) return null;
  const buckets = ['videos', 'gifs', 'images'];
  for (const node of Object.values(outputs)) {
    for (const b of buckets) {
      const arr = node[b];
      if (Array.isArray(arr) && arr.length) return arr[0] as OutputFile;
    }
  }
  return null;
}

export class ComfyClient {
  constructor(private baseUrl: string) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl + path, init);
    if (!res.ok) throw new Error(`ComfyUI ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  }

  systemStats() { return this.json<Record<string, unknown>>('/system_stats'); }
  queue() { return this.json<Record<string, unknown>>('/queue'); }
  objectInfo() { return this.json<Record<string, unknown>>('/object_info'); }
  history(promptId: string) { return this.json<Record<string, unknown>>(`/history/${promptId}`); }

  async queuePrompt(prompt: ApiWorkflow, clientId: string): Promise<string> {
    const r = await this.json<{ prompt_id: string }>('/prompt', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: clientId }),
    });
    return r.prompt_id;
  }

  /** Envia uma imagem de input ao ComfyUI; retorna o nome usável em LoadImage. */
  async uploadImage(data: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([data]), filename);
    form.append('overwrite', 'true');
    const r = await this.json<{ name: string }>('/upload/image', { method: 'POST', body: form });
    return r.name;
  }

  /** Baixa um arquivo de saída via /view. */
  async view(f: OutputFile): Promise<Buffer> {
    const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
    const res = await fetch(`${this.baseUrl}/view?${qs}`);
    if (!res.ok) throw new Error(`/view → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Aguarda a conclusão de um prompt, varrendo /history até ter saída ou erro/timeout. */
  async waitForResult(promptId: string, timeoutMs: number, pollMs: number): Promise<OutputFile> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hist = await this.history(promptId);
      const entry = (hist as Record<string, unknown>)[promptId];
      if (entry) {
        const status = (entry as { status?: { status_str?: string } }).status?.status_str;
        if (status === 'error') throw new Error('ComfyUI reportou erro na execução do prompt.');
        const file = findOutputFile(entry);
        if (file) return file;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error('TIMEOUT aguardando a geração no ComfyUI.');
  }
}
