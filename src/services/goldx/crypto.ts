// ============================================================
// GoldX — Cryptographic Utilities
// ============================================================

import crypto from 'crypto';

const HMAC_SECRET = process.env.GOLDX_HMAC_SECRET || 'goldx-hmac-secret-change-me';
const LICENSE_PEPPER = process.env.GOLDX_LICENSE_PEPPER || 'goldx-pepper-change-me';
const AES_KEY = process.env.GOLDX_AES_KEY || crypto.randomBytes(32).toString('hex');
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function normalizeTimestampMs(timestamp: number): number {
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }

  // MT5/EA payloads commonly send Unix time in seconds.
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

/** SHA-256 hash a license key with pepper for storage */
export function hashLicenseKey(licenseKey: string): string {
  return crypto
    .createHash('sha256')
    .update(`${LICENSE_PEPPER}:${licenseKey}`)
    .digest('hex');
}

/** Generate a cryptographically secure license key */
export function generateLicenseKey(): string {
  const parts = [
    'GX',
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  ];
  return parts.join('-');
}

/** Generate a secure random session token */
export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/** SHA-256 hash a session token for storage */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Compute HMAC-SHA256 for request signing */
export function computeHmac(payload: string): string {
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('hex');
}

/** Verify HMAC signature from EA */
export function verifyHmac(payload: string, signature: string): boolean {
  const expected = computeHmac(payload);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Check if timestamp is within replay window */
export function isTimestampValid(timestamp: number): boolean {
  const now = Date.now();
  const normalizedTimestamp = normalizeTimestampMs(timestamp);
  const diff = Math.abs(now - normalizedTimestamp);
  return diff <= REPLAY_WINDOW_MS;
}

/** AES-256-GCM encrypt */
export function aesEncrypt(plaintext: string): string {
  const keyBuf = Buffer.from(AES_KEY.slice(0, 64), 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

/** AES-256-GCM decrypt */
export function aesDecrypt(ciphertext: string): string {
  const keyBuf = Buffer.from(AES_KEY.slice(0, 64), 'hex');
  const raw = Buffer.from(ciphertext, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Get the HMAC secret (for documentation / EA config) */
export function getHmacSecret(): string {
  return HMAC_SECRET;
}
