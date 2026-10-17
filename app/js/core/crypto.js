// End-to-end encryption for sync: AES-GCM 256 with a key derived from your passphrase
// (PBKDF2-SHA-256). GitHub only ever stores the encrypted text.
const ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJSON(obj, passphrase) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ format: 'ppm-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

/** Throws Error('wrongPassphrase') when the passphrase does not match, Error('notEncrypted') for other content. */
export async function decryptJSON(text, passphrase) {
  let box;
  try {
    box = JSON.parse(text);
  } catch {
    throw new Error('notEncrypted');
  }
  if (!box || box.format !== 'ppm-encrypted') throw new Error('notEncrypted');
  const key = await deriveKey(passphrase, unb64(box.salt), box.iterations);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
  } catch {
    throw new Error('wrongPassphrase');
  }
  return JSON.parse(dec.decode(plain));
}
