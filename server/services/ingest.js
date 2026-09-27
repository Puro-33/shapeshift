// Ingest: HTML/Markdown/JSON from people, AI chats, agents and scanners.
import { newId, normalizeBlocks, markdownToBlocks, blocksToText } from '../core/model.js';
import { OpError } from '../core/ops.js';
import { makeField } from '../core/values.js';
import { findSys, fieldByName, today } from './teams.js';
import { latestSeason, roundForDate } from './season.js';

// ---- secrets ------------------------------------------------------------
const SECRET_PATTERNS = [
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['aws-secret', /((?:aws_secret_access_key|SecretAccessKey|secret_access_key)["'\s:=]+)([A-Za-z0-9/+]{40})/gi],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{30,}\b/g],
  ['groq-key', /\bgsk_[A-Za-z0-9]{40,}\b/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['password', /((?:password|passwd|pwd|비밀번호)\s*[:=]\s*)(\S{4,})/gi],
];

export function maskSecrets(text) {
  let s = String(text ?? '');
  const found = [];
  for (const [name, re] of SECRET_PATTERNS) {
    s = s.replace(re, (...m) => {
      found.push(name);
      return m[2] !== undefined && typeof m[2] === 'string' && m.length > 4 ? `${m[1]}[MASKED:${name}]` : `[MASKED:${name}]`;
    });
  }
  return { text: s, found: [...new Set(found)] };
}

export function maskBlocks(blocks) {
  const found = new Set();
  const out = blocks.map((b) => {
    const c = { ...b };
    for (const k of ['text', 'html', 'caption']) if (typeof c[k] === 'string') { const r = maskSecrets(c[k]); c[k] = r.text; r.found.forEach((f) => found.add(f)); }
    if (c.rows) c.rows = c.rows.map((r) => r.map((cell) => { const m = maskSecrets(cell); m.found.forEach((f) => found.add(f)); return m.text; }));
    return c;
  });
  return { blocks: out, found: [...found] };
}

// ---- HTML -> blocks (dependency-free, tolerant) --------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function htmlToBlocks(html) {
  const src = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|noscript|svg|template)[\s\S]*?<\/\1>/gi, '');
  const blocks = [];
  let cur = null;
  const listStack = [];
  let table = null;
  let row = null;
  let cell = null;
  let pre = false;
  const flush = () => {
    if (cur) {
      const text = cur.type === 'code' ? cur.text.replace(/^\n+|\s+$/g, '') : cur.text.replace(/\s+/g, ' ').trim();
      if (text || cur.type === 'todo') blocks.push({ ...cur, text });
    }
    cur = null;
  };
  const start = (type, extra = {}) => { flush(); cur = { type, text: '', ...extra }; };
  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const [tok, tagRaw, attrs, textRaw] = m;
    if (textRaw !== undefined) {
      const t = decodeEntities(textRaw);
      if (cell !== null) { cell += t; continue; }
      if (!cur) { if (!t.trim()) continue; start('p'); }
      cur.text += pre ? t : t;
      continue;
    }
    const tag = tagRaw.toLowerCase();
    const closing = tok.startsWith('</');
    if (table && ['tr', 'td', 'th', 'table', 'thead', 'tbody', 'tfoot'].includes(tag)) {
      if (tag === 'tr' && !closing) row = [];
      else if (tag === 'tr' && closing) { if (row) table.rows.push(row); row = null; }
      else if ((tag === 'td' || tag === 'th') && !closing) cell = '';
      else if ((tag === 'td' || tag === 'th') && closing) { (row ||= []).push((cell || '').replace(/\s+/g, ' ').trim()); cell = null; }
      else if (tag === 'table' && closing) { if (table.rows.length) blocks.push(table); table = null; }
      continue;
    }
    if (cell !== null) { if (tag === 'br') cell += ' '; continue; }
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (closing) flush(); else start(`h${Math.min(3, Number(tag[1]))}`);
        break;
      case 'p': case 'div': case 'section': case 'article': case 'header': case 'footer': case 'figcaption': case 'dd': case 'dt':
        if (closing) flush(); else if (!cur || cur.type === 'p') start('p');
        break;
      case 'ul': case 'ol':
        flush();
        if (closing) listStack.pop(); else listStack.push(tag);
        break;
      case 'li': {
        if (closing) { flush(); break; }
        const checkbox = /type=["']?checkbox/i.test(src.slice(re.lastIndex, re.lastIndex + 120));
        start(checkbox ? 'todo' : listStack.at(-1) === 'ol' ? 'number' : 'bullet', { indent: Math.max(0, listStack.length - 1) });
        break;
      }
      case 'input':
        if (cur?.type === 'todo' && /checked/i.test(attrs)) cur.checked = true;
        break;
      case 'pre':
        if (closing) { flush(); pre = false; } else { start('code'); pre = true; }
        break;
      case 'blockquote':
        if (closing) flush(); else start('quote');
        break;
      case 'hr': flush(); blocks.push({ type: 'divider' }); break;
      case 'br': if (cur) cur.text += '\n'; break;
      case 'img': {
        const s = attrs.match(/src=["']([^"']+)["']/i)?.[1];
        const alt = attrs.match(/alt=["']([^"']*)["']/i)?.[1] || '';
        if (s && /^(https?:|data:image\/)/.test(s)) { flush(); blocks.push({ type: 'image', src: s, caption: decodeEntities(alt) }); }
        break;
      }
      case 'table':
        if (!closing) { flush(); table = { type: 'table', rows: [] }; }
        break;
      case 'strong': case 'b': if (cur) cur.text += '**'; break;
      case 'code': if (cur && cur.type !== 'code') cur.text += '`'; break;
      default: break;
    }
  }
  flush();
  if (table?.rows.length) blocks.push(table);
  return normalizeBlocks(blocks.map((b) => (b.text ? { ...b, text: b.text.replace(/\*\*\s*\*\*/g, '').replace(/``/g, '') } : b)));
}

export function toBlocks({ html, markdown, text, blocks }) {
  if (Array.isArray(blocks) && blocks.length) return normalizeBlocks(blocks);
  if (html) return htmlToBlocks(html);
  if (markdown) return markdownToBlocks(markdown);
  if (text) return markdownToBlocks(text);
  return [];
}

// ---- AI chat noise (P7) -------------------------------------------------
const NOISE_TAIL = /(붙여\s*넣|원하면|원하시면|필요하면|필요하시면|말해\s*줘|말씀해|알려\s*줘|알려\s*주세요|만들어\s*줄게|만들어\s*드릴|도움이\s*되|궁금한\s*점|더\s*필요|정리했어|정리해\s*드렸|let me know|hope this|feel free|i can also|would you like)/i;
const NOISE_HEAD = /^(물론|좋아요|좋습니다|네[,!. ]|알겠|그럼|아래는|다음은|sure|certainly|of course|here(?:'s| is| are))/i;

export function stripChatNoise(blocks) {
  const out = [...blocks];
  const removed = [];
  const soft = (b) => ['p', 'quote', 'callout'].includes(b.type);
  for (let n = 0; n < 3 && out.length; n++) {
    const last = out.at(-1);
    if (last.type === 'divider' || (soft(last) && !String(last.text).trim())) { out.pop(); continue; }
    if (soft(last) && NOISE_TAIL.test(last.text) && String(last.text).length < 240) { removed.push(out.pop().text); continue; }
    break;
  }
  while (out.length && (out.at(-1).type === 'divider' || (soft(out.at(-1)) && !String(out.at(-1).text).trim()))) out.pop();
  for (let n = 0; n < 2 && out.length; n++) {
    const first = out[0];
    if (soft(first) && !String(first.text).trim()) { out.shift(); continue; }
    if (soft(first) && NOISE_HEAD.test(String(first.text).trim()) && String(first.text).length < 160) { removed.push(out.shift().text); continue; }
    break;
  }
  return { blocks: out, removed };
}

// ---- Prowler ------------------------------------------------------------
function pick(obj, paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function normFinding(r) {
  const status = String(pick(r, ['status_code', 'Status', 'STATUS', 'status', 'finding.status_code']) || '').toUpperCase();
  return {
    checkId: String(pick(r, ['metadata.event_code', 'CheckID', 'CHECK_ID', 'check_id', 'finding_info.uid']) || 'unknown'),
    title: String(pick(r, ['finding_info.title', 'CheckTitle', 'CHECK_TITLE', 'check_title', 'message']) || ''),
    status: status.includes('FAIL') ? 'FAIL' : status.includes('PASS') ? 'PASS' : status || 'UNKNOWN',
    severity: String(pick(r, ['severity', 'Severity', 'SEVERITY']) || 'unknown').toLowerCase(),
    service: String(pick(r, ['resources.0.group.name', 'ServiceName', 'SERVICE_NAME', 'service_name']) || ''),
    region: String(pick(r, ['resources.0.region', 'cloud.region', 'Region', 'REGION', 'region']) || ''),
    resource: String(pick(r, ['resources.0.uid', 'resources.0.name', 'ResourceArn', 'ResourceId', 'RESOURCE_UID', 'RESOURCE_ARN', 'resource_uid']) || ''),
    account: String(pick(r, ['cloud.account.uid', 'AccountId', 'ACCOUNT_UID', 'ACCOUNT_ID', 'account_uid']) || ''),
    detail: String(pick(r, ['status_detail', 'StatusExtended', 'STATUS_EXTENDED']) || ''),
    remediation: String(pick(r, ['remediation.desc', 'Remediation.Recommendation.Text', 'REMEDIATION_RECOMMENDATION_TEXT']) || ''),
  };
}

export function parseProwler(content) {
  const s = String(content || '').trim();
  let rows = [];
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      rows = Array.isArray(j) ? j : j.findings || j.Findings || [j];
    } catch {
      rows = s.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
    }
    return rows.map(normFinding);
  }
  if (/<table/i.test(s)) {
    const tables = htmlToBlocks(s).filter((b) => b.type === 'table');
    const t = tables.find((x) => (x.rows[0] || []).some((h) => /check\s*id/i.test(h))) || tables.sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!t) return [];
    const [head, ...body] = t.rows;
    const idx = (re) => head.findIndex((h) => re.test(h));
    const map = { status: idx(/^status$/i), severity: idx(/severity/i), service: idx(/service/i), region: idx(/region/i), checkId: idx(/check\s*id/i), title: idx(/check\s*title/i), resource: idx(/resource\s*(id|uid|arn)/i), detail: idx(/status\s*extended/i), remediation: idx(/recommendation|remediation/i), account: idx(/account/i) };
    return body.map((r) => {
      const g = (i) => (i >= 0 ? r[i] : undefined);
      return normFinding({ Status: g(map.status), Severity: g(map.severity), ServiceName: g(map.service), Region: g(map.region), CheckID: g(map.checkId), CheckTitle: g(map.title), ResourceId: g(map.resource), StatusExtended: g(map.detail), Remediation: { Recommendation: { Text: g(map.remediation) } }, AccountId: g(map.account) });
    });
  }
  // CSV (Prowler uses ';')
  const lines = s.split(/\r?\n/).filter(Boolean);
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((l) => {
    const cells = l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    return normFinding(Object.fromEntries(head.map((h, i) => [h, cells[i]])));
  });
}

async function ensureCollection(ctx, teamId, sys, title, icon, fields, views) {
  let col = await findSys(ctx.store, teamId, sys);
  if (col) return col;
  const project = await findSys(ctx.store, teamId, 'project');
  col = {
    id: newId('n'), type: 'collection', teamId, parentId: project?.id || null, title, icon, sys, props: {}, content: [],
    fields: fields.map(makeField), views: [], sortKey: 50, createdBy: 'system', deleted: false,
  };
  const fid = (n) => col.fields.find((f) => f.name === n)?.id;
  col.views = views.map((v) => ({ id: newId('v'), type: v.type, name: v.name, config: v.groupBy ? { groupBy: fid(v.groupBy) } : v.sort ? { sort: [{ field: fid(v.sort), dir: 'desc' }] } : {} }));
  await ctx.save('node', col);
  ctx.created.push(col.id);
  return col;
}

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'informational', 'unknown'];

export async function ingestProwler(ctx, teamId, raw, { title, source } = {}) {
  const findings = parseProwler(raw);
  if (!findings.length) throw new OpError('Prowler 결과에서 finding을 찾지 못했어요 (JSON-OCSF, CSV, HTML 지원)');
  const findingsCol = await ensureCollection(ctx, teamId, 'findings', 'Prowler Findings', '🔎',
    [{ name: 'Check ID', type: 'text' }, { name: '서비스', type: 'select' }, { name: '리전', type: 'text' }, { name: '리소스', type: 'text' },
      { name: '심각도', type: 'select', options: ['critical', 'high', 'medium', 'low', 'informational'] }, { name: '상태', type: 'status', options: ['FAIL', '해결됨'] },
      { name: '첫 발견', type: 'date' }, { name: '마지막 스캔', type: 'date' }, { name: '조치 방법', type: 'text' }, { name: '연결 시나리오', type: 'relation' }],
    [{ type: 'board', name: '상태별', groupBy: '상태' }, { type: 'board', name: '심각도별', groupBy: '심각도' }, { type: 'table', name: '표' }]);
  const scansCol = await ensureCollection(ctx, teamId, 'scans', 'Prowler 스캔', '🛰️',
    [{ name: '스캔일', type: 'date' }, { name: '계정', type: 'text' }, { name: 'FAIL', type: 'number' }, { name: 'PASS', type: 'number' }, { name: '신규', type: 'number' }, { name: '해결', type: 'number' }, { name: '잔존', type: 'number' }, { name: '출처', type: 'text' }],
    [{ type: 'table', name: '최신순', sort: '스캔일' }]);
  const f = (col, n) => fieldByName(col, n).id;
  const date = today(ctx);
  const account = findings.find((x) => x.account)?.account || '';
  const existing = (await ctx.children(findingsCol.id));
  const keyOf = (x) => `${x.checkId}|${x.resource}`;
  const byKey = new Map(existing.map((it) => [`${it.props[f(findingsCol, 'Check ID')]}|${it.props[f(findingsCol, '리소스')]}`, it]));
  const fails = findings.filter((x) => x.status === 'FAIL');
  const failKeys = new Set(fails.map(keyOf));
  let created = 0; let persisting = 0; let resolved = 0;
  let sk = await ctx.nextSortKey(findingsCol.id);
  for (const x of fails) {
    const k = keyOf(x);
    const hit = byKey.get(k);
    if (hit) {
      if (hit.props[f(findingsCol, '상태')] === 'FAIL') persisting++; else created++;
      hit.props = { ...hit.props, [f(findingsCol, '상태')]: 'FAIL', [f(findingsCol, '마지막 스캔')]: date };
      await ctx.save('node', hit);
    } else {
      created++;
      const item = {
        id: newId('n'), type: 'item', teamId, parentId: findingsCol.id, title: x.title || x.checkId, sortKey: sk++, createdBy: 'ingest', deleted: false, meta: { account: x.account },
        props: { [f(findingsCol, 'Check ID')]: x.checkId, [f(findingsCol, '서비스')]: x.service, [f(findingsCol, '리전')]: x.region, [f(findingsCol, '리소스')]: x.resource, [f(findingsCol, '심각도')]: x.severity, [f(findingsCol, '상태')]: 'FAIL', [f(findingsCol, '첫 발견')]: date, [f(findingsCol, '마지막 스캔')]: date, [f(findingsCol, '조치 방법')]: x.remediation },
        content: normalizeBlocks([{ type: 'p', text: x.detail || x.title }, ...(x.remediation ? [{ type: 'h3', text: '조치 방법' }, { type: 'p', text: x.remediation }] : [])]),
      };
      for (const opt of [x.service]) { const fs = fieldByName(findingsCol, '서비스'); if (opt && !fs.options.includes(opt)) fs.options.push(opt); }
      await ctx.save('node', item);
      ctx.created.push(item.id);
    }
  }
  for (const [k, it] of byKey) {
    const sameAccount = !account || !it.meta?.account || it.meta.account === account;
    if (sameAccount && it.props[f(findingsCol, '상태')] === 'FAIL' && !failKeys.has(k)) {
      it.props = { ...it.props, [f(findingsCol, '상태')]: '해결됨', [f(findingsCol, '마지막 스캔')]: date };
      await ctx.save('node', it);
      resolved++;
    }
  }
  await ctx.save('node', findingsCol);
  const sev = {};
  for (const x of fails) sev[x.severity] = (sev[x.severity] || 0) + 1;
  const summaryMd = [
    `## 스캔 요약 (${date})`,
    `- 계정: ${account || '(알 수 없음)'}`,
    `- 전체 ${findings.length}건: FAIL ${fails.length} / PASS ${findings.filter((x) => x.status === 'PASS').length}`,
    `- 신규 FAIL ${created}, 잔존 ${persisting}, 해결 ${resolved}`,
    `- 심각도: ${SEV_ORDER.filter((s) => sev[s]).map((s) => `${s} ${sev[s]}`).join(', ') || '-'}`,
  ].join('\n');
  const scan = {
    id: newId('n'), type: 'item', teamId, parentId: scansCol.id, title: title || `Prowler 스캔 ${date}`, sortKey: await ctx.nextSortKey(scansCol.id), createdBy: 'ingest', deleted: false,
    props: { [f(scansCol, '스캔일')]: date, [f(scansCol, '계정')]: account, [f(scansCol, 'FAIL')]: fails.length, [f(scansCol, 'PASS')]: findings.length - fails.length, [f(scansCol, '신규')]: created, [f(scansCol, '해결')]: resolved, [f(scansCol, '잔존')]: persisting, [f(scansCol, '출처')]: source || 'upload' },
    content: [...markdownToBlocks(summaryMd), ...(/<html|<table/i.test(raw) ? normalizeBlocks([{ type: 'html', title: 'Prowler 원본 리포트', html: maskSecrets(raw).text }]) : [])],
  };
  await ctx.save('node', scan);
  ctx.created.push(scan.id);
  return { id: scan.id, total: findings.length, fail: fails.length, new: created, persisting, resolved };
}

// ---- macro --------------------------------------------------------------
export const ingestMacros = {
  async ingest_content(op, ctx) {
    const teamId = op.team || ctx.teamId;
    if (!teamId) throw new OpError('ingest_content needs a team context');
    const kind = op.kind || 'report';
    const raw = op.html || op.markdown || op.text || op.content || '';
    if (kind === 'prowler') return ingestProwler(ctx, teamId, raw, { title: op.title, source: op.source });

    let blocks = toBlocks({ html: op.html, markdown: op.markdown, text: op.text || (typeof op.content === 'string' ? op.content : undefined), blocks: op.blocks });
    const masked = maskBlocks(blocks);
    blocks = masked.blocks;
    const cleaned = stripChatNoise(blocks);
    blocks = cleaned.blocks;
    if (masked.found.length) ctx.notes.push(`비밀값 ${masked.found.join(', ')} 마스킹`);
    if (cleaned.removed.length) ctx.notes.push(`AI 채팅 문구 ${cleaned.removed.length}개 제거`);
    const team = await ctx.store.get('team', teamId);

    if (kind === 'article') {
      const season = team?.seasonId ? await ctx.store.get('season', team.seasonId) : await latestSeason(ctx.store);
      const round = op.round ?? (season ? roundForDate(season, today(ctx)) : null);
      const col = await findSys(ctx.store, teamId, 'deliverables');
      const fKind = fieldByName(col, '종류');
      const fRound = fieldByName(col, '차수');
      let title = op.title || blocks.find((b) => /^h[1-3]$/.test(b.type))?.text || '아티클';
      title = title.replace(/^\[[^\]]*\]\s*/, '');
      const prefix = `[${team.name}]`;
      const author = op.author || ctx.user?.name || '';
      const header = normalizeBlocks([{ type: 'callout', text: `작성자: ${author} · 팀원: ${(team.members || []).map((m) => m.name).join(', ')} · 주제: ${op.topic || team.topic || team.projectTitle}` }]);
      const content = [...header, ...blocks.filter((b, i) => !(i === 0 && /^h[1-3]$/.test(b.type) && b.text.replace(/^\[[^\]]*\]\s*/, '') === title))];
      const items = col ? await ctx.children(col.id) : [];
      let item = items.find((it) => it.props?.[fKind?.id] === '아티클' && it.props?.[fRound?.id] === round && !(it.content || []).length);
      if (!item) {
        item = { id: newId('n'), type: 'item', teamId, parentId: col.id, props: {}, sortKey: await ctx.nextSortKey(col.id), createdBy: ctx.user?.id || 'ingest', deleted: false };
        ctx.created.push(item.id);
      }
      item.title = `${prefix} ${title}`;
      item.content = content;
      item.meta = { ...(item.meta || {}), kind: 'article', slotTitle: item.meta?.slotTitle || (round ? `${round}주차 아티클` : null) };
      item.props = { ...item.props, [fKind.id]: '아티클', ...(round ? { [fRound.id]: round } : {}), [fieldByName(col, '상태').id]: '진행 중', [fieldByName(col, '담당').id]: author ? [author] : [] };
      await ctx.save('node', item);
      return { id: item.id, removedNoise: cleaned.removed.length, masked: masked.found };
    }

    // generic report / devlog: keep the original HTML (sandboxed) + extracted blocks
    const project = await findSys(ctx.store, teamId, 'project');
    const parent = op.parent ? await ctx.node(op.parent) : project;
    const pageTitle = op.title || blocks.find((b) => /^h[1-3]$/.test(b.type))?.text || `${kind === 'devlog' ? '개발 로그' : '리포트'} ${today(ctx)}`;
    const content = [...blocks];
    if (op.html) content.unshift(...normalizeBlocks([{ type: 'html', title: '원본 HTML', html: maskSecrets(op.html).text }]));
    const page = { id: newId('n'), type: parent?.type === 'collection' ? 'item' : 'page', teamId, parentId: parent?.id || null, title: pageTitle, icon: kind === 'devlog' ? '🧪' : '📄', props: {}, content: normalizeBlocks(content), sortKey: await ctx.nextSortKey(parent?.id || null), createdBy: ctx.user?.id || 'ingest', deleted: false, meta: { kind, source: op.source || 'paste' } };
    await ctx.save('node', page);
    ctx.created.push(page.id);
    await ctx.save('report', { id: newId('rp'), teamId, nodeId: page.id, kind, source: op.source || 'paste', format: op.html ? 'html' : op.markdown ? 'markdown' : 'text', raw: maskSecrets(raw).text.slice(0, 400000), text: blocksToText(blocks).slice(0, 20000) });
    ctx.pendingIngest.push({ nodeId: page.id, text: blocksToText(blocks).slice(0, 12000), kind });
    return { id: page.id, blocks: blocks.length, masked: masked.found };
  },
};
