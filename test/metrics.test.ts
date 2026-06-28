import { describe, it, expect } from 'vitest';
import { taxaErro, toPrometheus, type Overview } from '../src/domain/metrics';

describe('métricas', () => {
  it('taxa de erro', () => {
    expect(taxaErro(0, 0)).toBe(0);
    expect(taxaErro(9, 1)).toBeCloseTo(0.1);
    expect(taxaErro(0, 5)).toBe(1);
  });

  const o: Overview = {
    status: { queued: 3, running: 1, blocked: 0, waiting: 2, done: 10, error: 1 },
    ultimas24h: { done: 10, error: 1 },
    ultimaHora: { done: 2, error: 0 },
    duracao_media_seg: 84,
    por_categoria: [{ categoria: 'OOM_VRAM', n: 1 }],
    por_no: [{ id: 1, nome: 'gpu-1', status: 'up', queue_len: 0, vram_free: 23000, vram_total: 24000, done: 10, dur_media_seg: 84 }],
    finais: 4, aprovados: 6, golden: 2, serie_hora: [{ h: '2026-06-28 02:00', n: 5 }],
  };

  it('exporta no formato Prometheus', () => {
    const txt = toPrometheus(o);
    expect(txt).toContain('wan_jobs_status{status="queued"} 3');
    expect(txt).toContain('wan_jobs_done_24h 10');
    expect(txt).toContain('wan_job_duration_seconds_avg 84');
    expect(txt).toContain('wan_errors_by_category{categoria="OOM_VRAM"} 1');
    expect(txt).toContain('wan_node_queue{node="gpu-1"} 0');
    expect(txt).toContain('wan_outputs_final_total 4');
  });
});
