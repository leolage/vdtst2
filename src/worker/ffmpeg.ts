/**
 * Construtores de comando ffmpeg. Retornam arrays de argumentos (sem shell), seguros para
 * passar a child_process.spawn ou para `exec` via SSH (com quoting feito pelo caller).
 * Funções puras, testadas.
 */

export interface ExtractOpts {
  input: string;       // caminho do vídeo
  outDir: string;      // pasta destino dos frames
  fps?: number | null; // amostragem; vazio = todos os frames
  format?: string;     // png | jpg
}

/** ffmpeg para extrair frames: frame-0001.png, frame-0002.png, ... */
export function extractFramesArgs(o: ExtractOpts): string[] {
  const fmt = o.format || 'png';
  const args = ['-y', '-i', o.input];
  if (o.fps && o.fps > 0) args.push('-vf', `fps=${o.fps}`);
  args.push(`${o.outDir}/frame-%04d.${fmt}`);
  return args;
}

/** ffmpeg concat demuxer: junta segmentos numa lista em ordem. */
export function concatArgs(listFile: string, output: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output];
}

/** Conteúdo do arquivo de lista do concat demuxer. */
export function concatListContent(segmentPaths: string[]): string {
  return segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/** Monta uma linha de comando shell escapando argumentos (para exec remoto via SSH). */
export function toShellCommand(bin: string, args: string[]): string {
  const esc = (s: string) => (/^[a-zA-Z0-9._\/=:-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
  return [bin, ...args.map(esc)].join(' ');
}
