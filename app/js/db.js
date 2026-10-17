// Tiny IndexedDB wrapper. Everything is stored on this device only.
const DB_NAME = 'personal-project-manager';
const DB_VERSION = 1;
export const STORES = ['tasks', 'projects', 'kv'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('noIndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('dbOpenFailed'));
    req.onblocked = () => reject(new Error('dbBlocked'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('dbWriteFailed'));
    tx.onabort = () => reject(tx.error || new Error('dbWriteAborted'));
  });
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getKV(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setKV(key, value) {
  const db = await openDB();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return done(tx);
}

export async function putMany(store, records) {
  if (!records.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const r of records) os.put(r);
  return done(tx);
}

/** Replace all tasks and projects in one transaction (used by restore and sync). */
export async function replaceAll({ tasks, projects }) {
  const db = await openDB();
  const tx = db.transaction(['tasks', 'projects'], 'readwrite');
  const ts = tx.objectStore('tasks');
  const ps = tx.objectStore('projects');
  ts.clear();
  ps.clear();
  for (const t of tasks) ts.put(t);
  for (const p of projects) ps.put(p);
  return done(tx);
}

export async function wipeAll() {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return done(tx);
}
