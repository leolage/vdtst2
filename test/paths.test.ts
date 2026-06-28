import { describe, it, expect } from 'vitest';
import { jobDir, videoPath, framesDir, segmentsDir } from '../src/shared/paths';

const ref = { projectId: 1, sceneId: 7, jobId: 42 };

describe('layout de saídas', () => {
  it('monta a pasta estruturada do job', () => {
    expect(jobDir(ref)).toMatch(/outputs\/proj-1\/scene-7\/job-42$/);
  });
  it('vídeo, segmentos e frames ficam sob a pasta do job', () => {
    expect(videoPath(ref)).toMatch(/job-42\/video\.mp4$/);
    expect(segmentsDir(ref)).toMatch(/job-42\/segments$/);
    expect(framesDir(ref)).toMatch(/job-42\/frames$/);
  });
});
