// Sync through a secret GitHub Gist on your own account, encrypted with your passphrase.
// Only api.github.com is contacted, only when sync is switched on.
import { encryptJSON, decryptJSON } from './crypto.js';
import { mergeRecords, mergePrefs } from './merge.js';
import { SCHEMA_VERSION } from './model.js';

export const SYNC_FILE = 'ppm-sync.json';

export class SyncError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export class GistClient {
  constructor({ token, fetchFn, api = 'https://api.github.com' }) {
    this.token = token;
    this.fetch = fetchFn || ((...a) => globalThis.fetch(...a));
    this.api = api;
  }

  async req(method, path, body) {
    let res;
    try {
      res = await this.fetch(this.api + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new SyncError('offline', String(e));
    }
    if (res.status === 401) throw new SyncError('badToken');
    if (res.status === 403 || res.status === 429) {
      const left = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
      throw new SyncError(left === '0' || res.status === 429 ? 'rateLimited' : 'noGistPermission');
    }
    if (res.status === 404) throw new SyncError('notFound');
    if (!res.ok) throw new SyncError('httpError', String(res.status));
    return res.json();
  }

  async findGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await this.req('GET', `/gists?per_page=100&page=${page}`);
      if (!Array.isArray(list)) break;
      const hit = list.find((g) => g.files && g.files[SYNC_FILE]);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    return null;
  }

  async getGist(id) {
    return this.req('GET', `/gists/${encodeURIComponent(id)}`);
  }

  async readContent(gist) {
    const f = gist.files && gist.files[SYNC_FILE];
    if (!f) throw new SyncError('fileMissing');
    if (!f.truncated && typeof f.content === 'string') return f.content;
    let res;
    try {
      res = await this.fetch(f.raw_url, { cache: 'no-store' });
    } catch (e) {
      throw new SyncError('offline', String(e));
    }
    if (!res.ok) throw new SyncError('httpError', String(res.status));
    return res.text();
  }

  async create(content) {
    const g = await this.req('POST', '/gists', {
      description: 'Personal Project Manager sync data (encrypted)',
      public: false,
      files: { [SYNC_FILE]: { content } },
    });
    return g.id;
  }

  async update(id, content) {
    return this.req('PATCH', `/gists/${encodeURIComponent(id)}`, { files: { [SYNC_FILE]: { content } } });
  }
}

const versionOf = (g) => (g.history && g.history[0] && g.history[0].version) || g.updated_at || '';

function payload(state) {
  return { app: 'personal-project-manager', schema: SCHEMA_VERSION, tasks: state.tasks, projects: state.projects, prefs: state.prefs };
}

/**
 * One sync round. Pulls, merges, pushes if the remote copy is missing anything.
 * `validate(remotePayload)` must return { tasks, projects, prefs } of valid records.
 * Never writes to the gist if the remote copy cannot be decrypted.
 */
export async function syncOnce(local, { token, passphrase, gistId, fetchFn, validate }) {
  if (!token) throw new SyncError('noToken');
  if (!passphrase || passphrase.length < 8) throw new SyncError('shortPassphrase');
  const client = new GistClient({ token, fetchFn });
  let id = gistId || (await client.findGist());
  if (id) {
    let gist;
    try {
      gist = await client.getGist(id);
    } catch (e) {
      if (e.code !== 'notFound') throw e;
      id = await client.findGist();
      gist = id ? await client.getGist(id) : null;
    }
    if (gist) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = versionOf(gist);
        let remoteRaw;
        try {
          remoteRaw = await decryptJSON(await client.readContent(gist), passphrase);
        } catch (e) {
          if (e instanceof SyncError) throw e;
          throw new SyncError(e.message === 'wrongPassphrase' ? 'wrongPassphrase' : 'remoteCorrupt');
        }
        if (!remoteRaw || remoteRaw.app !== 'personal-project-manager') throw new SyncError('remoteCorrupt');
        if (remoteRaw.schema > SCHEMA_VERSION) throw new SyncError('newerSchema');
        const remote = validate(remoteRaw);
        const t = mergeRecords(local.tasks, remote.tasks);
        const p = mergeRecords(local.projects, remote.projects);
        const pr = mergePrefs(local.prefs, remote.prefs);
        const merged = { tasks: t.merged, projects: p.merged, prefs: pr.merged };
        const localChanged = t.localChanged || p.localChanged || pr.localChanged;
        const remoteChanged = t.remoteChanged || p.remoteChanged || pr.remoteChanged || remote.rejected > 0;
        if (!remoteChanged) return { state: merged, gistId: id, localChanged, pushed: false };
        // Re-check right before writing so a parallel sync from the other device is not overwritten.
        const fresh = await client.getGist(id);
        if (versionOf(fresh) !== version) { gist = fresh; local = merged; continue; }
        await client.update(id, await encryptJSON(payload(merged), passphrase));
        return { state: merged, gistId: id, localChanged, pushed: true };
      }
      throw new SyncError('busy');
    }
  }
  const newId = await client.create(await encryptJSON(payload(local), passphrase));
  return { state: local, gistId: newId, localChanged: false, pushed: true, created: true };
}
