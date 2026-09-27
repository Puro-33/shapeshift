// Core vocabulary shared by the operation engine, services and AI prompts.
import crypto from 'node:crypto';

export const NODE_TYPES = ['page', 'collection', 'item'];
export const FIELD_TYPES = [
  'text', 'number', 'percent', 'select', 'multi_select', 'status', 'date', 'daterange',
  'person', 'url', 'checkbox', 'relation', 'json', 'html',
];
export const VIEW_TYPES = ['table', 'board', 'calendar', 'timeline', 'list', 'gallery'];
export const BLOCK_TYPES = [
  'h1', 'h2', 'h3', 'p', 'bullet', 'number', 'todo', 'code', 'quote', 'callout', 'divider', 'table', 'image', 'html',
];
// System roles let services find well-known collections even after users rename them.
export const SYS_ROLES = ['project', 'deliverables', 'activity', 'tasks', 'findings', 'scans', 'cloudgoat', 'articles', 'imported'];
export const ROLES = ['admin', 'pm', 'member'];

export function newId(prefix = 'n') {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10)}`;
}

export function blockId() { return newId('b'); }

export function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((b) => b && typeof b === 'object')
    .map((b) => {
      const type = BLOCK_TYPES.includes(b.type) ? b.type : 'p';
      const out = { id: b.id || blockId(), type };
      if (type === 'table') out.rows = Array.isArray(b.rows) ? b.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [];
      else if (type === 'image') { out.src = String(b.src || ''); out.caption = String(b.caption || ''); }
      else if (type === 'html') { out.html = String(b.html || ''); out.title = String(b.title || ''); }
      else if (type !== 'divider') out.text = String(b.text ?? '');
      if (type === 'todo') out.checked = Boolean(b.checked);
      if (type === 'code' && b.lang) out.lang = String(b.lang);
      if (b.indent) out.indent = Math.max(0, Math.min(4, Number(b.indent) || 0));
      return out;
    });
}

export function blocksToText(blocks = []) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'h1': return `# ${b.text}`;
      case 'h2': return `## ${b.text}`;
      case 'h3': return `### ${b.text}`;
      case 'bullet': return `${'  '.repeat(b.indent || 0)}- ${b.text}`;
      case 'number': return `${'  '.repeat(b.indent || 0)}1. ${b.text}`;
      case 'todo': return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
      case 'quote': return `> ${b.text}`;
      case 'code': return '```\n' + b.text + '\n```';
      case 'divider': return '---';
      case 'table': return (b.rows || []).map((r) => `| ${r.join(' | ')} |`).join('\n');
      case 'image': return `![${b.caption || ''}](image)`;
      case 'html': return `[HTML report: ${b.title || 'untitled'}]`;
      default: return b.text || '';
    }
  }).join('\n');
}

/** Lossless-enough blocks -> Markdown for AI agents (round-trips through markdownToBlocks). */
export function blocksToMarkdown(blocks = []) {
  const out = [];
  let prev = null;
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  for (const b of blocks) {
    const list = ['bullet', 'number', 'todo'].includes(b.type);
    if (prev && !(list && ['bullet', 'number', 'todo'].includes(prev.type))) out.push('');
    const ind = '  '.repeat(b.indent || 0);
    switch (b.type) {
      case 'h1': out.push(`# ${b.text}`); break;
      case 'h2': out.push(`## ${b.text}`); break;
      case 'h3': out.push(`### ${b.text}`); break;
      case 'bullet': out.push(`${ind}- ${b.text}`); break;
      case 'number': out.push(`${ind}1. ${b.text}`); break;
      case 'todo': out.push(`${ind}- [${b.checked ? 'x' : ' '}] ${b.text}`); break;
      case 'quote': out.push(`> ${b.text}`); break;
      case 'callout': out.push(`> [!NOTE] ${b.text}`); break;
      case 'code': out.push('```' + (b.lang || ''), b.text, '```'); break;
      case 'divider': out.push('---'); break;
      case 'table': {
        const rows = b.rows || [];
        if (!rows.length) break;
        const w = Math.max(...rows.map((r) => r.length));
        const pad = (r) => [...r, ...Array(w - r.length).fill('')];
        out.push(`| ${pad(rows[0]).map(esc).join(' | ')} |`, `| ${Array(w).fill('---').join(' | ')} |`);
        for (const r of rows.slice(1)) out.push(`| ${pad(r).map(esc).join(' | ')} |`);
        break;
      }
      case 'image': out.push(`![${b.caption || ''}](${b.src})`); break;
      case 'html': out.push(`<!-- shapeshift:html id="${b.id}" title="${String(b.title || '').replace(/"/g, "'")}" (원본 HTML은 보존됨. 이 줄을 지우면 블록이 삭제돼요) -->`); break;
      default: out.push(String(b.text || '').replace(/\n/g, '<br>'));
    }
    prev = b;
  }
  return out.join('\n');
}

// Markdown -> blocks, used by agents, ingest and the Markdown edit round-trip.
export function markdownToBlocks(md = '') {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', text: buf.join('\n'), lang });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n'));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    let m;
    if ((m = line.match(/^<!--\s*shapeshift:html\s+id="([^"]+)"(?:\s+title="([^"]*)")?.*-->\s*$/))) { blocks.push({ type: 'html', id: m[1], title: m[2] || '', html: null }); i++; continue; }
    if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) { blocks.push({ type: 'image', src: m[2], caption: m[1] }); i++; continue; }
    if ((m = line.match(/^>\s*\[!(?:NOTE|TIP|INFO|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i))) { blocks.push({ type: 'callout', text: m[1] }); i++; continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) blocks.push({ type: `h${Math.min(3, m[1].length)}`, text: m[2] });
    else if ((m = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/))) blocks.push({ type: 'todo', text: m[3], checked: m[2] !== ' ' });
    else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) blocks.push({ type: 'bullet', text: m[2], indent: Math.floor(m[1].length / 2) });
    else if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) blocks.push({ type: 'number', text: m[2], indent: Math.floor(m[1].length / 2) });
    else if ((m = line.match(/^>\s?(.*)$/))) blocks.push({ type: 'quote', text: m[1] });
    else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) blocks.push({ type: 'divider' });
    else if (line.trim()) blocks.push({ type: 'p', text: line.trim().replace(/<br\s*\/?>/gi, '\n') });
    i++;
  }
  // keep html placeholders (html: null) so callers can restore the original HTML by id
  return normalizeBlocks(blocks).map((b, k) => (blocks[k]?.type === 'html' && blocks[k].html === null ? { ...b, id: blocks[k].id, html: null } : b));
}
