/**
 * Helpers puros de observabilidade (testados): taxa de erro e export Prometheus.
 * A coleta (agregações SQL) fica na rota; aqui só transformação de dados.
 */

export interface Overview {
  status: Record<string, number>;
  ultimas24h: { done: number; error: number };
  ultimaHora: { done: number; error: number };
  duracao_media_seg: number | null;
  por_categoria: Array<{ categoria: string; n: number }>;
  por_no: Array<{ id: number; nome: string; status: string; queue_len: number; vram_free: number | null; vram_total: number | null; done: number; dur_media_seg: number | null }>;
  finais: number;
  aprovados: number;
  golden: number;
  serie_hora: Array<{ h: string; n: number }>;
}

/** error / (done + error); 0 se não houve trabalho. */
export function taxaErro(done: number, error: number): number {
  const tot = done + error;
  return tot === 0 ? 0 : error / tot;
}

function metric(name: string, value: number, labels?: Record<string, string>): string {
  const lbl = labels && Object.keys(labels).length
    ? '{' + Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(',') + '}'
    : '';
  return `${name}${lbl} ${value}`;
}

/** Formata o overview em texto de exposição Prometheus. Puro. */
export function toPrometheus(o: Overview): string {
  const lines: string[] = [];
  lines.push('# TYPE wan_jobs_status gauge');
  for (const [s, n] of Object.entries(o.status)) lines.push(metric('wan_jobs_status', n, { status: s }));
  lines.push('# TYPE wan_jobs_done_24h gauge', metric('wan_jobs_done_24h', o.ultimas24h.done));
  lines.push('# TYPE wan_jobs_error_24h gauge', metric('wan_jobs_error_24h', o.ultimas24h.error));
  lines.push('# TYPE wan_jobs_error_rate_24h gauge', metric('wan_jobs_error_rate_24h', taxaErro(o.ultimas24h.done, o.ultimas24h.error)));
  if (o.duracao_media_seg != null) lines.push('# TYPE wan_job_duration_seconds_avg gauge', metric('wan_job_duration_seconds_avg', o.duracao_media_seg));
  lines.push('# TYPE wan_outputs_final_total gauge', metric('wan_outputs_final_total', o.finais));
  lines.push('# TYPE wan_outputs_approved_total gauge', metric('wan_outputs_approved_total', o.aprovados));
  lines.push('# TYPE wan_errors_by_category gauge');
  for (const c of o.por_categoria) lines.push(metric('wan_errors_by_category', c.n, { categoria: c.categoria }));
  lines.push('# TYPE wan_node_queue gauge', '# TYPE wan_node_vram_free gauge', '# TYPE wan_node_done_total gauge');
  for (const node of o.por_no) {
    const l = { node: node.nome };
    lines.push(metric('wan_node_queue', node.queue_len, l));
    if (node.vram_free != null) lines.push(metric('wan_node_vram_free', node.vram_free, l));
    lines.push(metric('wan_node_done_total', node.done, l));
  }
  return lines.join('\n') + '\n';
}
