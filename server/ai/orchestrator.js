// Prompt -> plan -> preview -> apply -> undo. One LLM call per prompt (+1 retry on validation error).
import { executePlan, revertEntry, OpError } from '../core/ops.js';
import { newId, blocksToText } from '../core/model.js';
import { SYSTEM_PROMPT, followUpPrompt } from './prompts.js';
import { completeWithFallback, parseJsonLoose } from './providers.js';
import { heuristicPlan } from './heuristic.js';
import { maskSecrets } from '../services/ingest.js';
import { latestSeason, roundForDate } from '../services/season.js';
import { seasonMacros } from '../services/season.js';
import { teamMacros } from '../services/teams.js';
import { reportMacros } from '../services/reports.js';
import { ingestMacros } from '../services/ingest.js';
import { notionMacros } from '../services/notion.js';

export const MACROS = { ...seasonMacros, ...teamMacros, ...reportMacros, ...ingestMacros, ...notionMacros };

export async function roleFor(store, user, teamId) {
  if (!user) return 'member';
  if (user.isToken) {
    if (teamId && user.tokenTeamId === teamId) return 'member';
    const e = new OpError('API 토큰의 팀과 요청한 팀이 달라요'); e.status = 403; throw e;
  }
  if (user.isAdmin) return 'admin';
  if (!teamId) return 'member';
  const m = await store.get('membership', `${teamId}:${user.id}`);
  if (!m) { const e = new OpError('이 팀의 멤버가 아니에요'); e.status = 403; throw e; }
  return m.role;
}

function kstToday(now = new Date()) { return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

export async function buildContext(store, { user, teamId, role, selection, now = new Date() }) {
  const team = teamId ? await store.get('team', teamId) : null;
  const season = team?.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
  const today = kstToday(now);
  const nodes = teamId ? (await store.list('node', { teamId })).filter((n) => !n.deleted) : [];
  const byParent = new Map();
  for (const n of nodes) { const k = n.parentId || 'root'; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(n); }
  const summary = [];
  for (const n of nodes) {
    if (n.type === 'item') continue;
    const entry = { id: n.id, type: n.type, title: n.title, parent: n.parentId || null };
    if (n.sys) entry.sys = n.sys;
    if (n.type === 'collection') {
      entry.fields = (n.fields || []).map((f) => ({ name: f.name, type: f.type, ...(f.options?.length ? { options: f.options.slice(0, 12) } : {}) }));
      entry.views = (n.views || []).map((v) => `${v.name}(${v.type})`);
      const items = (byParent.get(n.id) || []).sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
      entry.itemCount = items.length;
      entry.items = items.slice(-30).map((it) => {
        const vals = {};
        for (const f of n.fields || []) {
          const v = it.props?.[f.id];
          if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) vals[f.name] = v;
        }
        return { id: it.id, title: it.title, ...(Object.keys(vals).length ? { values: vals } : {}) };
      });
    }
    summary.push(entry);
  }
  let selected = null;
  if (selection?.nodeId) {
    const s = await store.get('node', selection.nodeId);
    if (s && (!teamId || s.teamId === teamId)) selected = { id: s.id, type: s.type, title: s.title, text: blocksToText(s.content || []).slice(0, 3000) };
  }
  const upcoming = (season?.milestones || []).filter((m) => (m.due || m.start) && (m.due || m.start) >= today).slice(0, 5).map((m) => ({ title: m.title, due: m.due, kind: m.kind }));
  const ctx = {
    TODAY: today,
    user: user ? { name: user.name, role } : null,
    team: team ? { id: team.id, name: team.name, project: team.projectTitle, topic: team.topic, members: team.members.map((m) => `${m.name}${m.role === 'pm' ? '(PM)' : ''}`) } : null,
    season: season ? { name: season.name, currentRound: roundForDate(season, today), upcoming } : null,
    nodes: summary,
    selected,
  };
  let json = JSON.stringify(ctx);
  if (json.length > 14000) {
    for (const e of ctx.nodes) if (e.items) e.items = e.items.slice(-10);
    json = JSON.stringify(ctx);
  }
  return { ctx, json };
}

function hydrateOps(ops, attachment) {
  return (ops || []).map((op) => {
    if (op?.op === 'ingest_content' && (op.useAttachment || (!op.html && !op.markdown && !op.text)) && attachment) {
      const isHtml = /<\/?[a-z][\s\S]*>/i.test(attachment.slice(0, 5000));
      const { useAttachment, ...rest } = op;
      return { ...rest, ...(isHtml ? { html: attachment } : { markdown: attachment }) };
    }
    if (op?.op === 'create_season' && !op.sourceText && !op.milestones?.length && attachment) return { ...op, sourceText: attachment };
    return op;
  });
}

export class Orchestrator {
  constructor({ store, providers = [], log = console.log, notify = async () => {} }) {
    this.store = store;
    this.providers = providers;
    this.log = log;
    this.notify = notify;
  }

  async llmPlan(system, userContent, retryNote, prevText) {
    const messages = [{ role: 'user', content: userContent }];
    if (retryNote) messages.push({ role: 'assistant', content: prevText || '{}' }, { role: 'user', content: retryNote });
    const res = await completeWithFallback(this.providers, { system, messages, maxTokens: 4096 }, { log: this.log });
    return { ...res, json: parseJsonLoose(res.text) };
  }

  async plan({ user, teamId, text, attachment = null, selection = null, origin = 'prompt', system = SYSTEM_PROMPT, now = new Date() }) {
    const role = await roleFor(this.store, user, teamId);
    const masked = attachment ? maskSecrets(attachment) : null;
    const att = masked?.text ?? null;
    const { ctx, json } = await buildContext(this.store, { user, teamId, role, selection, now });
    const promptDoc = {
      id: newId('pr'), userId: user?.id || null, teamId, text: maskSecrets(text || '').text, origin, status: 'planning',
      attachment: att ? att.slice(0, 400000) : null, selection,
    };
    const userContent = `CONTEXT:\n${json}\n\nUSER REQUEST:\n${promptDoc.text}${att ? `\n\nATTACHMENT (${att.length} chars, first 6000 shown; pass it with useAttachment:true):\n${att.slice(0, 6000)}` : ''}`;
    let planJson = null;
    let meta = { provider: 'heuristic', model: 'rules', tokensIn: 0, tokensOut: 0, latencyMs: 0 };
    let rawText = '';
    let warning = null;
    const t0 = Date.now();
    if (this.providers.length) {
      try {
        const r = await this.llmPlan(system, userContent);
        planJson = r.json; rawText = r.text;
        meta = { provider: r.provider, model: r.model, tokensIn: r.usage.in, tokensOut: r.usage.out, latencyMs: r.latencyMs };
      } catch (e) {
        warning = e.message;
        this.log(`[plan] fallback to heuristic: ${e.message}`);
      }
    }
    if (!planJson) planJson = heuristicPlan(promptDoc.text, { attachment: att, nodes: ctx.nodes, role });

    let ops = hydrateOps(Array.isArray(planJson.ops) ? planJson.ops : [], att);
    const ctxOpts = { user, teamId, role, macros: MACROS, now };
    let preview = null;
    let error = null;
    if (ops.length) {
      try {
        preview = await executePlan(this.store, ops, { mode: 'preview', ...ctxOpts });
      } catch (e) {
        if (!(e instanceof OpError)) throw e;
        error = e;
        if (meta.provider !== 'heuristic') {
          try {
            const note = `The server rejected op #${e.index ?? '?'} (${JSON.stringify(e.op || {}).slice(0, 300)}): ${e.message}. Return the corrected full JSON plan.`;
            const r = await this.llmPlan(system, userContent, note, rawText);
            meta.tokensIn += r.usage.in; meta.tokensOut += r.usage.out;
            planJson = r.json;
            ops = hydrateOps(planJson.ops || [], att);
            preview = await executePlan(this.store, ops, { mode: 'preview', ...ctxOpts });
            error = null;
          } catch (e2) {
            error = e2 instanceof OpError ? e2 : error;
          }
        }
      }
    }
    meta.latencyMs = Date.now() - t0;
    Object.assign(promptDoc, {
      intent: planJson.intent || (ops.length ? 'build' : 'ask'),
      status: error ? 'failed' : ops.length ? 'planned' : 'answered',
      plan: { summary: planJson.summary || '', reply: planJson.reply || '', ops: ops.map(stripBulky), diff: preview?.diff || [], destructive: preview?.destructive || false, notes: preview?.notes || [] },
      opsFull: ops,
      error: error ? { message: error.message, index: error.index } : null,
      warning,
      ...meta,
    });
    await this.store.put('prompt', promptDoc);

    const team = teamId ? await this.store.get('team', teamId) : null;
    if (promptDoc.status === 'planned' && team?.settings?.trust === 'auto' && !promptDoc.plan.destructive && origin === 'prompt') {
      return this.apply({ user, promptId: promptDoc.id, now });
    }
    return publicPrompt(promptDoc);
  }

  async apply({ user, promptId, now = new Date() }) {
    const p = await this.store.get('prompt', promptId);
    if (!p) throw Object.assign(new OpError('prompt not found'), { status: 404 });
    if (p.status !== 'planned') throw new OpError(`이미 처리된 계획이에요 (${p.status})`);
    if (p.userId && user && p.userId !== user.id && !user.isAdmin) {
      const role = await roleFor(this.store, user, p.teamId);
      if (role === 'member') throw Object.assign(new OpError('다른 사람의 계획은 PM만 적용할 수 있어요'), { status: 403 });
    }
    const role = await roleFor(this.store, user, p.teamId);
    const res = await executePlan(this.store, p.opsFull || p.plan.ops, { mode: 'apply', user, teamId: p.teamId, role, macros: MACROS, now });
    const entry = { id: newId('op'), promptId: p.id, userId: user?.id || null, teamId: p.teamId || res.results.find((r) => r.teamId)?.teamId || null, summary: p.plan.summary, diff: res.diff, before: res.before, after: res.after, revertedAt: null };
    await this.store.put('oplog', entry);
    p.status = 'applied';
    p.oplogId = entry.id;
    p.appliedAt = new Date().toISOString();
    p.teamId = p.teamId || entry.teamId;
    delete p.opsFull; // keep storage small; oplog has the images
    await this.store.put('prompt', p);
    for (const pi of res.pendingIngest || []) {
      this.followUp({ user, teamId: entry.teamId, ingest: pi }).catch((e) => this.log(`[followup] ${e.message}`));
    }
    this.notify({ type: 'applied', teamId: entry.teamId, user, summary: p.plan.summary }).catch(() => {});
    return { ...publicPrompt(p), results: res.results, created: res.created };
  }

  async followUp({ user, teamId, ingest }) {
    if (!this.providers.length) return null;
    const text = `다음은 방금 가져온 ${ingest.kind} 내용이에요. 프로젝트 구조에 반영할 후속 작업을 제안해 주세요.\n\n${ingest.text}`;
    return this.plan({ user, teamId, text, origin: 'followup', system: `${SYSTEM_PROMPT}\n\n${followUpPrompt(ingest.kind)}`, selection: { nodeId: ingest.nodeId } });
  }

  async applyDirect({ user, teamId, ops, summary = '직접 편집', now = new Date() }) {
    const role = await roleFor(this.store, user, teamId);
    const res = await executePlan(this.store, ops, { mode: 'apply', user, teamId, role, macros: MACROS, now });
    const entry = { id: newId('op'), promptId: null, userId: user?.id || null, teamId: teamId || res.results.find((r) => r.teamId)?.teamId || null, summary, manual: true, diff: res.diff, before: res.before, after: res.after, revertedAt: null };
    await this.store.put('oplog', entry);
    return { oplogId: entry.id, results: res.results, created: res.created, diff: res.diff, notes: res.notes, teamId: entry.teamId };
  }

  async undo({ user, oplogId, force = false }) {
    const entry = await this.store.get('oplog', oplogId);
    if (!entry) throw Object.assign(new OpError('oplog not found'), { status: 404 });
    if (entry.revertedAt) throw new OpError('이미 되돌린 작업이에요');
    const role = await roleFor(this.store, user, entry.teamId);
    if (role === 'member' && entry.userId !== user.id) throw Object.assign(new OpError('다른 사람의 작업은 PM만 되돌릴 수 있어요'), { status: 403 });
    const r = await revertEntry(this.store, entry, { force });
    entry.revertedAt = new Date().toISOString();
    entry.revertedBy = user?.id || null;
    await this.store.put('oplog', entry);
    if (entry.promptId) {
      const p = await this.store.get('prompt', entry.promptId);
      if (p) { p.status = 'reverted'; await this.store.put('prompt', p); }
    }
    return r;
  }
}

function stripBulky(op) {
  const o = { ...op };
  for (const k of ['html', 'markdown', 'sourceText', 'text']) if (typeof o[k] === 'string' && o[k].length > 400) o[k] = `${o[k].slice(0, 400)}… (${o[k].length}자)`;
  return o;
}

export function publicPrompt(p) {
  const { opsFull, attachment, ...rest } = p;
  return { ...rest, hasAttachment: Boolean(attachment) };
}
