/**
 * Extração de frames: no servidor ComfyUI (preferido, mais parrudo) ou local na VM.
 * Usa os construtores de comando testados em src/worker/ffmpeg.ts.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import type { Client } from 'ssh2';
import { extractFramesArgs, toShellCommand } from './ffmpeg.js';
import { exec, listDir, downloadFile } from '../comfy/ssh.js';

function runLocal(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} saiu ${code}: ${err.slice(-400)}`))));
  });
}

export async function extractLocal(videoPath: string, framesDir: string, fps: number | null, format: string): Promise<number> {
  await mkdir(framesDir, { recursive: true });
  await runLocal('ffmpeg', extractFramesArgs({ input: videoPath, outDir: framesDir, fps, format }));
  return (await readdir(framesDir)).filter((f) => f.startsWith('frame-')).length;
}

export async function extractRemote(
  conn: Client, remoteVideo: string, remoteTmp: string, localFramesDir: string, fps: number | null, format: string,
): Promise<number> {
  await exec(conn, `mkdir -p ${remoteTmp}`);
  const cmd = toShellCommand('ffmpeg', extractFramesArgs({ input: remoteVideo, outDir: remoteTmp, fps, format }));
  const r = await exec(conn, cmd);
  if (r.code !== 0) throw new Error(`ffmpeg remoto saiu ${r.code}: ${r.stderr.slice(-400)}`);
  const files = (await listDir(conn, remoteTmp)).filter((f) => f.startsWith('frame-'));
  await mkdir(localFramesDir, { recursive: true });
  for (const f of files) await downloadFile(conn, `${remoteTmp}/${f}`, `${localFramesDir}/${f}`);
  await exec(conn, `rm -rf ${remoteTmp}`).catch(() => undefined);
  return files.length;
}
