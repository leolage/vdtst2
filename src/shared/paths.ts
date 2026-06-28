/**
 * Layout de armazenamento das saídas.
 *
 *   <DATA_DIR>/outputs/proj-<projectId>/scene-<sceneId>/job-<jobId>/
 *       video.mp4              vídeo final (ou do segmento)
 *       segments/seg-NNN.mp4   segmentos brutos antes do stitch (opcional)
 *       frames/frame-NNNN.png  frames extraídos automaticamente
 *
 * Funções puras (testadas em test/paths.test.ts) — sem I/O, só montam caminhos.
 */
import path from 'node:path';
import { config } from '../config/index.js';

export interface JobRef {
  projectId: number;
  sceneId: number;
  jobId: number;
}

export function outputsRoot(): string {
  return path.join(config.paths.dataDir, 'outputs');
}

export function jobDir(ref: JobRef): string {
  return path.join(outputsRoot(), `proj-${ref.projectId}`, `scene-${ref.sceneId}`, `job-${ref.jobId}`);
}

export function videoPath(ref: JobRef): string {
  return path.join(jobDir(ref), 'video.mp4');
}

export function segmentsDir(ref: JobRef): string {
  return path.join(jobDir(ref), 'segments');
}

export function framesDir(ref: JobRef): string {
  return path.join(jobDir(ref), 'frames');
}

export function inputsRoot(): string {
  return path.join(config.paths.dataDir, 'inputs');
}

/** Pasta e arquivo do vídeo final concatenado de uma cadeia de segmentos. */
export function chainDir(projectId: number, sceneId: number, chainKey: string): string {
  const safe = chainKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(outputsRoot(), `proj-${projectId}`, `scene-${sceneId}`, `chain-${safe}`);
}
export function chainFinalPath(projectId: number, sceneId: number, chainKey: string): string {
  return path.join(chainDir(projectId, sceneId, chainKey), 'final.mp4');
}
