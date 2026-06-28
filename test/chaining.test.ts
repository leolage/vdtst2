import { describe, it, expect } from 'vitest';
import { buildUnits, chainKeyOf } from '../src/domain/chaining';
import { explodeScene } from '../src/domain/jobs';

describe('agrupamento em cadeias', () => {
  it('cena encadeada com 3 segmentos vira 1 unidade ordenada', () => {
    const seeds = explodeScene({ projectId: 1, sceneId: 7, segmentos: 3, promptIds: [10], imageIds: [100] });
    const units = buildUnits([{ seeds, encadear: true }]);
    expect(units).toHaveLength(1);
    expect(units[0].map((s) => s.segmento_idx)).toEqual([0, 1, 2]);
  });

  it('múltiplas combinações encadeadas viram uma unidade cada', () => {
    // 2 prompts × 1 imagem × 2 segmentos = 2 cadeias de 2
    const seeds = explodeScene({ projectId: 1, sceneId: 7, segmentos: 2, promptIds: [10, 11], imageIds: [100] });
    const units = buildUnits([{ seeds, encadear: true }]);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.length === 2)).toBe(true);
  });

  it('sem encadear: cada segmento é uma unidade independente', () => {
    const seeds = explodeScene({ projectId: 1, sceneId: 7, segmentos: 3, promptIds: [10], imageIds: [100] });
    const units = buildUnits([{ seeds, encadear: false }]);
    expect(units).toHaveLength(3);
    expect(units.every((u) => u.length === 1)).toBe(true);
  });

  it('chave de cadeia separa por prompt e imagem', () => {
    const a = { project_id: 1, scene_id: 7, prompt_id: 10, image_id: 100, segmento_idx: 0, prioridade: 100, status: 'queued' as const };
    expect(chainKeyOf(a)).toBe('1_7_10_100');
    expect(chainKeyOf({ ...a, image_id: null })).toBe('1_7_10_x');
  });
});
