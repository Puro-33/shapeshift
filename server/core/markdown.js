// Node <-> Markdown documents for personal AI agents (BYO-AI).
// An agent reads a document, edits it as plain text, and submits it back; the server
// turns the difference into operations, previews them, and applies them (undoable).
import { blocksToMarkdown, markdownToBlocks } from './model.js';
import { OpError } from './ops.js';

// ---- tiny YAML subset (front matter) -------------------------------------
function yamlScalar(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return `[${v.map((x) => yamlScalar(x)).join(', ')}]`;
  if (typeof v === 'object') return v.start !== undefined ? `${v.start || ''} ~ ${v.end || ''}` : JSON.stringify(v);
  const s = String(v);
  return /^[\s]|[\s]$|^[\[\]{}"'#&*!|>%@`]|: |\n|^(true|false|null|~)$/i.test(s) || s === '' ? JSON.stringify(s) : s;
}

export function toFrontMatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.start === undefined) {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${yamlScalar(v2)}`);
    } else lines.push(`${k}: ${yamlScalar(v)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (/^'.*'$/.test(s)) return s.slice(1, -1);
  if (/^\[.*\]$/.test(s)) {
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => parseScalar(x)).filter((x) => x !== null && x !== '') : [];
  }
  return s;
}

export function splitFrontMatter(md) {
  const text = String(md || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let section = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const nested = line.match(/^\s{2,}([^:]+):\s?(.*)$/);
    if (nested && section) { meta[section][nested[1].trim()] = parseScalar(nested[2]); continue; }
    const top = line.match(/^([^:\s][^:]*):\s?(.*)$/);
    if (!top) continue;
    const key = top[1].trim();
    if (top[2].trim() === '') { meta[key] = {}; section = key; } else { meta[key] = parseScalar(top[2]); section = null; }
  }
  return { meta, body: text.slice(m[0].length) };
}

// ---- export -------------------------------------------------------------
function fieldSpec(f) {
  return `${f.type}${f.options?.length ? ` [${f.options.join(', ')}]` : ''}`;
}

function cell(f, v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return v.start !== undefined ? `${v.start || ''} ~ ${v.end || ''}` : JSON.stringify(v);
  if (f?.type === 'checkbox') return v ? 'true' : 'false';
  return String(v);
}

/** Markdown document for a page/item/collection. */
export function nodeToMarkdown(node, { parent = null, children = [], team = null } = {}) {
  const meta = { shapeshift: 1, id: node.id, type: node.type, title: node.title };
  if (node.icon) meta.icon = node.icon;
  if (parent) meta.parent = `${parent.id} (${parent.title})`;
  if (team) meta.team = `${team.id} (${team.name})`;
  if (node.sys) meta.role = node.sys;
  if (node.type === 'item' && parent?.fields) {
    const props = {};
    for (const f of parent.fields) props[f.name] = node.props?.[f.id] ?? null;
    meta.properties = props;
  }
  if (node.type === 'collection') {
    meta.fields = Object.fromEntries((node.fields || []).map((f) => [f.name, fieldSpec(f)]));
    meta.views = (node.views || []).map((v) => `${v.name}(${v.type})`).join(', ');
  }
  const parts = [toFrontMatter(meta), '', `# ${node.title}`];
  const body = blocksToMarkdown(node.content || []);
  if (body.trim()) parts.push('', body);
  if (node.type === 'collection') {
    const fields = node.fields || [];
    const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    parts.push('', '<!-- 항목 표: id가 있는 행은 수정, id가 빈 행은 새 항목으로 추가돼요. 행을 지워도 항목은 삭제되지 않아요(삭제는 ops JSON의 delete_node). -->');
    parts.push(`| id | 이름 | ${fields.map((f) => esc(f.name)).join(' | ')} |`);
    parts.push(`| --- | --- | ${fields.map(() => '---').join(' | ')} |`);
    for (const it of children.filter((c) => c.type === 'item')) {
      parts.push(`| ${it.id} | ${esc(it.title)} | ${fields.map((f) => esc(cell(f, it.props?.[f.id]))).join(' | ')} |`);
    }
  } else if (children.length) {
    parts.push('', '<!-- 하위 페이지 (읽기 전용 목록) -->');
    for (const c of children) parts.push(`<!-- child: ${c.id} ${c.type} ${c.title.replace(/--/g, '-')} -->`);
  }
  return `${parts.join('\n')}\n`;
}

// ---- import (Markdown -> ops) --------------------------------------------
function stripChildComments(body) {
  return body.split('\n').filter((l) => !/^<!--\s*(child:|하위 페이지|항목 표)/.test(l.trim())).join('\n');
}

function parseCell(f, raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  switch (f.type) {
    case 'multi_select': case 'person': case 'relation': return s.split(',').map((x) => x.trim()).filter(Boolean);
    case 'checkbox': return /^(true|yes|y|1|o|✔|✓|x|완료)$/i.test(s);
    case 'number': case 'percent': return Number(s.replace(/[%,]/g, ''));
    case 'daterange': { const [a, b] = s.split(/\s*~\s*/); return { start: a || null, end: b || a || null }; }
    default: return s;
  }
}

function sameValue(a, b) {
  const n = (v) => (v === undefined || v === '' || (Array.isArray(v) && !v.length) ? null : v);
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
}

function parseFieldSpec(spec) {
  const m = String(spec || 'text').match(/^\s*([a-z_]+)\s*(?:\[(.*)\])?\s*$/);
  if (!m) return { type: 'text' };
  return { type: m[1], options: m[2] ? m[2].split(',').map((x) => x.trim()).filter(Boolean) : undefined };
}

/**
 * Compute operations that turn `node` into what the edited Markdown describes.
 * Returns { ops, warnings }.
 */
export async function markdownToOps(store, nodeId, markdown) {
  const node = await store.get('node', nodeId);
  if (!node || node.deleted) throw new OpError('노드를 찾을 수 없어요');
  const { meta, body } = splitFrontMatter(markdown);
  const warnings = [];
  if (meta.id && meta.id !== node.id) throw new OpError(`문서의 id(${meta.id})가 편집 대상(${node.id})과 달라요`);
  const ops = [];
  const lines = stripChildComments(body).replace(/^\n+/, '').split('\n');
  // title: front matter wins; otherwise the first H1
  let title = typeof meta.title === 'string' ? meta.title : null;
  if (lines[0]?.startsWith('# ')) {
    const h1 = lines.shift().slice(2).trim();
    if (title === null || (title === node.title && h1 !== node.title)) title = h1;
  }
  const update = { op: 'update_node', node: node.id };
  if (title && title !== node.title) update.title = title;
  if (meta.icon !== undefined && meta.icon !== node.icon) update.icon = meta.icon;

  if (node.type === 'item' && meta.properties && typeof meta.properties === 'object') {
    const parent = await store.get('node', node.parentId);
    const values = {};
    for (const [name, raw] of Object.entries(meta.properties)) {
      const f = (parent?.fields || []).find((x) => x.name === name);
      const v = f ? (Array.isArray(raw) || raw === null || typeof raw !== 'string' ? (f.type === 'daterange' && typeof raw === 'string' ? parseCell(f, raw) : raw) : parseCell(f, raw)) : raw;
      if (!f) { values[name] = v; warnings.push(`새 속성 "${name}"이 텍스트 필드로 추가돼요`); continue; }
      if (!sameValue(node.props?.[f.id], v)) values[name] = v;
    }
    if (Object.keys(values).length) update.values = values;
  }
  if (Object.keys(update).length > 2) ops.push(update);

  if (node.type === 'collection') {
    // fields
    const fieldsMeta = meta.fields && typeof meta.fields === 'object' ? meta.fields : {};
    for (const [name, spec] of Object.entries(fieldsMeta)) {
      const { type, options } = parseFieldSpec(spec);
      const f = (node.fields || []).find((x) => x.name === name);
      if (!f) ops.push({ op: 'add_field', collection: node.id, field: { name, type, ...(options ? { options } : {}) } });
      else {
        const patch = {};
        if (type !== f.type) { patch.type = type; warnings.push(`"${name}" 필드 형식 변경(${f.type}→${type})은 기존 값이 변환돼요`); }
        if (options && JSON.stringify(options) !== JSON.stringify(f.options || [])) patch.options = options;
        if (Object.keys(patch).length) ops.push({ op: 'update_field', collection: node.id, field: f.id, ...patch });
      }
    }
    for (const f of node.fields || []) if (!(f.name in fieldsMeta) && Object.keys(fieldsMeta).length) warnings.push(`"${f.name}" 필드가 문서에서 빠졌지만 삭제하지 않았어요 (삭제는 remove_field)`);
    // item table = the table whose header starts with id | 이름
    const blocks = markdownToBlocks(lines.join('\n'));
    const tIdx = blocks.findIndex((b) => b.type === 'table' && /^id$/i.test(b.rows?.[0]?.[0] || '') );
    const desc = blocks.filter((_, i) => i !== tIdx);
    const descOld = node.content || [];
    if (JSON.stringify(desc.map((b) => [b.type, b.text])) !== JSON.stringify(descOld.map((b) => [b.type, b.text]))) ops.push({ op: 'set_content', node: node.id, content: desc });
    if (tIdx >= 0) {
      const [head, ...rows] = blocks[tIdx].rows;
      const cols = head.slice(2);
      const items = (await store.list('node', { parentId: node.id })).filter((n) => !n.deleted);
      const allFields = [...(node.fields || []), ...Object.entries(fieldsMeta).filter(([n]) => !(node.fields || []).some((f) => f.name === n)).map(([name, spec]) => ({ name, ...parseFieldSpec(spec) }))];
      for (const r of rows) {
        const [id, rowTitle] = [String(r[0] || '').trim(), String(r[1] || '').trim()];
        if (!id && !rowTitle && r.slice(2).every((c) => !String(c).trim())) continue;
        const values = {};
        const it = id ? items.find((x) => x.id === id) : null;
        if (id && !it) { warnings.push(`표의 id ${id}를 찾지 못해 새 항목으로 추가해요`); }
        cols.forEach((name, i) => {
          const f = allFields.find((x) => x.name === name);
          if (!f) return;
          const v = parseCell(f, r[i + 2]);
          if (!it || !sameValue(it.props?.[f.id], v)) values[name] = v;
        });
        if (it) {
          const op = { op: 'update_node', node: it.id };
          if (rowTitle && rowTitle !== it.title) op.title = rowTitle;
          if (Object.keys(values).length) op.values = values;
          if (Object.keys(op).length > 2) ops.push(op);
        } else {
          ops.push({ op: 'create_node', type: 'item', parent: node.id, title: rowTitle || '새 항목', values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) });
        }
      }
      const seen = new Set(rows.map((r) => String(r[0] || '').trim()).filter(Boolean));
      const missing = items.filter((x) => !seen.has(x.id));
      if (missing.length) warnings.push(`표에서 빠진 항목 ${missing.length}개는 그대로 두었어요`);
    }
    return { ops, warnings };
  }

  // page / item body
  let blocks = markdownToBlocks(lines.join('\n'));
  const oldHtml = new Map((node.content || []).filter((b) => b.type === 'html').map((b) => [b.id, b]));
  blocks = blocks.filter((b) => {
    if (b.type !== 'html' || b.html !== null) return true;
    const orig = oldHtml.get(b.id);
    if (!orig) { warnings.push(`알 수 없는 HTML 블록 ${b.id}는 무시했어요`); return false; }
    return true;
  }).map((b) => (b.type === 'html' && b.html === null ? { ...oldHtml.get(b.id) } : b));
  const sig = (bs) => JSON.stringify(bs.map((b) => [b.type, b.text ?? '', b.checked ?? null, b.rows ?? null, b.src ?? null, b.indent || 0, b.type === 'html' ? b.id : null]));
  if (sig(blocks) !== sig(node.content || [])) ops.push({ op: 'set_content', node: node.id, content: blocks });
  const dropped = [...oldHtml.keys()].filter((id) => !blocks.some((b) => b.id === id));
  if (dropped.length) warnings.push(`HTML 리포트 블록 ${dropped.length}개가 문서에서 빠져 삭제돼요`);
  return { ops, warnings };
}

/** Whole-workspace outline an agent can read in one request. */
export function workspaceOutline({ team, season, nodes, requests = [], today, base = '' }) {
  const out = [];
  out.push(toFrontMatter({ shapeshift: 1, kind: 'workspace', team: `${team.id} (${team.name})`, project: team.projectTitle, today }));
  out.push('', `# ${team.projectTitle}`, '', `- 팀: ${team.name}`, `- 팀원: ${(team.members || []).map((m) => (m.role === 'pm' ? `${m.name}(PM)` : m.name)).join(', ')}`);
  if (season) {
    out.push(`- 시즌: ${season.name} (${season.start || '?'} ~ ${season.end || '?'})`);
    const up = (season.milestones || []).filter((m) => (m.due || m.start) && (m.due || m.start) >= today).slice(0, 6);
    if (up.length) { out.push('', '## 다가오는 일정'); for (const m of up) out.push(`- ${m.due || m.start} ${m.title}`); }
    if (season.rules?.length) { out.push('', '## 동아리 규칙'); for (const r of season.rules) out.push(`- ${r.label}${r.sections ? `: ${r.sections.map((s) => s.label).join(' / ')}` : r.template ? `: ${r.template}` : ''}`); }
  }
  if (requests.length) { out.push('', '## 사람 입력 요청'); for (const r of requests) out.push(`- ${r.assignee ? `${r.assignee}: ` : ''}${r.text}`); }
  out.push('', '## 구조', '', '각 노드는 `/p/{id}` (HTML), `/p/{id}.md` (Markdown), `/p/{id}.json` 으로 읽을 수 있어요.', '');
  const kids = new Map();
  for (const n of nodes) { const k = n.parentId || 'root'; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
  const walk = (pid, depth) => {
    for (const n of (kids.get(pid) || []).sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))) {
      if (n.type === 'item') continue;
      const items = (kids.get(n.id) || []).filter((x) => x.type === 'item');
      const extra = n.type === 'collection' ? ` · 필드: ${(n.fields || []).map((f) => `${f.name}(${f.type})`).join(', ')} · 항목 ${items.length}개` : '';
      out.push(`${'  '.repeat(depth)}- [${n.title}](${base}/p/${n.id}.md) \`${n.id}\` ${n.type}${n.sys ? ` role=${n.sys}` : ''}${extra}`);
      walk(n.id, depth + 1);
    }
  };
  walk('root', 0);
  out.push('', '## 편집하는 법', '', `- 문서 편집: \`/p/{id}.md\`를 고쳐서 \`POST ${base}/api/nodes/{id}/markdown\` (또는 /p/{id} 페이지의 Markdown 편집 폼)`, `- 구조 변경: Operation JSON을 \`POST ${base}/api/prompts\` {teamId, ops}로 제출 → 미리보기 → \`POST /api/prompts/{id}/apply\``, `- 전체 안내: ${base}/agent`);
  return `${out.join('\n')}\n`;
}
