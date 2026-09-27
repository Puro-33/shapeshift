// Notion import (one-way) via the official API with an Internal Integration token (free).
// Phase 1 fetches the tree over the network; phase 2 (import_tree macro) writes it in one
// transaction so the whole import can be undone.
import { newId, normalizeBlocks } from '../core/model.js';
import { OpError } from '../core/ops.js';
import { makeField, coerce } from '../core/values.js';
import { DELIVERABLE_FIELDS, findSys, fieldByName } from './teams.js';

const NOTION_VERSION = '2022-06-28';

export function notionId(input) {
  const m = String(input || '').replace(/-/g, '').match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
  if (!m) throw new OpError('노션 페이지 URL 또는 ID를 확인해 주세요');
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function rt(arr = []) {
  return arr.map((t) => {
    let s = t.plain_text || '';
    if (!s) return '';
    if (t.annotations?.code) s = `\`${s}\``;
    if (t.annotations?.bold) s = `**${s}**`;
    if (t.href && !/^\//.test(t.href)) s = `[${s}](${t.href})`;
    return s;
  }).join('');
}

export class NotionClient {
  constructor(token, { fetchImpl = fetch, minIntervalMs = 350 } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
    this.min = minIntervalMs;
    this.last = 0;
    this.calls = 0;
  }

  async req(method, path, body) {
    const wait = this.last + this.min - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    this.calls++;
    const res = await this.fetch(`https://api.notion.com/v1${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); return this.req(method, path, body); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new OpError(`Notion API ${res.status}: ${j.message || 'error'}${res.status === 404 ? ' (integration을 페이지에 연결했는지 확인해 주세요)' : ''}`);
    return j;
  }

  async children(id) {
    const out = [];
    let cursor;
    do {
      const j = await this.req('GET', `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      out.push(...j.results);
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);
    return out;
  }

  async queryDb(id, limit = 200) {
    const out = [];
    let cursor;
    do {
      const j = await this.req('POST', `/databases/${id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      out.push(...j.results);
      cursor = j.has_more && out.length < limit ? j.next_cursor : null;
    } while (cursor);
    return out;
  }
}

async function fetchImage(client, url) {
  try {
    const res = await client.fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1.5 * 1024 * 1024) return null;
    return { mime: res.headers.get('content-type') || 'image/png', data: buf.toString('base64'), bytes: buf.length };
  } catch { return null; }
}

async function convertBlocks(client, blocks, depth, opts, indent = 0) {
  const out = [];
  const subpages = [];
  for (const b of blocks) {
    const d = b[b.type] || {};
    const text = rt(d.rich_text);
    const push = (x) => out.push({ ...x, ...(indent && ['bullet', 'number', 'todo'].includes(x.type) ? { indent } : {}) });
    switch (b.type) {
      case 'paragraph': push({ type: 'p', text }); break;
      case 'heading_1': push({ type: 'h1', text }); break;
      case 'heading_2': push({ type: 'h2', text }); break;
      case 'heading_3': push({ type: 'h3', text }); break;
      case 'bulleted_list_item': push({ type: 'bullet', text }); break;
      case 'numbered_list_item': push({ type: 'number', text }); break;
      case 'to_do': push({ type: 'todo', text, checked: Boolean(d.checked) }); break;
      case 'toggle': push({ type: 'bullet', text }); break;
      case 'quote': push({ type: 'quote', text }); break;
      case 'callout': push({ type: 'callout', text: `${d.icon?.emoji ? `${d.icon.emoji} ` : ''}${text}` }); break;
      case 'code': push({ type: 'code', text: rt(d.rich_text), lang: d.language }); break;
      case 'divider': push({ type: 'divider' }); break;
      case 'bookmark': case 'link_preview': case 'embed': push({ type: 'p', text: `[${d.url}](${d.url})` }); break;
      case 'image': {
        const url = d.type === 'external' ? d.external?.url : d.file?.url;
        const img = opts.images && url ? await fetchImage(client, url) : null;
        push(img ? { type: 'image', src: `attachment:${opts.addImage(img)}`, caption: rt(d.caption) } : { type: 'p', text: `(이미지: ${d.type === 'external' ? url : '노션 첨부 이미지'})` });
        break;
      }
      case 'table': {
        const rows = (await client.children(b.id)).map((r) => (r.table_row?.cells || []).map((c) => rt(c)));
        push({ type: 'table', rows });
        continue;
      }
      case 'child_page': subpages.push({ kind: 'page', id: b.id, title: d.title }); continue;
      case 'child_database': subpages.push({ kind: 'database', id: b.id, title: d.title }); continue;
      default: if (text) push({ type: 'p', text });
    }
    if (b.has_children && !['child_page', 'child_database', 'table'].includes(b.type) && depth < opts.maxBlockDepth) {
      const kids = await convertBlocks(client, await client.children(b.id), depth + 1, opts, indent + 1);
      out.push(...kids.blocks);
      subpages.push(...kids.subpages);
    }
  }
  return { blocks: out, subpages };
}

function propValue(p) {
  switch (p?.type) {
    case 'title': return rt(p.title);
    case 'rich_text': return rt(p.rich_text);
    case 'select': return p.select?.name ?? null;
    case 'status': return p.status?.name ?? null;
    case 'multi_select': return (p.multi_select || []).map((x) => x.name);
    case 'date': return p.date ? (p.date.end ? { start: p.date.start?.slice(0, 10), end: p.date.end?.slice(0, 10) } : p.date.start?.slice(0, 10)) : null;
    case 'people': return (p.people || []).map((x) => x.name || x.id);
    case 'url': return p.url;
    case 'checkbox': return p.checkbox;
    case 'number': return p.number;
    case 'email': return p.email;
    case 'phone_number': return p.phone_number;
    default: return null;
  }
}

const TYPE_MAP = { rich_text: 'text', select: 'select', status: 'status', multi_select: 'multi_select', date: 'date', people: 'person', url: 'url', checkbox: 'checkbox', number: 'number', email: 'text', phone_number: 'text' };

export async function fetchNotionTree(token, root, { maxDepth = 4, maxRows = 200, images = true, fetchImpl } = {}) {
  const client = new NotionClient(token, { fetchImpl });
  const imageStore = [];
  const opts = { maxBlockDepth: 3, images, addImage: (img) => { imageStore.push(img); return imageStore.length - 1; } };
  const rootId = notionId(root);

  async function page(id, title, depth) {
    let pageTitle = title;
    let icon = null;
    if (!pageTitle) {
      const p = await client.req('GET', `/pages/${id}`);
      const tp = Object.values(p.properties || {}).find((x) => x.type === 'title');
      pageTitle = tp ? rt(tp.title) : 'Untitled';
      icon = p.icon?.emoji || null;
    }
    const { blocks, subpages } = await convertBlocks(client, await client.children(id), 0, opts);
    const node = { kind: 'page', id, title: pageTitle || 'Untitled', icon, blocks, children: [] };
    if (depth < maxDepth) for (const s of subpages) node.children.push(s.kind === 'page' ? await page(s.id, s.title, depth + 1) : await database(s.id, s.title, depth + 1));
    return node;
  }

  async function database(id, title, depth) {
    const meta = await client.req('GET', `/databases/${id}`);
    const props = Object.entries(meta.properties || {}).filter(([, p]) => p.type !== 'title').map(([name, p]) => ({
      name, type: TYPE_MAP[p.type] || 'text', options: (p[p.type]?.options || []).map((o) => o.name),
    }));
    const rows = [];
    for (const r of await client.queryDb(id, maxRows)) {
      const values = {};
      let rowTitle = 'Untitled';
      for (const [name, p] of Object.entries(r.properties || {})) {
        if (p.type === 'title') rowTitle = rt(p.title) || 'Untitled';
        else values[name] = propValue(p);
      }
      const conv = depth < maxDepth ? await convertBlocks(client, await client.children(r.id), 0, opts) : { blocks: [], subpages: [] };
      rows.push({ title: rowTitle, values, blocks: conv.blocks });
    }
    return { kind: 'database', id, title: title || rt(meta.title) || 'Database', properties: props, rows };
  }

  let tree;
  try { tree = await page(rootId, null, 0); } catch (e) {
    if (/404|object_not_found|database/i.test(e.message)) tree = await database(rootId, null, 0); else throw e;
  }
  return { tree, images: imageStore, calls: client.calls };
}

// ---- SSG-aware post-processing (G6) -------------------------------------
export function inferDeliverable(title) {
  let m;
  if ((m = title.match(/(\d+)\s*차\s*주간\s*보고/))) return { 종류: '주간보고', 차수: Number(m[1]) };
  if ((m = title.match(/(\d+)\s*주차\s*아티클/))) return { 종류: '아티클', 차수: Number(m[1]) };
  if (/킥오프/.test(title)) return { 종류: '킥오프' };
  if (/발표/.test(title)) return { 종류: '발표자료' };
  if (/github|깃허브/i.test(title)) return { 종류: '깃허브' };
  return null;
}

export function looksLikeDeliverables(props) {
  const names = props.map((p) => p.name);
  return ['종류', '상태'].every((n) => names.includes(n)) && names.some((n) => /D-?day|마감|기한/.test(n));
}

export const notionMacros = {
  async import_tree(op, ctx) {
    const { tree, images = [], teamId = ctx.teamId, parent } = op;
    if (!tree) throw new OpError('import_tree needs a fetched tree');
    const attIds = [];
    for (const img of images) {
      const id = newId('att');
      await ctx.save('attachment', { id, teamId, mime: img.mime, data: img.data, bytes: img.bytes, source: 'notion' });
      attIds.push(id);
    }
    const fixBlocks = (blocks) => normalizeBlocks(blocks.map((b) => (b.type === 'image' && String(b.src).startsWith('attachment:') ? { ...b, src: `/api/attachments/${attIds[Number(b.src.slice(11))]}` } : b)));
    let parentNode = parent ? await ctx.node(parent) : null;
    if (!parentNode && teamId) parentNode = await findSys(ctx.store, teamId, 'project');
    const suggestions = [];
    let count = 0;

    const write = async (t, parentId) => {
      if (t.kind === 'page') {
        const node = { id: newId('n'), type: 'page', teamId, parentId, title: t.title, icon: t.icon, props: {}, content: fixBlocks(t.blocks || []), sortKey: await ctx.nextSortKey(parentId), createdBy: 'import:notion', deleted: false, meta: { notionId: t.id } };
        await ctx.save('node', node); ctx.created.push(node.id); count++;
        for (const c of t.children || []) await write(c, node.id);
        return node;
      }
      const isDeliv = looksLikeDeliverables(t.properties);
      const existingDeliv = isDeliv && teamId ? await findSys(ctx.store, teamId, 'deliverables') : null;
      let col;
      if (existingDeliv) {
        col = existingDeliv; // merge into the team's 산출물 instead of duplicating
      } else {
        col = { id: newId('n'), type: 'collection', teamId, parentId, title: t.title, icon: isDeliv ? '📦' : '🗂️', sys: null, props: {}, content: [], fields: t.properties.map(makeField), views: [{ id: newId('v'), type: 'table', name: '표', config: {} }], sortKey: await ctx.nextSortKey(parentId), createdBy: 'import:notion', deleted: false, meta: { notionId: t.id } };
        if (isDeliv) {
          for (const f of DELIVERABLE_FIELDS()) if (!fieldByName(col, f.name)) col.fields.push(f);
          col.sys = teamId && !(await findSys(ctx.store, teamId, 'deliverables')) ? 'deliverables' : null;
        }
        await ctx.save('node', col); ctx.created.push(col.id); count++;
      }
      const siblings = await ctx.children(col.id);
      let sk = await ctx.nextSortKey(col.id);
      for (const r of t.rows) {
        const values = { ...r.values };
        if (isDeliv) {
          const inf = inferDeliverable(r.title);
          if (inf) {
            for (const [k, v] of Object.entries(inf)) if (values[k] === null || values[k] === undefined || values[k] === '') { values[k] = v; suggestions.push(`${r.title}: ${k}=${v} (추론)`); }
          }
        }
        const props = {};
        for (const [name, v] of Object.entries(values)) {
          let f = fieldByName(col, name);
          if (!f) { f = makeField({ name, type: 'text' }); col.fields.push(f); }
          const cv = coerce(f, v);
          if (cv !== undefined && cv !== null) props[f.id] = cv;
        }
        const same = siblings.find((s) => s.title === r.title);
        if (same && !(same.content || []).length) {
          same.props = { ...same.props, ...props };
          same.content = fixBlocks(r.blocks || []);
          same.meta = { ...(same.meta || {}), importedFrom: 'notion' };
          await ctx.save('node', same);
        } else {
          const item = { id: newId('n'), type: 'item', teamId, parentId: col.id, title: r.title, props, content: fixBlocks(r.blocks || []), sortKey: sk++, createdBy: 'import:notion', deleted: false, meta: { importedFrom: 'notion' } };
          await ctx.save('node', item); ctx.created.push(item.id);
        }
        count++;
      }
      // Duplicate titles (e.g. timeline "주간 보고서 제출 (1)" x9) -> suggestion, not auto-delete
      const titles = t.rows.map((r) => r.title);
      const dup = [...new Set(titles.filter((x, i) => titles.indexOf(x) !== i))];
      for (const d of dup) suggestions.push(`"${t.title}"에 "${d}" 항목이 ${titles.filter((x) => x === d).length}개 중복돼요`);
      const oldYear = t.rows.filter((r) => Object.values(r.values).some((v) => typeof v === 'string' && /^20\d\d-/.test(v) && Number(v.slice(0, 4)) < ctx.now.getFullYear()));
      if (oldYear.length) suggestions.push(`"${t.title}"에 지난 연도 날짜가 남은 항목 ${oldYear.length}개가 있어요`);
      await ctx.save('node', col);
      return col;
    };

    const root = await write(tree, parentNode?.id || null);
    ctx.notes.push(...suggestions.slice(0, 30));
    return { id: root.id, imported: count, suggestions: suggestions.length };
  },
};
