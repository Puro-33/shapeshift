// In-memory document store with optional JSON-file persistence.
// Same interface as PgStore so the app and tests run without a database.
import fs from 'node:fs';
import path from 'node:path';
import { matches, sortDocs, stamp } from './util.js';

export class MemoryStore {
  constructor({ file = null } = {}) {
    this.file = file;
    this.data = {};
    this._lock = Promise.resolve();
    this._saveTimer = null;
    if (file && fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = {}; }
    }
  }

  kind(k) { return (this.data[k] ||= {}); }

  async get(kind, id) {
    const d = this.kind(kind)[id];
    return d ? structuredClone(d) : null;
  }

  async list(kind, where = {}, opts = {}) {
    let docs = Object.values(this.kind(kind)).filter((d) => matches(d, where));
    docs = sortDocs(docs, opts.orderBy);
    if (opts.limit) docs = docs.slice(0, opts.limit);
    return structuredClone(docs);
  }

  async put(kind, doc) {
    const prev = this.kind(kind)[doc.id];
    const next = stamp(doc, prev);
    this.kind(kind)[next.id] = structuredClone(next);
    this._scheduleSave();
    return structuredClone(next);
  }

  async del(kind, id) {
    delete this.kind(kind)[id];
    this._scheduleSave();
  }

  async count(kind, where = {}) {
    return Object.values(this.kind(kind)).filter((d) => matches(d, where)).length;
  }

  // Serialized transaction: snapshot, run, restore on failure.
  async tx(fn) {
    const run = async () => {
      const snapshot = structuredClone(this.data);
      try {
        return await fn(this);
      } catch (e) {
        this.data = snapshot;
        throw e;
      }
    };
    const p = this._lock.then(run, run);
    this._lock = p.catch(() => {});
    return p;
  }

  async usage() {
    const bytes = Buffer.byteLength(JSON.stringify(this.data));
    return { bytes, limitBytes: 512 * 1024 * 1024, backend: this.file ? 'file' : 'memory' };
  }

  _scheduleSave() {
    if (!this.file) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }

  async close() { this.flush(); }
}
