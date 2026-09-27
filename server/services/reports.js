// Weekly report drafting (S4), rule validation, and self-contained HTML export (P9).
import { newId, markdownToBlocks, normalizeBlocks } from '../core/model.js';
import { OpError } from '../core/ops.js';
import { evaluateRules, expectedFilename, SSG_DEFAULT_RULES } from '../core/rules.js';
import { periodForRound, roundForDate, addDays, latestSeason } from './season.js';
import { findSys, fieldByName, today } from './teams.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function mdLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`;
}

function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}_ ]/gu, ' ').split(/\s+/).filter((t) => t.length >= 2);
}
function overlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size) return 0;
  let n = 0;
  for (const t of A) if ([...B].some((x) => x.includes(t) || t.includes(x))) n++;
  return n / A.size;
}

export function sectionBullets(blocks = [], keywords) {
  const idx = blocks.findIndex((b) => /^h[1-3]$/.test(b.type) && keywords.some((k) => String(b.text).includes(k)));
  if (idx < 0) return [];
  const level = Number(blocks[idx].type[1]);
  const out = [];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (/^h[1-3]$/.test(b.type) && Number(b.type[1]) <= level) break;
    if (['bullet', 'number', 'todo'].includes(b.type) && b.text.trim() && !/^\(?작성 필요\)?$/.test(b.text.trim())) out.push(b.text.trim());
  }
  return out;
}

async function teamContext(store, teamId) {
  const team = await store.get('team', teamId);
  if (!team) throw new OpError('team not found');
  const season = team.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
  return { team, season };
}

async function itemsOf(ctxOrStore, col) {
  const store = ctxOrStore.store || ctxOrStore;
  return col ? (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted) : [];
}

export async function findReportItem(store, team, round, kind = '주간보고') {
  const col = await findSys(store, team.id, 'deliverables');
  if (!col) return { col: null, item: null };
  const fk = fieldByName(col, '종류');
  const fr = fieldByName(col, '차수');
  const items = await itemsOf(store, col);
  const item = items.find((it) => it.props?.[fk?.id] === kind && it.props?.[fr?.id] === round)
    || items.find((it) => it.title === (kind === '주간보고' ? `${round}차 주간보고서` : `${round}주차 아티클`));
  return { col, item };
}

/** Compute report data from activity/tasks/previous report. Pure-ish: reads only. */
export async function computeWeekly(store, teamId, round, { now = new Date(), extras = {} } = {}) {
  const { team, season } = await teamContext(store, teamId);
  const todayIso = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (round === undefined || round === null) round = season ? roundForDate(season, todayIso) : 1;
  const period = (season && periodForRound(season, round)) || { start: addDays(todayIso, -6), end: todayIso, due: addDays(todayIso, 2) };

  const members = team.members || [];
  const activityCol = await findSys(store, team.id, 'activity');
  const fDate = fieldByName(activityCol, '날짜');
  const fWho = fieldByName(activityCol, '팀원');
  const activities = (await itemsOf(store, activityCol))
    .map((it) => ({ id: it.id, title: it.title, text: (it.content || []).map((b) => b.text || '').join(' ') || it.title, date: it.props?.[fDate?.id] || it.createdAt?.slice(0, 10), who: it.props?.[fWho?.id] || [] }))
    .filter((a) => a.date && a.date >= period.start && a.date <= period.due)
    .sort((a, b) => a.date.localeCompare(b.date));

  const tasksCol = await findSys(store, team.id, 'tasks');
  const tStatus = fieldByName(tasksCol, '상태');
  const tWho = fieldByName(tasksCol, '담당');
  const tDue = fieldByName(tasksCol, '마감');
  const tasks = (await itemsOf(store, tasksCol)).map((t) => ({ title: t.title, status: t.props?.[tStatus?.id], who: t.props?.[tWho?.id] || [], due: t.props?.[tDue?.id], updated: t.updatedAt?.slice(0, 10) }));

  const prev = round > 1 ? (await findReportItem(store, team, round - 1)).item : null;
  const prevPlan = prev ? sectionBullets(prev.content, ['차주 계획', '다음 주']) : [];
  const teamGoals = extras.goals?.length ? extras.goals : prevPlan;

  const perMember = members.map((m) => {
    const mine = activities.filter((a) => a.who.includes(m.name));
    const myTasks = tasks.filter((t) => t.who.includes(m.name) && (!t.due || (t.due >= period.start && t.due <= period.due) || t.status === '진행 중'));
    const personal = teamGoals.filter((g) => g.includes(m.name));
    const goals = [...new Set([...myTasks.map((t) => t.title), ...(personal.length ? personal : teamGoals.filter((g) => !members.some((o) => o.name !== m.name && g.includes(o.name))))])];
    const doneGoals = goals.filter((g) => myTasks.some((t) => t.title === g && t.status === '완료') || mine.some((a) => overlap(g, a.text) >= 0.5));
    const pct = goals.length ? Math.round((doneGoals.length / goals.length) * 100) : null;
    return {
      name: m.name, role: m.role, goals, done: mine.map((a) => a.title), doneGoals,
      status: pct === null ? (mine.length ? `활동 ${mine.length}건` : '') : pct === 100 ? '완료' : `${pct}%`,
      pct,
    };
  });

  return { team, season, round, period, activities, perMember, prevPlan, teamGoals, prevId: prev?.id || null };
}

export function renderWeeklyBlocks(data, extras = {}, existing = []) {
  const { team, round, period, activities, perMember, teamGoals } = data;
  const names = perMember.map((m) => m.name);
  const byDate = new Map();
  for (const a of activities) {
    if (!byDate.has(a.date)) byDate.set(a.date, []);
    byDate.get(a.date).push(a);
  }
  const keepImages = (() => {
    const i = existing.findIndex((b) => /^h[1-3]$/.test(b.type) && /회의 사진/.test(b.text));
    if (i < 0) return [];
    const out = [];
    for (let j = i + 1; j < existing.length && !/^h[1-3]$/.test(existing[j].type); j++) if (existing[j].type === 'image') out.push(existing[j]);
    return out;
  })();
  const keepBullets = (kw) => sectionBullets(existing, kw);
  const list = (arr, fallback = '(작성 필요)') => (arr?.length ? arr : [fallback]).map((t) => `- ${t}`);

  const md = [
    '## 프로젝트 개요',
    `프로젝트 주제 : ${team.topic || team.projectTitle}`,
    `팀 이름 : ${team.name}`,
    `팀 구성원 : ${(team.members || []).map((m) => (m.role === 'pm' ? `${m.name}(PM)` : m.name)).join(', ')}`,
    `주간 보고서 제출 날짜 : ${extras.submitDate || period.due}`,
    '## 이번 주 목표 & 성공기준',
    ...list(teamGoals.map((g) => (extras.successCriteria?.[g] ? `${g} (성공기준: ${extras.successCriteria[g]})` : g)), '(지난 차주 계획이 없어요. 목표를 입력해 주세요)'),
    '## 일 단위 활동 내용 보고',
    `${mdLabel(period.start)} ~ ${mdLabel(period.end)} 기준`,
  ];
  if (!byDate.size) md.push('- (이번 기간 활동 로그가 없어요)');
  for (const [d, arr] of byDate) {
    md.push(`### ${mdLabel(d)}`);
    for (const a of arr) md.push(`- ${a.title}${a.who.length ? ` (${a.who.join(', ')})` : ''}`);
  }
  md.push('## 금주 팀원 별 수행 업무');
  md.push('| 이름 | 수행 업무 |', '| --- | --- |');
  for (const m of perMember) md.push(`| ${m.name} | ${m.done.join(' / ').replace(/\|/g, '/') || '-'} |`);
  md.push('## 계획 대비 실적 (지난 주간)');
  md.push(`| 구분 | ${names.join(' | ')} |`, `| --- | ${names.map(() => '---').join(' | ')} |`);
  md.push(`| 이번 주 목표 | ${perMember.map((m) => m.goals.join(' / ').replace(/\|/g, '/') || '-').join(' | ')} |`);
  md.push(`| 금주 수행 현황 | ${perMember.map((m) => m.status || '-').join(' | ')} |`);
  md.push(`| 수행 완료 항목 | ${perMember.map((m) => (m.doneGoals.length ? m.doneGoals : m.done).join(' / ').replace(/\|/g, '/') || '-').join(' | ')} |`);
  md.push(`| 수행 현황에 따른 편차 사유 | ${perMember.map((m) => (extras.deviation?.[m.name] || '')).join(' | ')} |`);
  md.push('## 회의 사진');
  const photoIdx = md.length;
  md.push('## 핵심 인사이트');
  md.push(...list(extras.insights?.length ? extras.insights : keepBullets(['핵심 인사이트'])));
  md.push('### 이슈 사항 및 제한 사항');
  md.push(...list(extras.issues?.length ? extras.issues : keepBullets(['이슈 사항']), '없음'));
  md.push('## 도움 필요(Ask)');
  md.push(...list(extras.asks?.length ? extras.asks : keepBullets(['도움 필요'])));
  md.push('## 차주 계획');
  md.push(...list(extras.next?.length ? extras.next : keepBullets(['차주 계획'])));

  const blocks = markdownToBlocks(md.slice(0, photoIdx).join('\n'));
  // The 이슈 subheading is h3 under 핵심 인사이트; keep it out of the insights count by
  // making it its own h2-level sibling for validation purposes.
  blocks.push(...(keepImages.length ? keepImages : [{ type: 'p', text: '(사진 첨부)' }]).map((b) => ({ ...b })));
  const rest = markdownToBlocks(md.slice(photoIdx).join('\n')).map((b) => (b.type === 'h3' && /이슈 사항/.test(b.text) ? { ...b, type: 'h2' } : b));
  blocks.push(...rest);
  return normalizeBlocks(blocks);
}

export function checklistBlocks(result) {
  const labels = [
    ['goals', '이번 주 목표 & 성공기준이 작성 되었는가?'],
    ['planned_vs_done', '계획 대비 실적이 작성 되었는가?'],
    ['insights', '핵심 인사이트 1~3개 작성 되었는가?'],
    ['ask', '도움 필요(Ask)가 작성 되었는가?'],
    ['next', '차주 실행 계획에 대해 작성 되었는가?'],
    ['photo', '회의 사진이 첨부 되었는가?'],
  ];
  return normalizeBlocks([
    { type: 'h2', text: '체크리스트' },
    ...labels.map(([key, text]) => ({ type: 'todo', text, checked: Boolean(result.checks.find((c) => c.key === key)?.passed) })),
  ]);
}

/** afterOps hook: keep weekly-report checklists in sync with rule checks after any edit. */
export async function refreshChecklists(ctx) {
  for (const k of [...ctx.before.keys()]) {
    if (!k.startsWith('node:')) continue;
    const node = await ctx.store.get('node', k.slice(5));
    if (!node || node.deleted || node.type !== 'item') continue;
    const blocks = node.content || [];
    const i = blocks.findIndex((b) => /^h[1-3]$/.test(b.type) && /체크리스트/.test(b.text));
    if (i < 0) continue;
    const v = await validateNode(ctx.store, { ...node, content: blocks.slice(0, i) });
    if (!v || v.kind !== 'weekly_report') continue;
    const fresh = [...blocks.slice(0, i), ...checklistBlocks(v)];
    const sig = (bs) => JSON.stringify(bs.map((b) => [b.type, b.text, b.checked ?? null]));
    if (sig(fresh) === sig(blocks)) continue;
    node.content = fresh.map((b, j) => (blocks[j] && blocks[j].type === b.type && blocks[j].text === b.text ? { ...b, id: blocks[j].id } : b));
    await ctx.save('node', node);
  }
}

export function stripChecklist(blocks) {
  const i = blocks.findIndex((b) => /^h[1-3]$/.test(b.type) && /체크리스트/.test(b.text));
  return i < 0 ? blocks : blocks.slice(0, i);
}

export async function validateNode(store, node) {
  const team = node.teamId ? await store.get('team', node.teamId) : null;
  const season = team?.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
  const rules = season?.rules?.length ? season.rules : SSG_DEFAULT_RULES;
  const parent = node.parentId ? await store.get('node', node.parentId) : null;
  let kind = null;
  let round = null;
  if (parent?.sys === 'deliverables') {
    const k = node.props?.[fieldByName(parent, '종류')?.id];
    round = node.props?.[fieldByName(parent, '차수')?.id] ?? null;
    kind = { 주간보고: 'weekly_report', 아티클: 'article', 킥오프: 'kickoff', 발표자료: /최종/.test(node.title) ? 'final' : 'presentation' }[k] || null;
  }
  if (!kind && /주간\s*보고/.test(node.title)) kind = 'weekly_report';
  if (!kind && /아티클/.test(node.title) || node.meta?.kind === 'article') kind = kind || 'article';
  if (!kind) return null;
  const due = parent ? node.props?.[fieldByName(parent, 'D-day')?.id] : null;
  const vars = { team: team?.name || '', round: round ?? '', month: due ? Number(due.slice(5, 7)) : new Date().getMonth() + 1 };
  const result = evaluateRules(rules, { kind, title: node.title, blocks: node.content || [], team, vars, isDeliverable: true });
  result.kind = kind;
  result.filename = expectedFilename(rules, kind, vars);
  return result;
}

// ---- macro --------------------------------------------------------------
export const reportMacros = {
  async draft_weekly_report(op, ctx) {
    const teamId = op.team || ctx.teamId;
    if (!teamId) throw new OpError('draft_weekly_report needs a team context');
    const data = await computeWeekly(ctx.store, teamId, op.round, { now: ctx.now, extras: op });
    const { col, item } = await findReportItem(ctx.store, data.team, data.round);
    if (!col) throw new OpError('deliverables collection missing');
    const existing = item?.content || [];
    let blocks = renderWeeklyBlocks(data, op, existing);
    const pre = evaluateRules(data.season?.rules?.length ? data.season.rules : SSG_DEFAULT_RULES, { kind: 'weekly_report', blocks, team: data.team });
    blocks = [...blocks, ...checklistBlocks(pre)];
    const fStatus = fieldByName(col, '상태');
    const fWho = fieldByName(col, '담당');
    const fDue = fieldByName(col, 'D-day');
    const fRound = fieldByName(col, '차수');
    const fKind = fieldByName(col, '종류');
    const pm = (data.team.members || []).filter((m) => m.role === 'pm').map((m) => m.name);
    let node = item;
    if (!node) {
      node = { id: newId('n'), type: 'item', teamId, parentId: col.id, title: `${data.round}차 주간보고서`, props: {}, content: [], sortKey: await ctx.nextSortKey(col.id), createdBy: ctx.user?.id || 'system', deleted: false };
      ctx.created.push(node.id);
    }
    node.content = blocks;
    node.props = { ...node.props, [fKind.id]: '주간보고', [fRound.id]: data.round, [fDue.id]: data.period.due, [fWho.id]: pm, [fStatus.id]: node.props?.[fStatus.id] === '완료' ? '완료' : '진행 중' };
    node.meta = { ...(node.meta || {}), kind: 'weekly_report', generatedAt: new Date().toISOString(), period: data.period };
    await ctx.save('node', node);
    // Ask humans for what only they can write (deviation reasons etc.)
    for (const m of data.perMember) {
      if (m.pct !== null && m.pct < 100 && !op.deviation?.[m.name]) {
        await ctx.save('request', { id: newId('rq'), teamId, nodeId: node.id, assignee: m.name, text: `${data.round}차 주간보고서: 수행 현황 ${m.status}. 편차 사유를 적어 주세요.`, done: false });
      }
    }
    if (!pre.checks.find((c) => c.key === 'photo')?.passed) {
      await ctx.save('request', { id: newId('rq'), teamId, nodeId: node.id, assignee: pm[0] || null, text: `${data.round}차 주간보고서: 회의 사진을 첨부해 주세요.`, done: false });
    }
    return { id: node.id, round: data.round, activities: data.activities.length, carriedGoals: data.teamGoals.length };
  },
};

// ---- export -------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}

export function blocksToHtml(blocks = [], { resolveImage = (src) => src } = {}) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const b of blocks) {
    const want = b.type === 'bullet' || b.type === 'todo' ? 'ul' : b.type === 'number' ? 'ol' : null;
    if (want !== list) { close(); if (want) { out.push(`<${want}>`); list = want; } }
    switch (b.type) {
      case 'h1': out.push(`<h1>${inline(b.text)}</h1>`); break;
      case 'h2': out.push(`<h2>${inline(b.text)}</h2>`); break;
      case 'h3': out.push(`<h3>${inline(b.text)}</h3>`); break;
      case 'bullet': case 'number': out.push(`<li style="margin-left:${(b.indent || 0) * 1.2}em">${inline(b.text)}</li>`); break;
      case 'todo': out.push(`<li class="todo"><input type="checkbox" disabled ${b.checked ? 'checked' : ''}> ${inline(b.text)}</li>`); break;
      case 'quote': out.push(`<blockquote>${inline(b.text)}</blockquote>`); break;
      case 'callout': out.push(`<div class="callout">${inline(b.text)}</div>`); break;
      case 'code': out.push(`<pre><code>${esc(b.text)}</code></pre>`); break;
      case 'divider': out.push('<hr>'); break;
      case 'table': {
        const [h = [], ...rows] = b.rows || [];
        out.push(`<table><thead><tr>${h.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        break;
      }
      case 'image': out.push(`<figure><img src="${esc(resolveImage(b.src))}" alt="${esc(b.caption)}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`); break;
      case 'html': out.push(`<div class="embedded-report"><p><em>첨부 HTML 리포트: ${esc(b.title)}</em></p><iframe sandbox srcdoc="${esc(b.html)}"></iframe></div>`); break;
      default: if (b.text) out.push(`<p>${inline(b.text)}</p>`);
    }
  }
  close();
  return out.join('\n');
}

export async function exportNodeHtml(store, node) {
  const validation = await validateNode(store, node).catch(() => null);
  const team = node.teamId ? await store.get('team', node.teamId) : null;
  const images = {};
  for (const b of node.content || []) {
    const m = b.type === 'image' && String(b.src).match(/^\/api\/attachments\/([\w-]+)/);
    if (m) {
      const a = await store.get('attachment', m[1]);
      if (a) images[b.src] = `data:${a.mime};base64,${a.data}`;
    }
  }
  const body = blocksToHtml((node.content || []).filter((b) => !(b.type === 'h1' && b.text === node.title)), { resolveImage: (s) => images[s] || s });
  const filename = (validation?.filename || `${node.title}${team ? `_${team.name}` : ''}`).replace(/[\\/:*?"<>|]/g, '_');
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(filename)}</title>
<style>
  body{font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;color:#1f2328;line-height:1.65}
  h1{font-size:28px;border-bottom:2px solid #1f2328;padding-bottom:8px}
  h2{font-size:20px;margin-top:32px;border-left:4px solid #4f46e5;padding-left:10px}
  h3{font-size:16px;margin-top:20px;color:#374151}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
  th,td{border:1px solid #d0d7de;padding:8px 10px;vertical-align:top;text-align:left}
  th{background:#f3f4f6}
  td:first-child{font-weight:600;background:#fafafa;white-space:nowrap}
  img{max-width:100%;border-radius:8px}
  pre{background:#0d1117;color:#e6edf3;padding:14px;border-radius:8px;overflow:auto}
  blockquote{border-left:4px solid #d0d7de;margin:0;padding-left:14px;color:#57606a}
  .callout{background:#f5f3ff;border-radius:8px;padding:12px 14px}
  li.todo{list-style:none;margin-left:-1.2em}
  .meta{color:#6b7280;font-size:13px}
  iframe{width:100%;height:480px;border:1px solid #d0d7de;border-radius:8px}
  @media print{body{margin:0}h2{break-after:avoid}table,figure{break-inside:avoid}}
</style></head>
<body>
<h1>${esc(node.title)}</h1>
<p class="meta">${esc(team ? `${team.name} · ${team.projectTitle}` : '')} · 생성 ${esc(new Date().toISOString().slice(0, 10))} · Shapeshift</p>
${body}
</body></html>`;
  return { html, filename: `${filename}.html`, validation };
}
