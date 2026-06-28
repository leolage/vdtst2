/**
 * Pós-processamento de vídeo: trilha/narração, legendas, upscale e interpolação.
 *
 * Os construtores de args (puros) são testados em test/postprocess.test.ts; `runChain`
 * aplica os passos em sequência na VM (vídeos já estão locais).
 */
import { mkdir, rename, rm } from 'node:fs/promises';
import { runFfmpeg } from './ffrun.js';

export type Step =
  | { tipo: 'audio'; asset: string }       // muxa uma trilha/narração
  | { tipo: 'legenda'; asset: string }     // queima legendas (.srt/.ass)
  | { tipo: 'scale'; w: number; h: number } // upscale/resize (h=-2 mantém proporção)
  | { tipo: 'interpolate'; fps: number };  // interpolação de quadros

/** Muxa uma faixa de áudio no vídeo (vídeo copiado, áudio re-encodado). */
export function addAudioArgs(video: string, audio: string, out: string): string[] {
  return ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out];
}
/** Queima legendas no vídeo. */
export function burnSubsArgs(video: string, srt: string, out: string): string[] {
  return ['-y', '-i', video, '-vf', `subtitles=${srt}`, '-c:a', 'copy', out];
}
/** Upscale/resize. */
export function scaleArgs(video: string, w: number, h: number, out: string): string[] {
  return ['-y', '-i', video, '-vf', `scale=${w}:${h}`, '-c:a', 'copy', out];
}
/** Interpolação de quadros para suavizar/aumentar fps. */
export function interpolateArgs(video: string, fps: number, out: string): string[] {
  return ['-y', '-i', video, '-vf', `minterpolate=fps=${fps}`, '-c:a', 'copy', out];
}

/** Args de um passo aplicado a `input` produzindo `out`. Puro. */
export function stepArgs(input: string, step: Step, out: string): string[] {
  switch (step.tipo) {
    case 'audio': return addAudioArgs(input, step.asset, out);
    case 'legenda': return burnSubsArgs(input, step.asset, out);
    case 'scale': return scaleArgs(input, step.w, step.h, out);
    case 'interpolate': return interpolateArgs(input, step.fps, out);
  }
}

/** Aplica a cadeia de passos a `inputVideo`, escrevendo o resultado em `finalOut`. */
export async function runChain(inputVideo: string, steps: Step[], finalOut: string): Promise<void> {
  await mkdir(finalOut.slice(0, finalOut.lastIndexOf('/')) || '.', { recursive: true });
  if (steps.length === 0) throw new Error('nenhum passo de pós-processamento');

  let current = inputVideo;
  const intermediarios: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const out = i === steps.length - 1 ? finalOut : `${finalOut}.step${i}.mp4`;
    await runFfmpeg(stepArgs(current, steps[i], out));
    if (current !== inputVideo) intermediarios.push(current);
    current = out;
  }
  for (const t of intermediarios) await rm(t, { force: true }).catch(() => undefined);
  // se um único passo já escreveu finalOut, nada a renomear; caso contrário, current === finalOut
  if (current !== finalOut) await rename(current, finalOut);
}
