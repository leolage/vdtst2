/**
 * Agrupamento de jobs em cadeias para encadeamento de segmentos. Puro, testado.
 *
 * Uma "unidade" é o que se agenda junto:
 *  - cadeia (vários segmentos em ordem) quando a cena é encadeada e tem >1 segmento;
 *  - segmento solto (unidade de 1) caso contrário.
 * Dentro de uma cadeia, só o 1º segmento entra como `queued`; os demais ficam `waiting`
 * e são liberados pelo worker conforme o anterior conclui (com o frame de continuidade).
 */
import type { JobSeed } from './jobs.js';

export type Unit = JobSeed[];

export function chainKeyOf(s: JobSeed): string {
  return `${s.project_id}_${s.scene_id}_${s.prompt_id}_${s.image_id ?? 'x'}`;
}

export interface ScenePlan {
  seeds: JobSeed[];
  encadear: boolean;
}

/** Transforma planos de cenas em unidades de agendamento (cadeias ou segmentos soltos). */
export function buildUnits(plans: ScenePlan[]): Unit[] {
  const units: Unit[] = [];
  for (const plan of plans) {
    const grupos = new Map<string, JobSeed[]>();
    for (const s of plan.seeds) {
      const k = chainKeyOf(s);
      (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(s);
    }
    for (const grupo of grupos.values()) {
      grupo.sort((a, b) => a.segmento_idx - b.segmento_idx);
      if (plan.encadear && grupo.length > 1) units.push(grupo);
      else for (const s of grupo) units.push([s]);
    }
  }
  return units;
}
