/**
 * Parse da saída do nvidia-smi (executado por SSH no nó). Puro, testado.
 * Comando esperado:
 *   nvidia-smi --query-gpu=memory.total,memory.free --format=csv,noheader,nounits
 */
export interface GpuMem { total: number; free: number }

export function parseNvidiaSmi(text: string): GpuMem | null {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const [total, free] = line.split(',').map((x) => Number(x.trim()));
  if (!Number.isFinite(total) || !Number.isFinite(free)) return null;
  return { total, free }; // em MiB
}

/** Soma running + pending do /queue do ComfyUI. */
export function queueLength(queue: unknown): number {
  const q = queue as { queue_running?: unknown[]; queue_pending?: unknown[] };
  return (q?.queue_running?.length ?? 0) + (q?.queue_pending?.length ?? 0);
}
