/**
 * SSH para os nós ComfyUI remotos:
 *  - túnel local → API HTTP/WS do ComfyUI (evita expor a porta na rede);
 *  - exec remoto (nvidia-smi, ffmpeg, systemctl restart comfyui, tail de log);
 *  - download de arquivos (vídeo/frames) via SFTP.
 *
 * I/O real — não testado neste ambiente; estruturado para rodar no servidor.
 */
import net from 'node:net';
import { Client } from 'ssh2';

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  privateKey: string; // já decifrado
}

export interface Tunnel {
  localPort: number;
  close: () => void;
}

export function connect(t: SshTarget): Promise<Client> {
  const conn = new Client();
  return new Promise((resolve, reject) => {
    conn.once('ready', () => resolve(conn));
    conn.once('error', reject);
    conn.connect({ host: t.host, port: t.port, username: t.username, privateKey: t.privateKey, readyTimeout: 15000 });
  });
}

/** Encaminha 127.0.0.1:<localPort> → <remoteHost>:<remotePort> no host remoto. */
export function openTunnel(conn: Client, remotePort: number, remoteHost = '127.0.0.1'): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      conn.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
        if (err) return socket.destroy();
        socket.pipe(stream).pipe(socket);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ localPort: addr.port, close: () => server.close() });
      else reject(new Error('falha ao abrir túnel'));
    });
  });
}

export interface ExecResult { stdout: string; stderr: string; code: number | null }

export function exec(conn: Client, cmd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', (d: Buffer) => (stdout += d.toString()));
      stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      stream.on('close', (code: number | null) => resolve({ stdout, stderr, code }));
    });
  });
}

export function downloadFile(conn: Client, remotePath: string, localPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastGet(remotePath, localPath, (e) => (e ? reject(e) : resolve()));
    });
  });
}

/** Lista arquivos numa pasta remota (para baixar os frames extraídos). */
export function listDir(conn: Client, remoteDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.readdir(remoteDir, (e, list) => (e ? reject(e) : resolve(list.map((x) => x.filename))));
    });
  });
}
