// Season = a club term with milestones (deadlines) and rules, parsed from the organizers' guide.
import { newId } from '../core/model.js';
import { OpError } from '../core/ops.js';
import { SSG_DEFAULT_RULES } from '../core/rules.js';

const pad = (n) => String(n).padStart(2, '0');

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mkDate(year, startMonth, m, d) {
  const y = m < startMonth - 2 ? year + 1 : year; // Jan after an Aug start => next year
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseMD(s) {
  let m = String(s).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = String(s).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}

/** Deterministic parser for SSG-style guides. The AI path may pass explicit milestones instead. */
export function parseSeasonText(text, { year = new Date().getFullYear(), name } = {}) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n').map((l) => l.replace(/\*\*|__/g, '').replace(/^[-*•]\s+/, '').trim()).filter(Boolean);
  let startMonth = 9;
  let start = null;
  let end = null;
  const period = src.match(/기간\s*[:：]?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[^~\n]*~\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (period) {
    startMonth = Number(period[1]);
    start = mkDate(year, startMonth, startMonth, Number(period[2]));
    end = mkDate(year, startMonth, Number(period[3]), Number(period[4]));
  }
  const date = (md) => (md ? mkDate(year, startMonth, md[0], md[1]) : null);
  const milestones = [];
  let kickoffCount = 0;

  for (const raw of lines) {
    const cells = raw.replace(/^\|/, '').replace(/\|$/, '').split(/\s*\|\s*|\t+| {2,}/).map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 2) continue;
    const head = cells[0];
    const when = cells[1];
    const note = cells.slice(2).join(' ');
    if (/^차수$/.test(head)) continue;
    let m;
    if (/^킥오프$/.test(head)) {
      const md = parseMD(when);
      if (!md) continue;
      kickoffCount++;
      milestones.push({ kind: 'kickoff', round: 0, title: kickoffCount === 1 ? '킥오프 보고서' : '킥오프 보고서 (수정본)', due: date(md), note });
    } else if ((m = head.match(/^(\d+)\s*차$/))) {
      const md = parseMD(when);
      if (!md) continue;
      const round = Number(m[1]);
      const isFinal = /최종/.test(note);
      milestones.push({
        kind: isFinal ? 'final' : 'weekly', round,
        title: isFinal ? `${round}차 최종 발표 자료` : `${round}차 주간보고서`,
        due: date(md), note,
        deliverables: isFinal ? ['발표자료'] : ['주간보고', ...(/아티클|articles/i.test(note) ? ['아티클'] : [])],
      });
    } else if (/고사/.test(head) || /고사/.test(when)) {
      milestones.push({ kind: 'break', title: head.replace(/\s*기간$/, '') + ' 기간', note });
    } else if (/^최종\s*발표$/.test(head)) {
      const md = parseMD(when);
      milestones.push({ kind: 'presentation', title: '최종 발표', start: date(md), due: date(md), note });
    }
  }

  // STEP bullets like "9/7 ~ 9/9 중 하루 : 킥오프 중간발표", "9/14 : 본 프로젝트 시작"
  for (const l of lines) {
    const m = l.match(/^(\d{1,2}\/\d{1,2})(?:\s*~\s*(\d{1,2}\/\d{1,2}))?[^:：]*[:：]\s*(.+)$/);
    if (!m) continue;
    const title = m[3].trim();
    const s = date(parseMD(m[1]));
    const e = m[2] ? date(parseMD(m[2])) : s;
    if (/킥오프 보고서/.test(title) || milestones.some((x) => x.title === title)) continue;
    if (/최종발표/.test(title.replace(/\s/g, '')) && milestones.some((x) => x.kind === 'presentation' && x.title === '최종 발표')) {
      const fp = milestones.find((x) => x.kind === 'presentation' && x.title === '최종 발표');
      fp.start = s; fp.end = e; fp.due = s;
      continue;
    }
    milestones.push({ kind: /발표/.test(title) ? 'presentation' : 'event', title, start: s, end: e, due: s });
  }
  if (/중간\s*발표\s*[:：]?\s*매달/.test(src.replace(/_/g, ''))) {
    milestones.push({ kind: 'presentation', title: '월간 중간 발표', note: '매달 오프라인 (날짜 미정)', recurring: 'monthly' });
  }

  milestones.forEach((x) => { x.id = newId('ms'); x.dueTime = x.due ? '23:59' : undefined; });
  milestones.sort((a, b) => String(a.due || a.start || '9999').localeCompare(String(b.due || b.start || '9999')));

  return { name: name || guessName(src, year), start, end, milestones, rules: parseRules(src) };
}

function guessName(src, year) {
  if (/2학기/.test(src)) return `${year} 2학기 SSG 팀 프로젝트`;
  if (/1학기/.test(src)) return `${year} 1학기 SSG 팀 프로젝트`;
  return `${year} 팀 프로젝트 시즌`;
}

export function parseRules(src) {
  const rules = [];
  const text = String(src);
  const base = Object.fromEntries(SSG_DEFAULT_RULES.map((r) => [r.id, r]));
  // Weekly minimum requirements list
  const reqIdx = text.search(/최소\s*요구\s*사항/);
  if (reqIdx >= 0) {
    const after = text.slice(reqIdx).split('\n').slice(1);
    const items = [];
    for (const l of after) {
      const t = l.replace(/^[\s\d.)\-*•]+/, '').replace(/_/g, '').trim();
      if (!t) { if (items.length) break; else continue; }
      if (/^(-{3,}|모두 잘|감사)/.test(t)) break;
      items.push(t);
      if (items.length >= 10) break;
    }
    if (items.length) {
      const defaults = base.r_weekly_sections.sections;
      const sections = items.map((label) => {
        const d = defaults.find((s) => s.keywords.some((k) => label.toLowerCase().includes(k.toLowerCase())));
        const range = label.match(/(\d+)\s*~\s*(\d+)\s*개/);
        const key = d?.key || `s_${Math.abs(hash(label))}`;
        const kw = d ? d.keywords : [label.split(/[(&]/)[0].trim()];
        return { ...(d || {}), key, label, keywords: kw, ...(range ? { minItems: Number(range[1]), maxItems: Number(range[2]) } : {}) };
      });
      rules.push({ ...base.r_weekly_sections, sections });
    }
  }
  if (/제출\s*날짜/.test(text) || rules.length) rules.push(base.r_weekly_submit_date);
  if (/\[\s*팀명\s*\]/.test(text)) rules.push(base.r_article_title);
  if (/팀원\s*이름\s*\/\s*주제/.test(text)) rules.push(base.r_article_mentions);
  const fileRe = /\(([^)]*)\)\s*SSG_팀프로젝트_팀명/g;
  let fm;
  const seen = new Set();
  while ((fm = fileRe.exec(text))) {
    const tag = fm[1];
    let kind = 'other';
    let template = `(${tag})SSG_팀프로젝트_{team}`;
    if (/킥오프/.test(tag)) kind = 'kickoff';
    else if (/최종/.test(tag)) kind = 'final';
    else if (/월\s*발표/.test(tag)) { kind = 'presentation'; template = '({month}월발표자료)SSG_팀프로젝트_{team}'; }
    if (seen.has(kind)) continue;
    seen.add(kind);
    rules.push({ id: `r_file_${kind}`, kind: 'filename', appliesTo: kind, label: `${tag} 파일명`, template });
  }
  if (rules.some((r) => r.kind === 'filename')) rules.push(base.r_file_weekly);
  if (/제\s*출\s*자\s*[:：]?\s*팀의\s*PM/.test(text.replace(/_/g, ''))) rules.push(base.r_submitter);
  if (/참여율/.test(text)) rules.push(base.r_participation);
  return rules;
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

export function weeklyMilestones(season) {
  return (season?.milestones || []).filter((m) => m.kind === 'weekly' && m.due).sort((a, b) => a.round - b.round);
}

export function periodForRound(season, round) {
  const ms = weeklyMilestones(season).find((m) => m.round === round);
  if (!ms) return null;
  const end = addDays(ms.due, -2);
  return { start: addDays(end, -6), end, due: ms.due, milestone: ms };
}

export function roundForDate(season, isoDate) {
  const w = weeklyMilestones(season);
  const hit = w.find((m) => m.due >= isoDate);
  return hit ? hit.round : (w.at(-1)?.round ?? null);
}

export function stageForDate(isoDate, season) {
  if (!season) return null;
  const kickoffEnd = (season.milestones || []).filter((m) => m.kind === 'kickoff').map((m) => m.due).sort().at(-1);
  if (kickoffEnd && isoDate <= kickoffEnd) return '킥오프';
  const finals = (season.milestones || []).find((m) => m.kind === 'final');
  if (finals && isoDate >= addDays(finals.due, -14)) return '최종';
  const midBreak = (season.milestones || []).find((m) => m.kind === 'break');
  const w = weeklyMilestones(season);
  const firstAfterBreak = w.find((m, i) => i > 0 && m.round >= 4);
  if (midBreak && firstAfterBreak && isoDate >= addDays(firstAfterBreak.due, -7)) return '2단계';
  return '1단계';
}

export async function latestSeason(store) {
  const all = await store.list('season', {}, { orderBy: '-createdAt' });
  return all.find((s) => !s.archived) || null;
}

// ---- macro ops ----------------------------------------------------------
export const seasonMacros = {
  async create_season(op, ctx) {
    let parsed = { milestones: [], rules: [] };
    if (op.sourceText) parsed = parseSeasonText(op.sourceText, { year: op.year || ctx.now.getFullYear(), name: op.name });
    const season = {
      id: newId('season'),
      name: op.name || parsed.name,
      start: op.start || parsed.start,
      end: op.end || parsed.end,
      timezone: op.timezone || 'Asia/Seoul',
      milestones: (op.milestones?.length ? op.milestones : parsed.milestones).map((m) => ({ id: m.id || newId('ms'), ...m })),
      rules: op.rules?.length ? op.rules : (parsed.rules.length ? parsed.rules : SSG_DEFAULT_RULES),
      sourceText: op.sourceText || null,
      archived: false,
    };
    await ctx.save('season', season);
    ctx.created.push(season.id);
    if (op.ref) ctx.temp.set(op.ref.startsWith('$') ? op.ref : `$${op.ref}`, season.id);
    return { id: season.id, milestones: season.milestones.length, rules: season.rules.length };
  },

  async update_season(op, ctx) {
    const season = await getSeason(ctx, op.season);
    for (const k of ['name', 'start', 'end', 'archived', 'timezone']) if (op[k] !== undefined) season[k] = op[k];
    if (op.milestones) season.milestones = op.milestones.map((m) => ({ id: m.id || newId('ms'), ...m }));
    await ctx.save('season', season);
    return { id: season.id };
  },

  async add_milestone(op, ctx) {
    const season = await getSeason(ctx, op.season);
    const m = { id: newId('ms'), kind: op.kind || 'event', title: op.title || '일정', due: op.due || null, start: op.start || op.due || null, end: op.end || null, round: op.round, note: op.note || '' };
    season.milestones = [...season.milestones, m].sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
    await ctx.save('season', season);
    return { id: season.id, milestoneId: m.id };
  },

  async set_rules(op, ctx) {
    const season = await getSeason(ctx, op.season);
    if (op.sourceText) season.rules = parseRules(op.sourceText);
    if (op.rules) season.rules = op.rules;
    await ctx.save('season', season);
    return { id: season.id, rules: season.rules.length };
  },
};

async function getSeason(ctx, ref) {
  let season = null;
  if (ref && String(ref).startsWith('$')) season = await ctx.store.get('season', ctx.temp.get(ref));
  else if (ref) season = await ctx.store.get('season', ref);
  else season = await latestSeason(ctx.store);
  if (!season) throw new OpError(`season not found: ${ref || '(latest)'}`);
  return season;
}
