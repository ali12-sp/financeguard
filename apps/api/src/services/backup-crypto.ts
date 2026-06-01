/**
 * AES-256-GCM encryption helpers for database backup files.
 *
 * Key derivation: HKDF-SHA256 from JWT_SECRET → 32-byte AES key.
 * Wire format (binary):
 *   [4 bytes magic "FGB\x01"][12 bytes IV][16 bytes auth tag][N bytes ciphertext]
 *
 * If BACKUP_ENCRYPTION_KEY env var is set, that is used as the raw key
 * (must be exactly 64 hex chars = 32 bytes). Otherwise JWT_SECRET is used
 * via HKDF so there is zero extra configuration needed.
 */

import crypto from 'node:crypto';

const MAGIC = Buffer.from('FGB\x01');
const ALGORITHM = 'aes-256-gcm';

function deriveKey(): Buffer {
  const rawKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (rawKey) {
    if (rawKey.length !== 64) {
      throw new Error(
        'BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).'
      );
    }
    return Buffer.from(rawKey, 'hex');
  }

  // Derive from JWT_SECRET using HKDF
  const secret = process.env.JWT_SECRET ?? 'change-me';
  const salt = Buffer.alloc(32, 0); // fixed salt, purpose below
  const info = Buffer.from('financeguard-backup-v1');
  return Buffer.from(crypto.hkdfSync('sha256', secret, salt, info, 32));
}

/** Encrypt a UTF-8 JSON string and return an encrypted Buffer. */
export function encryptBackup(json: string): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // Layout: magic(4) + iv(12) + authTag(16) + ciphertext(N)
  return Buffer.concat([MAGIC, iv, authTag, ciphertext]);
}

/** Decrypt an encrypted backup Buffer and return the UTF-8 JSON string. */
export function decryptBackup(data: Buffer): string {
  if (!data.slice(0, 4).equals(MAGIC)) {
    throw new Error('Not a valid FinanceGuard encrypted backup (bad magic).');
  }

  const key = deriveKey();
  const iv = data.slice(4, 16);
  const authTag = data.slice(16, 32);
  const ciphertext = data.slice(32);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

/** True when the first 4 bytes match the encrypted-backup magic header. */
export function isEncryptedBackup(data: Buffer): boolean {
  return data.length >= 32 && data.slice(0, 4).equals(MAGIC);
}
