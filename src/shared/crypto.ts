/**
 * Cifragem das chaves SSH at-rest (AES-256-GCM).
 *
 * A chave mestra vem de SSH_KEY_ENCRYPTION_KEY (32 bytes em hex = 64 chars).
 * Formato do blob: base64( iv(12) | tag(16) | ciphertext ).
 *
 * Funções puras (recebem a chave) — testadas por round-trip em test/crypto.test.ts.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config/index.js';

const IV_LEN = 12;
const TAG_LEN = 16;

function keyBuf(keyHex: string): Buffer {
  const b = Buffer.from(keyHex, 'hex');
  if (b.length !== 32) throw new Error('SSH_KEY_ENCRYPTION_KEY deve ter 32 bytes (64 hex chars).');
  return b;
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(blob: string, keyHex: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Conveniências que usam a chave do ambiente. */
export function encrypt(plaintext: string): string {
  if (!config.crypto.sshKey) throw new Error('SSH_KEY_ENCRYPTION_KEY não configurada.');
  return encryptSecret(plaintext, config.crypto.sshKey);
}
export function decrypt(blob: string): string {
  if (!config.crypto.sshKey) throw new Error('SSH_KEY_ENCRYPTION_KEY não configurada.');
  return decryptSecret(blob, config.crypto.sshKey);
}
