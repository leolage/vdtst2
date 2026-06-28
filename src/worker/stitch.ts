/**
 * Concatenação dos segmentos de uma cadeia num vídeo final (ffmpeg concat demuxer).
 * Roda na VM (os segmentos já foram baixados). Usa os builders testados em ffmpeg.ts.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { concatArgs, concatListContent } from './ffmpeg.js';

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} saiu ${code}: ${err.slice(-400)}`))));
  });
}

/** Concatena `segmentPaths` (em ordem) em `outputPath`. */
export async function stitchSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });
  const listFile = path.join(dir, 'segments.txt');
  await writeFile(listFile, concatListContent(segmentPaths));
  await run('ffmpeg', concatArgs(listFile, outputPath));
}
