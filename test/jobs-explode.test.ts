import { describe, it, expect } from 'vitest';
import { explodeScene, countJobs } from '../src/domain/jobs';

describe('explosão de cena em jobs', () => {
  it('cena × prompt × imagem × segmento', () => {
    const jobs = explodeScene({
      projectId: 1, sceneId: 7, segmentos: 2,
      promptIds: [10, 11], imageIds: [100, 101, 102],
    });
    // 2 prompts × 3 imagens × 2 segmentos = 12
    expect(jobs).toHaveLength(12);
    expect(countJobs({ segmentos: 2, promptIds: [10, 11], imageIds: [100, 101, 102] })).toBe(12);
    expect(jobs.every((j) => j.status === 'queued')).toBe(true);
    expect(jobs.filter((j) => j.segmento_idx === 1)).toHaveLength(6);
  });

  it('sem imagem → uma passada text-to-video (image_id null)', () => {
    const jobs = explodeScene({ projectId: 1, sceneId: 1, segmentos: 1, promptIds: [5], imageIds: [] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].image_id).toBeNull();
  });

  it('sem prompt → nenhum job', () => {
    expect(explodeScene({ projectId: 1, sceneId: 1, segmentos: 3, promptIds: [], imageIds: [9] })).toHaveLength(0);
    expect(countJobs({ segmentos: 3, promptIds: [], imageIds: [9] })).toBe(0);
  });

  it('segmentos < 1 vira 1', () => {
    const jobs = explodeScene({ projectId: 1, sceneId: 1, segmentos: 0, promptIds: [5], imageIds: [9] });
    expect(jobs).toHaveLength(1);
  });
});
