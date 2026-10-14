import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for Google tokens at rest (M5c spec D4). The table holding them
 * is already unreachable from every app role; this is so a database dump or
 * a leaked service-role key alone doesn't hand out live Google access.
 *
 * Format: `v1.<iv>.<ciphertext>.<tag>`, each base64url, 12-byte IV.
 */
function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_KEY must be 32 bytes, base64');
  return key;
}

export function seal(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyB64), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function open(sealed: string, keyB64: string): string {
  const [v, iv, body, tag] = sealed.split('.');
  if (v !== 'v1' || !iv || body === undefined || !tag) throw new Error('bad sealed token');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyB64), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
