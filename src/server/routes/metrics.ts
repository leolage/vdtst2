import type { FastifyInstance } from 'fastify';
import { db } from '../../db/knex.js';
import { toPrometheus, type Overview } from '../../domain/metrics.js';

function n(v: unknown): number { return Number(v ?? 0); }

async function computeOverview(): Promise<Overview> {
  const k = db();

  const [statusRows, d24, e24, d1h, e1h, durRow, catRows, nodes, perNode, finais, aprovados, golden, serie] = await Promise.all([
    k('jobs').select('status').count<{ status: string; n: number }[]>('* as n').groupBy('status'),
    k('jobs').where('status', 'done').andWhereRaw('terminado_em >= DATE_SUB(NOW(), INTERVAL 24 HOUR)').count<{ c: number }[]>('* as c'),
    k('jobs').where('status', 'error').andWhereRaw('terminado_em >= DATE_SUB(NOW(), INTERVAL 24 HOUR)').count<{ c: number }[]>('* as c'),
    k('jobs').where('status', 'done').andWhereRaw('terminado_em >= DATE_SUB(NOW(), INTERVAL 1 HOUR)').count<{ c: number }[]>('* as c'),
    k('jobs').where('status', 'error').andWhereRaw('terminado_em >= DATE_SUB(NOW(), INTERVAL 1 HOUR)').count<{ c: number }[]>('* as c'),
    k('jobs').where('status', 'done').whereNotNull('iniciado_em').whereNotNull('terminado_em')
      .select(k.raw('AVG(TIMESTAMPDIFF(SECOND, iniciado_em, terminado_em)) as media')),
    k('jobs').where('status', 'error').whereNotNull('erro_categoria').select('erro_categoria')
      .count<{ erro_categoria: string; n: number }[]>('* as n').groupBy('erro_categoria').orderBy('n', 'desc'),
    k('comfy_nodes').select('id', 'nome', 'status', 'queue_len', 'vram_free', 'vram_total', 'ultimo_health'),
    k('jobs').where('status', 'done').whereNotNull('node_id').groupBy('node_id').select('node_id')
      .count('* as done').select(k.raw('AVG(TIMESTAMPDIFF(SECOND, iniciado_em, terminado_em)) as dur')),
    k('outputs').where('is_final', true).count<{ c: number }[]>('* as c'),
    k('outputs').where('aprovado', true).count<{ c: number }[]>('* as c'),
    k('outputs').where('golden', true).count<{ c: number }[]>('* as c'),
    k('jobs').where('status', 'done').andWhereRaw("terminado_em >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")
      .select(k.raw("DATE_FORMAT(terminado_em, '%Y-%m-%d %H:00') as h")).count('* as n').groupBy('h').orderBy('h'),
  ]);

  const status: Record<string, number> = { queued: 0, running: 0, blocked: 0, waiting: 0, done: 0, error: 0 };
  for (const r of statusRows as Array<{ status: string; n: number }>) status[r.status] = n(r.n);

  const perNodeMap = new Map<number, { done: number; dur: number | null }>();
  for (const r of perNode as Array<{ node_id: number; done: number; dur: number | null }>) {
    perNodeMap.set(n(r.node_id), { done: n(r.done), dur: r.dur == null ? null : Math.round(n(r.dur)) });
  }

  return {
    status,
    ultimas24h: { done: n(d24[0].c), error: n(e24[0].c) },
    ultimaHora: { done: n(d1h[0].c), error: n(e1h[0].c) },
    duracao_media_seg: (durRow as Array<{ media: number | null }>)[0]?.media == null ? null : Math.round(n((durRow as Array<{ media: number }>)[0].media)),
    por_categoria: (catRows as Array<{ erro_categoria: string; n: number }>).map((r) => ({ categoria: r.erro_categoria, n: n(r.n) })),
    por_no: (nodes as Array<Record<string, unknown>>).map((nd) => ({
      id: n(nd.id), nome: String(nd.nome), status: String(nd.status),
      queue_len: n(nd.queue_len), vram_free: nd.vram_free == null ? null : n(nd.vram_free),
      vram_total: nd.vram_total == null ? null : n(nd.vram_total),
      done: perNodeMap.get(n(nd.id))?.done ?? 0, dur_media_seg: perNodeMap.get(n(nd.id))?.dur ?? null,
    })),
    finais: n(finais[0].c), aprovados: n(aprovados[0].c), golden: n(golden[0].c),
    serie_hora: (serie as Array<{ h: string; n: number }>).map((r) => ({ h: r.h, n: n(r.n) })),
  };
}

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics/overview', async () => computeOverview());

  app.get('/metrics/prometheus', async (_req, reply) => {
    const o = await computeOverview();
    reply.header('content-type', 'text/plain; version=0.0.4');
    return toPrometheus(o);
  });
}
