// Device pairing. The sync token is encrypted with the sync passphrase and packed into a
// link (shown as a QR code). The link alone is useless: the other device still needs the
// passphrase, which is never put in the link.
import { encryptJSON, decryptJSON } from './crypto.js';

export const PAIR_PREFIX = 'pair=';

function toB64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function makePairCode(token, passphrase) {
  return toB64url(await encryptJSON({ kind: 'ppm-pair', token }, passphrase));
}

export function pairLink(baseUrl, code) {
  return `${baseUrl.split('#')[0]}#${PAIR_PREFIX}${code}`;
}

/** Accepts a full link, a "#pair=…" hash or the bare code. Returns the code or null. */
export function extractPairCode(text) {
  const s = String(text || '').trim();
  const i = s.indexOf(PAIR_PREFIX);
  const code = i >= 0 ? s.slice(i + PAIR_PREFIX.length) : s;
  return /^[A-Za-z0-9_-]{40,}$/.test(code) ? code : null;
}

/** Returns the token. Throws Error('wrongPassphrase') or Error('badPairCode'). */
export async function readPairCode(code, passphrase) {
  let text;
  try {
    text = fromB64url(code);
  } catch {
    throw new Error('badPairCode');
  }
  let obj;
  try {
    obj = await decryptJSON(text, passphrase);
  } catch (e) {
    throw new Error(e.message === 'wrongPassphrase' ? 'wrongPassphrase' : 'badPairCode');
  }
  if (!obj || obj.kind !== 'ppm-pair' || typeof obj.token !== 'string' || !obj.token) throw new Error('badPairCode');
  return obj.token;
}
