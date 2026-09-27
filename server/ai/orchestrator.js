// Plan -> preview -> apply -> undo. No LLM on the server (BYO-AI):
// plans come from (1) the user's own AI as ops JSON, (2) an AI-edited Markdown
// document, or (3) the built-in rule-based quick commands.
import { executePlan, revertEntry, OpError } from '../core/ops.js';
import { newId } from '../core/model.js';
import { markdownToOps } from '../core/markdown.js';
import { heuristicPlan } from './heuristic.js';
import { maskSecrets, ingestMacros } from '../services/ingest.js';
import { seasonMacros } from '../services/season.js';
import { teamMacros } from '../services/teams.js';
import { reportMacros } from '../services/reports.js';
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

export function kstToday(now = new Date()) { return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

/** Parse a plan from an AI reply: raw JSON, {ops}, or JSON inside a ```json fence. */
export function parsePlanText(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  let j;
  try { j = JSON.parse(body); } catch {
    const a = body.indexOf('{'); const b = body.lastIndexOf('}');
    const a2 = body.indexOf('['); const b2 = body.lastIndexOf(']');
    try { j = a >= 0 && b > a ? JSON.parse(body.slice(a, b + 1)) : JSON.parse(body.slice(a2, b2 + 1)); } catch { throw new OpError('AI 응답에서 JSON 계획을 찾지 못했어요'); }
  }
  if (Array.isArray(j)) return { ops: j, summary: '' };
  if (j && Array.isArray(j.ops)) return { ops: j.ops, summary: j.summary || '', reply: j.reply || '' };
  if (j && j.op) return { ops: [j], summary: '' };
  throw new OpError('JSON에 ops 배열이 없어요');
}

export function looksLikeMarkdownDoc(text) {
  return /^\s*(```(?:markdown|md)?\s*\n)?---\n[\s\S]*?\bid:\s*\S+[\s\S]*?\n---/.test(String(text || '').replace(/\r\n/g, '\n'));
}

function unfence(text) {
  const m = String(text).match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : text;
}

async function nodeSummaries(store, teamId) {
  const nodes = teamId ? (await store.list('node', { teamId })).filter((n) => !n.deleted && n.type !== 'item') : [];
  return nodes.map((n) => ({ id: n.id, type: n.type, title: n.title, sys: n.sys, fields: n.fields }));
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
  constructor({ store, log = console.log, notify = async () => {} }) {
    this.store = store;
    this.log = log;
    this.notify = notify;
  }

  /**
   * Create a previewed plan. Sources (first match wins):
   *  - ops: array | JSON text from the user's AI
   *  - markdown + nodeId: an AI-edited Markdown document
   *  - text: rule-based quick command (pasted plan JSON / Markdown docs are auto-detected)
   */
  async plan({ user, teamId, text = '', ops = null, markdown = null, nodeId = null, attachment = null, selection = null, origin = 'prompt', summary = '', now = new Date() }) {
    const att = attachment ? maskSecrets(attachment).text : null;
    let source = 'rules';
    let planJson;
    let warnings = [];
    const t = String(text || '').trim();
    const isPlanJson = (s) => s && /^\s*(```(?:json)?\s*)?[{[]/.test(s) && /"op"\s*:/.test(s);

    if (!ops && !markdown && isPlanJson(t)) ops = t;
    else if (!ops && !markdown && looksLikeMarkdownDoc(t)) markdown = t;
    else if (!ops && !markdown && isPlanJson(att)) ops = att;
    else if (!ops && !markdown && att && looksLikeMarkdownDoc(att)) markdown = att;
    if (markdown) { markdown = unfence(markdown); nodeId = nodeId || markdown.match(/^id:\s*(\S+)/m)?.[1]; }

    if (markdown) {
      if (!nodeId) throw new OpError('Markdown 문서에 id가 없어요');
      const node = await this.store.get('node', nodeId);
      if (!node || node.deleted) throw new OpError('Markdown 문서의 대상 노드를 찾을 수 없어요');
      if (teamId && node.teamId && node.teamId !== teamId) throw Object.assign(new OpError('다른 팀의 문서예요'), { status: 403 });
      teamId = node.teamId || teamId;
    }
    const role = await roleFor(this.store, user, teamId);

    if (ops) {
      source = 'user-ai';
      planJson = typeof ops === 'string' ? parsePlanText(ops) : { ops, summary };
      planJson.intent = 'build';
    } else if (markdown) {
      source = 'markdown';
      const node = await this.store.get('node', nodeId);
      const r = await markdownToOps(this.store, nodeId, markdown);
      warnings = r.warnings;
      planJson = { intent: 'build', summary: summary || `"${node.title}" 문서 편집 반영`, ops: r.ops };
      if (!r.ops.length) planJson.reply = '바뀐 내용이 없어요.';
    } else {
      planJson = heuristicPlan(t, { attachment: att, nodes: await nodeSummaries(this.store, teamId), role });
    }

    const promptDoc = {
      id: newId('pr'), userId: user?.id || null, teamId, text: maskSecrets(source === 'rules' ? t : (summary || planJson.summary || t.slice(0, 200))).text.slice(0, 4000), origin, status: 'planning',
      attachment: att ? att.slice(0, 400000) : null, selection, nodeId,
    };
    const opsList = hydrateOps(Array.isArray(planJson.ops) ? planJson.ops : [], att);
    let preview = null;
    let error = null;
    const t0 = Date.now();
    if (opsList.length) {
      try { preview = await executePlan(this.store, opsList, { mode: 'preview', user, teamId, role, macros: MACROS, now }); } catch (e) { if (!(e instanceof OpError)) throw e; error = e; }
    }
    Object.assign(promptDoc, {
      intent: planJson.intent || (opsList.length ? 'build' : 'ask'),
      status: error ? 'failed' : opsList.length ? 'planned' : 'answered',
      plan: { summary: planJson.summary || summary || '', reply: planJson.reply || '', ops: opsList.map(stripBulky), diff: preview?.diff || [], destructive: preview?.destructive || false, notes: [...warnings, ...(preview?.notes || [])] },
      opsFull: opsList,
      error: error ? { message: error.message, index: error.index } : null,
      provider: source, model: null, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0,
    });
    await this.store.put('prompt', promptDoc);

    const team = teamId ? await this.store.get('team', teamId) : null;
    if (promptDoc.status === 'planned' && team?.settings?.trust === 'auto' && !promptDoc.plan.destructive && origin === 'prompt') {
      return this.apply({ user, promptId: promptDoc.id, now });
    }
    return publicPrompt(promptDoc);
  }

  async apply({ user, promptId, now = new Date(), confirmDestructive = true }) {
    const p = await this.store.get('prompt', promptId);
    if (!p) throw Object.assign(new OpError('prompt not found'), { status: 404 });
    if (p.status !== 'planned') throw new OpError(`이미 처리된 계획이에요 (${p.status})`);
    if (p.plan?.destructive && !confirmDestructive) throw new OpError('삭제나 구조 변경이 포함된 계획이라 확인(confirm_destructive=true)이 필요해요');
    const role = await roleFor(this.store, user, p.teamId);
    if (p.userId && user && p.userId !== user.id && role === 'member') throw Object.assign(new OpError('다른 사람의 계획은 PM만 적용할 수 있어요'), { status: 403 });
    const res = await executePlan(this.store, p.opsFull || p.plan.ops, { mode: 'apply', user, teamId: p.teamId, role, macros: MACROS, now });
    const entry = { id: newId('op'), promptId: p.id, userId: user?.id || null, teamId: p.teamId || res.results.find((r) => r.teamId)?.teamId || null, summary: p.plan.summary || p.text, source: p.provider, diff: res.diff, before: res.before, after: res.after, revertedAt: null };
    await this.store.put('oplog', entry);
    p.status = 'applied';
    p.oplogId = entry.id;
    p.appliedAt = new Date().toISOString();
    p.teamId = p.teamId || entry.teamId;
    delete p.opsFull;
    await this.store.put('prompt', p);
    this.notify({ type: 'applied', teamId: entry.teamId, user, summary: entry.summary }).catch(() => {});
    return { ...publicPrompt(p), results: res.results, created: res.created };
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
  if (Array.isArray(o.content) && o.content.length > 8) o.content = `[${o.content.length}개 블록]`;
  if (o.tree) o.tree = `[노션 트리: ${o.tree.title}]`;
  if (o.images) o.images = `[이미지 ${o.images.length}개]`;
  return o;
}

export function publicPrompt(p) {
  const { opsFull, attachment, ...rest } = p;
  return { ...rest, hasAttachment: Boolean(attachment) };
}
