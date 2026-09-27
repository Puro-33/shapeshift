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

// Minimal markdown -> blocks, used by AI outputs and ingest.
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
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) blocks.push({ type: `h${m[1].length}`, text: m[2] });
    else if ((m = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/))) blocks.push({ type: 'todo', text: m[3], checked: m[2] !== ' ' });
    else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) blocks.push({ type: 'bullet', text: m[2], indent: Math.floor(m[1].length / 2) });
    else if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) blocks.push({ type: 'number', text: m[2], indent: Math.floor(m[1].length / 2) });
    else if ((m = line.match(/^>\s?(.*)$/))) blocks.push({ type: 'quote', text: m[1] });
    else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) blocks.push({ type: 'divider' });
    else if (line.trim()) blocks.push({ type: 'p', text: line.trim() });
    i++;
  }
  return normalizeBlocks(blocks);
}
