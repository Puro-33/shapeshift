// Operation engine: the only way structure/data changes (for AI and humans alike).
// - validate shape + permissions
// - apply inside a store transaction, recording before-images for undo
// - dry-run = apply then roll back, returning a human-readable diff
import { newId, normalizeBlocks, NODE_TYPES, VIEW_TYPES, markdownToBlocks } from './model.js';
import { makeField, coerce } from './values.js';

export class OpError extends Error {
  constructor(message, { index, op } = {}) {
    super(message);
    this.index = index;
    this.op = op;
  }
}

class Rollback extends Error {}

// ---- permissions --------------------------------------------------------
const MEMBER_OK = new Set([
  'create_node', 'update_node', 'set_content', 'move_node', 'upsert_item', 'update_items', 'link',
  'create_view', 'update_view', 'log_activity', 'draft_weekly_report', 'ingest_content', 'check_rules',
  'create_team', 'sync_deliverables',
]);
const ADMIN_ONLY = new Set(['create_season', 'update_season', 'add_milestone', 'set_rules']);
export const DESTRUCTIVE = new Set(['delete_node', 'remove_field', 'merge_collections', 'convert_node', 'delete_view']);

export function isDestructive(op) {
  if (DESTRUCTIVE.has(op.op)) return true;
  if (op.op === 'update_field' && op.type) return true;
  return false;
}

// ---- context ------------------------------------------------------------
export class OpContext {
  constructor(store, { user = null, teamId = null, role = 'member', macros = {}, now = new Date() } = {}) {
    this.store = store;
    this.user = user;
    this.teamId = teamId;
    this.role = role;
    this.macros = macros;
    this.now = now;
    this.temp = new Map();
    this.before = new Map();
    this.created = [];
    this.notes = [];
    this.pendingIngest = [];
  }

  key(kind, id) { return `${kind}:${id}`; }

  async snap(kind, id) {
    const k = this.key(kind, id);
    if (!this.before.has(k)) this.before.set(k, await this.store.get(kind, id));
  }

  async save(kind, doc) {
    if (!doc.id) doc.id = newId(kind === 'node' ? 'n' : kind.slice(0, 2));
    await this.snap(kind, doc.id);
    return this.store.put(kind, doc);
  }

  async remove(kind, id) {
    await this.snap(kind, id);
    await this.store.del(kind, id);
  }

  async teamNodes() {
    const where = this.teamId ? { teamId: this.teamId } : {};
    return (await this.store.list('node', where)).filter((n) => !n.deleted);
  }

  async node(ref, { type } = {}) {
    if (ref === undefined || ref === null || ref === '') throw new OpError('missing node reference');
    let node = null;
    const r = String(ref);
    if (r.startsWith('$')) {
      const id = this.temp.get(r);
      if (!id) throw new OpError(`unknown temp ref ${r}`);
      node = await this.store.get('node', id);
    } else {
      node = await this.store.get('node', r);
      if (!node) {
        const hits = (await this.teamNodes()).filter((n) => n.title.trim().toLowerCase() === r.trim().toLowerCase());
        if (hits.length > 1) {
          const nonItems = hits.filter((n) => n.type !== 'item');
          if (nonItems.length === 1) node = nonItems[0];
          else throw new OpError(`ambiguous title "${r}" (${hits.length} matches); use the id`);
        } else node = hits[0] || null;
      }
    }
    if (!node || node.deleted) throw new OpError(`node not found: ${r}`);
    if (this.role !== 'admin' && this.teamId && node.teamId && node.teamId !== this.teamId) {
      throw new OpError(`no access to node ${r}`);
    }
    if (type && node.type !== type) throw new OpError(`node ${r} is a ${node.type}, expected ${type}`);
    return node;
  }

  async children(parentId) {
    return (await this.store.list('node', { parentId })).filter((n) => !n.deleted).sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
  }

  async nextSortKey(parentId) {
    const kids = await this.children(parentId);
    return kids.length ? Math.max(...kids.map((k) => k.sortKey ?? 0)) + 1 : 1;
  }

  field(collection, ref) {
    const r = String(ref ?? '').trim().toLowerCase();
    const f = (collection.fields || []).find((x) => x.id === ref || x.name.toLowerCase() === r);
    if (!f) throw new OpError(`field "${ref}" not found in "${collection.title}". Existing: ${(collection.fields || []).map((x) => x.name).join(', ')}`);
    return f;
  }

  // Map {fieldName: value} -> {fieldId: coerced}. autoCreate adds missing text fields.
  values(collection, values = {}, { autoCreate = true } = {}) {
    const out = {};
    for (const [name, raw] of Object.entries(values || {})) {
      if (['title', '이름', 'name'].includes(name.toLowerCase()) && !(collection.fields || []).some((f) => f.name.toLowerCase() === name.toLowerCase())) continue;
      let f;
      try { f = this.field(collection, name); } catch (e) {
        if (!autoCreate) throw e;
        f = makeField({ name, type: guessType(raw) });
        collection.fields = [...(collection.fields || []), f];
        this.notes.push(`auto-added field "${name}" to "${collection.title}"`);
      }
      const v = coerce(f, raw);
      if (v !== undefined) out[f.id] = v;
    }
    return out;
  }
}

function guessType(v) {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'checkbox';
  if (Array.isArray(v)) return 'multi_select';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return 'url';
  return 'text';
}

function blocksFrom(op) {
  if (Array.isArray(op.content)) return normalizeBlocks(op.content);
  if (typeof op.content === 'string') return markdownToBlocks(op.content);
  if (typeof op.markdown === 'string') return markdownToBlocks(op.markdown);
  return [];
}

function defaultView(type = 'table', extra = {}) {
  return { id: newId('v'), type, name: extra.name || ({ table: '표', board: '보드', calendar: '캘린더', timeline: '타임라인', list: '리스트', gallery: '갤러리' }[type] || type), config: extra.config || {} };
}

function viewFromSpec(collection, spec = {}, ctx) {
  const type = VIEW_TYPES.includes(spec.type) ? spec.type : 'table';
  const config = {};
  const fieldId = (ref) => (ref ? ctx.field(collection, ref).id : undefined);
  if (spec.groupBy) config.groupBy = fieldId(spec.groupBy);
  if (spec.dateField) config.dateField = fieldId(spec.dateField);
  if (spec.endField) config.endField = fieldId(spec.endField);
  if (spec.sort) config.sort = (Array.isArray(spec.sort) ? spec.sort : [spec.sort]).map((s) => ({ field: fieldId(s.field), dir: s.dir === 'desc' ? 'desc' : 'asc' }));
  if (spec.filter) config.filter = (Array.isArray(spec.filter) ? spec.filter : [spec.filter]).map((f) => ({ field: fieldId(f.field), op: f.op || 'eq', value: f.value }));
  if (spec.visible) config.visible = spec.visible.map(fieldId);
  if (type === 'board' && !config.groupBy) {
    const g = (collection.fields || []).find((f) => ['status', 'select'].includes(f.type));
    if (g) config.groupBy = g.id;
  }
  if (['calendar', 'timeline'].includes(type) && !config.dateField) {
    const d = (collection.fields || []).find((f) => ['date', 'daterange'].includes(f.type));
    if (d) config.dateField = d.id;
  }
  return { id: spec.id || newId('v'), type, name: spec.name || defaultView(type).name, config };
}

// ---- primitive handlers -------------------------------------------------
export const HANDLERS = {
  async create_node(op, ctx) {
    const type = NODE_TYPES.includes(op.type) ? op.type : 'page';
    let parent = null;
    if (op.parent) parent = await ctx.node(op.parent);
    if (type === 'item' && (!parent || parent.type !== 'collection')) throw new OpError('item must be created under a collection');
    if (type === 'collection' && ctx.role === 'member') throw new OpError('members cannot create collections');
    const teamId = parent?.teamId ?? ctx.teamId ?? null;
    const node = {
      id: newId('n'), type, teamId, parentId: parent?.id ?? null,
      title: String(op.title || 'Untitled'), icon: op.icon || null, sys: op.sys || null,
      props: {}, content: blocksFrom(op), sortKey: await ctx.nextSortKey(parent?.id ?? null),
      createdBy: ctx.user?.id || 'system', deleted: false,
    };
    if (type === 'collection') {
      node.fields = (op.fields || []).map(makeField);
      node.views = [];
      for (const v of op.views || []) node.views.push(viewFromSpec(node, typeof v === 'string' ? { type: v } : v, ctx));
      if (!node.views.length) node.views.push(defaultView('table'));
    }
    if (type === 'item' && (op.values || op.props)) {
      node.props = ctx.values(parent, op.values || op.props);
      await ctx.save('node', parent);
    }
    await ctx.save('node', node);
    ctx.created.push(node.id);
    if (op.ref) ctx.temp.set(op.ref.startsWith('$') ? op.ref : `$${op.ref}`, node.id);
    return { id: node.id };
  },

  async update_node(op, ctx) {
    const node = await ctx.node(op.node);
    if (op.title !== undefined) node.title = String(op.title);
    if (op.icon !== undefined) node.icon = op.icon;
    if (op.sys !== undefined) node.sys = op.sys;
    if (op.values || op.props) {
      if (node.type !== 'item') throw new OpError('values can only be set on items');
      const parent = await ctx.node(node.parentId, { type: 'collection' });
      node.props = { ...node.props, ...ctx.values(parent, op.values || op.props) };
      await ctx.save('node', parent);
    }
    await ctx.save('node', node);
    return { id: node.id };
  },

  async set_content(op, ctx) {
    const node = await ctx.node(op.node);
    const blocks = blocksFrom(op);
    node.content = op.mode === 'append' ? [...(node.content || []), ...blocks] : blocks;
    await ctx.save('node', node);
    return { id: node.id };
  },

  async move_node(op, ctx) {
    const node = await ctx.node(op.node);
    const parent = op.parent ? await ctx.node(op.parent) : null;
    if (node.type === 'item' && parent?.type !== 'collection') throw new OpError('items can only live in collections');
    let p = parent;
    while (p) { if (p.id === node.id) throw new OpError('cannot move a node into itself'); p = p.parentId ? await ctx.store.get('node', p.parentId) : null; }
    node.parentId = parent?.id ?? null;
    node.sortKey = await ctx.nextSortKey(node.parentId);
    await ctx.save('node', node);
    return { id: node.id };
  },

  async delete_node(op, ctx) {
    const node = await ctx.node(op.node);
    const stack = [node];
    let count = 0;
    while (stack.length) {
      const n = stack.pop();
      n.deleted = true;
      await ctx.save('node', n);
      count++;
      stack.push(...(await ctx.children(n.id)));
    }
    return { id: node.id, deleted: count };
  },

  async add_field(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const spec = op.field || op;
    if ((col.fields || []).some((f) => f.name.toLowerCase() === String(spec.name).toLowerCase())) {
      ctx.notes.push(`field "${spec.name}" already exists in "${col.title}"`);
      return { id: col.id };
    }
    col.fields = [...(col.fields || []), makeField(spec)];
    await ctx.save('node', col);
    return { id: col.id };
  },

  async update_field(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const f = ctx.field(col, op.field);
    if (op.name) f.name = String(op.name);
    if (op.options) f.options = [...new Set(op.options.map(String))];
    if (op.type && op.type !== f.type) {
      const nf = makeField({ ...f, type: op.type, options: op.options || f.options });
      Object.assign(f, nf, { id: f.id });
      for (const item of await ctx.children(col.id)) {
        if (item.props?.[f.id] === undefined) continue;
        const raw = Array.isArray(item.props[f.id]) ? item.props[f.id].join(', ') : item.props[f.id];
        item.props[f.id] = coerce(f, raw);
        await ctx.save('node', item);
      }
    }
    await ctx.save('node', col);
    return { id: col.id };
  },

  async remove_field(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const f = ctx.field(col, op.field);
    col.fields = col.fields.filter((x) => x.id !== f.id);
    for (const v of col.views || []) {
      for (const k of ['groupBy', 'dateField', 'endField']) if (v.config?.[k] === f.id) delete v.config[k];
    }
    for (const item of await ctx.children(col.id)) {
      if (item.props && f.id in item.props) { delete item.props[f.id]; await ctx.save('node', item); }
    }
    await ctx.save('node', col);
    return { id: col.id };
  },

  async create_view(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const view = viewFromSpec(col, op.view || op, ctx);
    col.views = [...(col.views || []), view];
    await ctx.save('node', col);
    return { id: col.id, viewId: view.id };
  },

  async update_view(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const idx = (col.views || []).findIndex((v) => v.id === op.view || v.name === op.view);
    if (idx < 0) throw new OpError(`view ${op.view} not found`);
    const merged = { ...col.views[idx], ...(op.patch || {}) };
    const rebuilt = viewFromSpec(col, { ...merged, id: col.views[idx].id, ...(op.patch || {}) }, ctx);
    if (!op.patch?.groupBy && col.views[idx].config?.groupBy) rebuilt.config.groupBy ??= col.views[idx].config.groupBy;
    col.views[idx] = rebuilt;
    await ctx.save('node', col);
    return { id: col.id };
  },

  async delete_view(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    col.views = (col.views || []).filter((v) => v.id !== op.view && v.name !== op.view);
    if (!col.views.length) col.views.push(defaultView('table'));
    await ctx.save('node', col);
    return { id: col.id };
  },

  async upsert_item(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const items = await ctx.children(col.id);
    let hit = null;
    if (op.match && Object.keys(op.match).length) {
      hit = items.find((it) => Object.entries(op.match).every(([k, v]) => {
        if (['title', '이름', 'name'].includes(k.toLowerCase())) return it.title.trim().toLowerCase() === String(v).trim().toLowerCase();
        let f; try { f = ctx.field(col, k); } catch { return false; }
        const cur = it.props?.[f.id];
        return Array.isArray(cur) ? cur.includes(v) : String(cur ?? '').toLowerCase() === String(v).toLowerCase();
      }));
    } else if (op.title) {
      hit = items.find((it) => it.title.trim().toLowerCase() === String(op.title).trim().toLowerCase());
    }
    if (hit) {
      if (op.title) hit.title = String(op.title);
      hit.props = { ...hit.props, ...ctx.values(col, op.values) };
      if (op.content || op.markdown) hit.content = op.mode === 'append' ? [...(hit.content || []), ...blocksFrom(op)] : blocksFrom(op);
      await ctx.save('node', col);
      await ctx.save('node', hit);
      return { id: hit.id, updated: true };
    }
    const res = await HANDLERS.create_node({ type: 'item', parent: col.id, title: op.title || op.match?.title || op.match?.['이름'] || 'Untitled', values: op.values, content: op.content, markdown: op.markdown, ref: op.ref }, ctx);
    return { ...res, created: true };
  },

  async update_items(op, ctx) {
    const col = await ctx.node(op.collection, { type: 'collection' });
    const items = await ctx.children(col.id);
    const where = op.where || {};
    let n = 0;
    for (const it of items) {
      const ok = Object.entries(where).every(([k, v]) => {
        if (['title', '이름', 'name'].includes(k.toLowerCase())) return it.title === v;
        const f = ctx.field(col, k);
        const cur = it.props?.[f.id];
        return Array.isArray(cur) ? cur.includes(v) : String(cur ?? '') === String(v ?? '');
      });
      if (!ok) continue;
      it.props = { ...it.props, ...ctx.values(col, op.values) };
      await ctx.save('node', it);
      n++;
    }
    await ctx.save('node', col);
    return { id: col.id, updated: n };
  },

  async link(op, ctx) {
    const from = await ctx.node(op.from, { type: 'item' });
    const to = await ctx.node(op.to);
    const col = await ctx.node(from.parentId, { type: 'collection' });
    let f;
    try { f = ctx.field(col, op.field); } catch {
      f = makeField({ name: op.field || '관련', type: 'relation', target: to.parentId });
      col.fields.push(f);
      await ctx.save('node', col);
    }
    if (f.type !== 'relation') throw new OpError(`field ${f.name} is not a relation`);
    from.props = { ...from.props, [f.id]: [...new Set([...(from.props?.[f.id] || []), to.id])] };
    await ctx.save('node', from);
    return { id: from.id };
  },

  async convert_node(op, ctx) {
    const node = await ctx.node(op.node);
    if (op.to === 'collection') {
      if (node.type !== 'page') throw new OpError('only pages can become collections');
      const blocks = node.content || [];
      const strategy = op.strategy || (blocks.some((b) => b.type === 'table') ? 'table' : blocks.some((b) => b.type === 'h2' || b.type === 'h3') ? 'headings' : 'bullets');
      node.type = 'collection';
      node.fields = [];
      node.views = [defaultView('table')];
      const items = [];
      if (strategy === 'table') {
        const table = blocks.find((b) => b.type === 'table');
        const [header = [], ...rows] = table?.rows || [];
        node.fields = header.slice(1).map((h) => makeField({ name: h || 'col', type: 'text' }));
        for (const r of rows) {
          if (!r.some((c) => c.trim())) continue;
          const props = {};
          node.fields.forEach((f, i) => { props[f.id] = r[i + 1] ?? ''; });
          items.push({ title: r[0] || 'Untitled', props, content: [] });
        }
        node.content = blocks.filter((b) => b !== table);
      } else if (strategy === 'headings') {
        const level = blocks.some((b) => b.type === 'h2') ? 'h2' : 'h3';
        let cur = null;
        const rest = [];
        for (const b of blocks) {
          if (b.type === level) { cur = { title: b.text, props: {}, content: [] }; items.push(cur); }
          else if (cur) cur.content.push(b);
          else rest.push(b);
        }
        node.content = rest;
      } else {
        const rest = [];
        for (const b of blocks) {
          if (['bullet', 'number', 'todo'].includes(b.type) && !b.indent) items.push({ title: b.text, props: {}, content: [], checked: b.checked });
          else rest.push(b);
        }
        if (blocks.some((b) => b.type === 'todo')) node.fields.push(makeField({ name: '완료', type: 'checkbox' }));
        node.content = rest;
      }
      await ctx.save('node', node);
      let sk = 1;
      for (const it of items) {
        const props = it.props;
        if (it.checked !== undefined && node.fields[0]?.type === 'checkbox') props[node.fields[0].id] = it.checked;
        const item = { id: newId('n'), type: 'item', teamId: node.teamId, parentId: node.id, title: it.title, props, content: normalizeBlocks(it.content), sortKey: sk++, createdBy: ctx.user?.id || 'system', deleted: false };
        await ctx.save('node', item);
        ctx.created.push(item.id);
      }
      return { id: node.id, items: items.length };
    }
    if (op.to === 'page') {
      if (node.type !== 'collection') throw new OpError('only collections can become pages');
      const items = await ctx.children(node.id);
      const header = ['이름', ...(node.fields || []).map((f) => f.name)];
      const rows = items.map((it) => [it.title, ...(node.fields || []).map((f) => formatCell(f, it.props?.[f.id]))]);
      node.content = [...(node.content || []), { id: newId('b'), type: 'table', rows: [header, ...rows] }];
      node.type = 'page';
      delete node.fields; delete node.views;
      await ctx.save('node', node);
      for (const it of items) { it.type = 'page'; await ctx.save('node', it); }
      return { id: node.id };
    }
    throw new OpError('convert_node.to must be "collection" or "page"');
  },

  async merge_collections(op, ctx) {
    const from = await ctx.node(op.from, { type: 'collection' });
    const into = await ctx.node(op.into, { type: 'collection' });
    if (from.id === into.id) throw new OpError('cannot merge a collection into itself');
    const map = {};
    for (const f of from.fields || []) {
      const same = (into.fields || []).find((x) => x.name.toLowerCase() === f.name.toLowerCase());
      if (same) {
        map[f.id] = same.id;
        if (same.options && f.options) same.options = [...new Set([...same.options, ...f.options])];
      } else {
        const nf = makeField({ ...f, id: undefined });
        into.fields.push(nf);
        map[f.id] = nf.id;
      }
    }
    let disc = null;
    if (op.discriminator) {
      disc = (into.fields || []).find((x) => x.name === op.discriminator);
      if (!disc) { disc = makeField({ name: op.discriminator, type: 'select', options: [into.title, from.title] }); into.fields.push(disc); }
      else disc.options = [...new Set([...(disc.options || []), into.title, from.title])];
      for (const it of await ctx.children(into.id)) {
        if (!it.props?.[disc.id]) { it.props = { ...it.props, [disc.id]: into.title }; await ctx.save('node', it); }
      }
    }
    let sk = await ctx.nextSortKey(into.id);
    let moved = 0;
    for (const it of await ctx.children(from.id)) {
      const props = {};
      for (const [k, v] of Object.entries(it.props || {})) if (map[k]) props[map[k]] = v;
      if (disc) props[disc.id] = from.title;
      it.props = props;
      it.parentId = into.id;
      it.sortKey = sk++;
      await ctx.save('node', it);
      moved++;
    }
    from.deleted = true;
    await ctx.save('node', from);
    await ctx.save('node', into);
    return { id: into.id, moved };
  },

  async check_rules() { return {}; }, // no-op marker; rules are computed on read
};

function formatCell(f, v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return v.start ? `${v.start} ~ ${v.end || ''}` : JSON.stringify(v);
  return String(v);
}

// ---- driver -------------------------------------------------------------
export function checkPermission(op, role) {
  if (role === 'admin') return null;
  if (ADMIN_ONLY.has(op.op)) return `${op.op} requires admin`;
  if (role === 'member' && !MEMBER_OK.has(op.op)) return `${op.op} requires PM or admin`;
  return null;
}

export function validateShape(ops) {
  const errors = [];
  if (!Array.isArray(ops)) return ['ops must be an array'];
  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') errors.push(`#${i}: op must be an object`);
    else if (!op.op) errors.push(`#${i}: missing "op"`);
  });
  return errors;
}

async function runOps(ctx, ops) {
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const perm = checkPermission(op, ctx.role);
    if (perm) throw new OpError(perm, { index: i, op });
    const handler = HANDLERS[op.op] || ctx.macros[op.op];
    if (!handler) throw new OpError(`unknown op "${op.op}"`, { index: i, op });
    try {
      const res = await handler(op, ctx, runOps);
      results.push({ op: op.op, ...res });
    } catch (e) {
      if (e instanceof OpError) { e.index ??= i; e.op ??= op; throw e; }
      throw new OpError(`${op.op} failed: ${e.message}`, { index: i, op });
    }
  }
  return results;
}

export async function collectDiff(ctx) {
  const diff = [];
  for (const [k, before] of ctx.before) {
    const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    const after = await ctx.store.get(kind, id);
    diff.push(describeChange(kind, before, after));
  }
  return diff.filter(Boolean);
}

function describeChange(kind, before, after) {
  const doc = after || before;
  if (!doc) return null;
  const base = { kind, id: doc.id, title: doc.title || doc.name || doc.id, type: doc.type };
  if (!before) return { ...base, action: 'create' };
  if (!after || (after.deleted && !before.deleted)) return { ...base, action: 'delete' };
  const changes = [];
  if (before.title !== after.title) changes.push(`제목: "${before.title}" → "${after.title}"`);
  if (before.type !== after.type) changes.push(`형식: ${before.type} → ${after.type}`);
  if (before.parentId !== after.parentId) changes.push('위치 이동');
  const bf = (before.fields || []).map((f) => `${f.name}:${f.type}`);
  const af = (after.fields || []).map((f) => `${f.name}:${f.type}`);
  for (const f of af) if (!bf.includes(f)) changes.push(`필드 +${f}`);
  for (const f of bf) if (!af.includes(f)) changes.push(`필드 -${f}`);
  const bv = (before.views || []).map((v) => `${v.name}(${v.type})`);
  const av = (after.views || []).map((v) => `${v.name}(${v.type})`);
  for (const v of av) if (!bv.includes(v)) changes.push(`뷰 +${v}`);
  for (const v of bv) if (!av.includes(v)) changes.push(`뷰 -${v}`);
  if (JSON.stringify(before.props || {}) !== JSON.stringify(after.props || {})) {
    const fields = after.fields || [];
    const keys = new Set([...Object.keys(before.props || {}), ...Object.keys(after.props || {})]);
    for (const key of keys) {
      if (JSON.stringify(before.props?.[key]) !== JSON.stringify(after.props?.[key])) changes.push(`값 변경(${fields.find((f) => f.id === key)?.name || '속성'})`);
    }
  }
  if (JSON.stringify(before.content || []) !== JSON.stringify(after.content || [])) changes.push(`본문 ${before.content?.length || 0}→${after.content?.length || 0} 블록`);
  if (kind !== 'node' && !changes.length) changes.push('변경');
  if (!changes.length) return null;
  return { ...base, action: 'update', changes };
}

/**
 * Execute a plan. mode 'preview' rolls back and returns the diff; mode 'apply' commits
 * and returns an oplog entry (before/after images) for undo.
 */
export async function executePlan(store, ops, { mode = 'apply', ...ctxOpts } = {}) {
  const shapeErrors = validateShape(ops);
  if (shapeErrors.length) throw new OpError(shapeErrors.join('; '));
  let out;
  try {
    await store.tx(async (tx) => {
      const ctx = new OpContext(tx, ctxOpts);
      const results = await runOps(ctx, ops);
      const diff = await collectDiff(ctx);
      const destructive = ops.some(isDestructive) || diff.some((d) => d.action === 'delete');
      if (mode === 'preview') {
        out = { results, diff, destructive, notes: ctx.notes };
        throw new Rollback();
      }
      const before = [];
      const after = [];
      for (const [k, doc] of ctx.before) {
        const kind = k.slice(0, k.indexOf(':'));
        const id = k.slice(k.indexOf(':') + 1);
        before.push({ kind, id, doc });
        after.push({ kind, id, doc: await tx.get(kind, id) });
      }
      out = { results, diff, destructive, notes: ctx.notes, before, after, created: ctx.created, pendingIngest: ctx.pendingIngest };
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out;
}

/** Undo: restore before-images. Refuses if docs changed since, unless force. */
export async function revertEntry(store, entry, { force = false } = {}) {
  return store.tx(async (tx) => {
    const conflicts = [];
    for (const a of entry.after || []) {
      const cur = await tx.get(a.kind, a.id);
      if (a.doc && cur && cur.updatedAt !== a.doc.updatedAt) conflicts.push(a.doc.title || a.id);
    }
    if (conflicts.length && !force) {
      const err = new OpError(`이후에 수정된 항목이 있어요: ${conflicts.slice(0, 5).join(', ')}`);
      err.conflicts = conflicts;
      throw err;
    }
    for (const b of entry.before || []) {
      if (b.doc) await tx.put(b.kind, b.doc);
      else await tx.del(b.kind, b.id);
    }
    return { restored: (entry.before || []).length };
  });
}
