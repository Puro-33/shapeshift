// Postgres (Neon Free) document store. One JSONB table, containment queries.
import { stamp } from './util.js';

export const SCHEMA_SQL = `
create table if not exists docs (
  kind text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
create index if not exists docs_data_gin on docs using gin (data jsonb_path_ops);
create index if not exists docs_kind_created on docs (kind, created_at);
`;

export class PgStore {
  constructor(sql, { root = null } = {}) {
    this.sql = sql;
    this.root = root || sql;
  }

  static async connect(url) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, {
      ssl: 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30, // Neon may be waking from scale-to-zero
      prepare: false, // required for pooled (PgBouncer) connections
    });
    const store = new PgStore(sql);
    await sql.unsafe(SCHEMA_SQL);
    return store;
  }

  async get(kind, id) {
    const rows = await this.sql`select data from docs where kind = ${kind} and id = ${id}`;
    return rows[0]?.data ?? null;
  }

  async list(kind, where = {}, opts = {}) {
    const orderBy = opts.orderBy || 'createdAt';
    const desc = orderBy.startsWith('-');
    const key = desc ? orderBy.slice(1) : orderBy;
    const limit = opts.limit || 10000;
    const rows = desc
      ? await this.sql`select data from docs where kind = ${kind} and data @> ${this.sql.json(where)}
          order by data->>${key} desc limit ${limit}`
      : await this.sql`select data from docs where kind = ${kind} and data @> ${this.sql.json(where)}
          order by data->>${key} asc limit ${limit}`;
    return rows.map((r) => r.data);
  }

  async put(kind, doc) {
    const prev = await this.get(kind, doc.id);
    const next = stamp(doc, prev);
    await this.sql`insert into docs (kind, id, data) values (${kind}, ${next.id}, ${this.sql.json(next)})
      on conflict (kind, id) do update set data = excluded.data, updated_at = now()`;
    return next;
  }

  async del(kind, id) {
    await this.sql`delete from docs where kind = ${kind} and id = ${id}`;
  }

  async count(kind, where = {}) {
    const rows = await this.sql`select count(*)::int as n from docs where kind = ${kind} and data @> ${this.sql.json(where)}`;
    return rows[0].n;
  }

  async tx(fn) {
    if (this.sql !== this.root) return fn(this); // already inside a transaction
    return this.root.begin((tsql) => fn(new PgStore(tsql, { root: this.root })));
  }

  async usage() {
    const rows = await this.root`select pg_database_size(current_database())::bigint as bytes`;
    return { bytes: Number(rows[0].bytes), limitBytes: 512 * 1024 * 1024, backend: 'postgres' };
  }

  async close() { await this.root.end({ timeout: 5 }); }
}
