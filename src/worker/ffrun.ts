/** Executa ffmpeg (spawn, sem shell). Compartilhado pelos passos de pós-processamento. */
import { spawn } from 'node:child_process';

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu ${code}: ${err.slice(-400)}`))));
  });
}
