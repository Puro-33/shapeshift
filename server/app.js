// Application wiring: routes -> auth -> orchestrator/services.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, readBody, send, APP_CSP, MIME, SECURITY_HEADERS } from './http.js';
import { Auth, sessionCookie, clearCookie } from './auth.js';
import { Orchestrator, roleFor, publicPrompt } from './ai/orchestrator.js';
import { makeProviders } from './ai/providers.js';
import { OpError } from './core/ops.js';
import { newId } from './core/model.js';
import { validateNode, exportNodeHtml } from './services/reports.js';
import { latestSeason, roundForDate } from './services/season.js';
import { findSys, fieldByName } from './services/teams.js';
import { runReminders, makeNotifier, sendDiscord } from './services/notify.js';
import { fetchNotionTree } from './services/notion.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const ROLE_RANK = { member: 1, pm: 2, admin: 3 };

export function createApp({ store, env = process.env, providers = makeProviders(env), log = console.log }) {
  const auth = new Auth(store, env);
  const orch = new Orchestrator({ store, providers, log, notify: makeNotifier(store, log) });
  const r = new Router();
  const secure = env.NODE_ENV === 'production' || Boolean(env.RENDER);

  const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, '로그인이 필요해요'); return ctx.user; };
  const requireTeam = async (ctx, teamId, min = 'member') => {
    const user = requireUser(ctx);
    if (!teamId) throw new HttpError(400, 'teamId가 필요해요');
    const team = await store.get('team', teamId);
    if (!team) throw new HttpError(404, '팀을 찾을 수 없어요');
    let role;
    try { role = await roleFor(store, user, teamId); } catch { throw new HttpError(403, '이 팀에 접근할 수 없어요'); }
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, `${min === 'pm' ? 'PM' : '관리자'} 권한이 필요해요`);
    return { team, role, user };
  };
  const requireAdmin = (ctx) => { const u = requireUser(ctx); if (!u.isAdmin) throw new HttpError(403, '운영진 권한이 필요해요'); return u; };
  const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, isAdmin: Boolean(u.isAdmin) };
  const nodeAccess = async (ctx, id) => {
    const node = await store.get('node', id);
    if (!node || node.deleted) throw new HttpError(404, '페이지를 찾을 수 없어요');
    if (node.teamId) await requireTeam(ctx, node.teamId); else requireUser(ctx);
    return node;
  };

  // ---- health / auth ---------------------------------------------------
  r.get('/api/health', async () => ({ ok: true, time: new Date().toISOString(), providers: providers.map((p) => p.name), store: (await store.usage().catch(() => ({}))).backend }));

  r.post('/api/auth/register', async (ctx) => {
    const user = await auth.register(ctx.body);
    const s = await auth.createSession(user);
    ctx.setCookie(sessionCookie(s.token, s.expiresAt, secure));
    return { user: publicUser(user) };
  });
  r.post('/api/auth/login', async (ctx) => {
    const user = await auth.login(ctx.body);
    const s = await auth.createSession(user);
    ctx.setCookie(sessionCookie(s.token, s.expiresAt, secure));
    return { user: publicUser(user) };
  });
  r.post('/api/auth/logout', async (ctx) => {
    await auth.destroySession(ctx.user?.sessionToken);
    ctx.setCookie(clearCookie(secure));
    return { ok: true };
  });

  r.get('/api/me', async (ctx) => {
    if (!ctx.user) return { user: null, providers: providers.map((p) => p.name) };
    const memberships = ctx.user.isAdmin ? (await store.list('team', {})).map((t) => ({ teamId: t.id, role: 'admin' })) : await store.list('membership', { userId: ctx.user.id });
    const teams = [];
    for (const m of memberships) {
      const t = await store.get('team', m.teamId);
      if (t) teams.push({ id: t.id, name: t.name, projectTitle: t.projectTitle, role: m.role });
    }
    return { user: publicUser(ctx.user), teams, providers: providers.map((p) => ({ name: p.name, model: p.model })) };
  });

  r.post('/api/invites/join', async (ctx) => {
    const user = requireUser(ctx);
    const invite = await auth.checkInvite(ctx.body.code);
    const team = await auth.joinTeam(user, invite);
    return { teamId: team.id, name: team.name };
  });
  r.post('/api/teams/:teamId/invites', async (ctx) => {
    const { user } = await requireTeam(ctx, ctx.params.teamId, 'pm');
    const code = await auth.createInvite(ctx.params.teamId, ctx.body.role === 'pm' ? 'pm' : 'member', user.id);
    return { code };
  });

  // ---- teams / nodes ---------------------------------------------------
  r.get('/api/teams/:teamId', async (ctx) => {
    const { team, role } = await requireTeam(ctx, ctx.params.teamId);
    const season = team.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
    const nodes = (await store.list('node', { teamId: team.id })).filter((n) => !n.deleted && n.type !== 'item')
      .map(({ content, ...n }) => n);
    const requests = await store.list('request', { teamId: team.id, done: false });
    const { discordWebhook, ...safeTeam } = team;
    return { team: { ...safeTeam, hasWebhook: Boolean(discordWebhook) }, role, season, nodes, requests };
  });

  r.patch('/api/teams/:teamId', async (ctx) => {
    const { team } = await requireTeam(ctx, ctx.params.teamId, 'pm');
    const b = ctx.body;
    if (b.name) team.name = String(b.name);
    if (b.topic !== undefined) team.topic = String(b.topic);
    if (b.projectTitle) team.projectTitle = String(b.projectTitle);
    if (b.discordWebhook !== undefined) {
      if (b.discordWebhook && !/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//.test(b.discordWebhook)) throw new HttpError(400, 'Discord 웹훅 URL 형식이 아니에요');
      team.discordWebhook = b.discordWebhook || null;
    }
    team.settings = { ...(team.settings || {}), ...(b.settings || {}) };
    if (b.members) team.members = b.members.map((m) => ({ name: String(m.name), role: m.role === 'pm' ? 'pm' : 'member', ...(m.userId ? { userId: m.userId } : {}) }));
    await store.put('team', team);
    return { ok: true };
  });

  r.post('/api/teams/:teamId/discord-test', async (ctx) => {
    const { team } = await requireTeam(ctx, ctx.params.teamId, 'pm');
    return sendDiscord(team.discordWebhook, `✅ [${team.name}] Shapeshift 알림 연결 테스트`);
  });

  r.get('/api/nodes/:id', async (ctx) => {
    const node = await nodeAccess(ctx, ctx.params.id);
    const children = (await store.list('node', { parentId: node.id })).filter((n) => !n.deleted).sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))
      .map(({ content, ...c }) => ({ ...c, blockCount: (content || []).length, preview: (content || []).find((b) => b.text)?.text?.slice(0, 120) || '' }));
    const crumbs = [];
    let p = node.parentId ? await store.get('node', node.parentId) : null;
    while (p && crumbs.length < 8) { crumbs.unshift({ id: p.id, title: p.title, type: p.type, icon: p.icon }); p = p.parentId ? await store.get('node', p.parentId) : null; }
    const parent = node.parentId ? await store.get('node', node.parentId) : null;
    const validation = await validateNode(store, node).catch(() => null);
    return { node, children, crumbs, parentFields: parent?.type === 'collection' ? parent.fields : null, validation };
  });

  r.get('/api/search', async (ctx) => {
    const { team } = await requireTeam(ctx, ctx.query.get('teamId'));
    const q = String(ctx.query.get('q') || '').toLowerCase().trim();
    if (!q) return { results: [] };
    const nodes = (await store.list('node', { teamId: team.id })).filter((n) => !n.deleted);
    const results = nodes.map((n) => {
      const text = (n.content || []).map((b) => b.text || (b.rows || []).flat().join(' ')).join(' ');
      const score = (n.title.toLowerCase().includes(q) ? 3 : 0) + (text.toLowerCase().includes(q) ? 1 : 0);
      const i = text.toLowerCase().indexOf(q);
      return { id: n.id, title: n.title, type: n.type, score, snippet: i >= 0 ? text.slice(Math.max(0, i - 40), i + 80) : '' };
    }).filter((x) => x.score).sort((a, b) => b.score - a.score).slice(0, 30);
    return { results };
  });

  // Manual edits still go through the op engine (undoable, permission-checked).
  r.post('/api/ops', async (ctx) => {
    requireUser(ctx);
    const { teamId, ops, summary } = ctx.body;
    if (teamId) await requireTeam(ctx, teamId);
    return orch.applyDirect({ user: ctx.user, teamId: teamId || null, ops, summary });
  });

  // ---- prompts ---------------------------------------------------------
  r.post('/api/prompts', async (ctx) => {
    const user = requireUser(ctx);
    const { teamId, text, attachment, selection } = ctx.body;
    if (teamId) await requireTeam(ctx, teamId);
    if (!String(text || '').trim() && !attachment) throw new HttpError(400, '프롬프트를 입력해 주세요');
    return orch.plan({ user, teamId: teamId || null, text: String(text || ''), attachment: attachment ? String(attachment) : null, selection });
  }, { bodyLimit: 6 * 1024 * 1024 });

  r.get('/api/prompts', async (ctx) => {
    const teamId = ctx.query.get('teamId');
    if (teamId) await requireTeam(ctx, teamId); else requireUser(ctx);
    const where = teamId ? { teamId } : { userId: ctx.user.id };
    const status = ctx.query.get('status');
    if (status) where.status = status;
    const list = await store.list('prompt', where, { orderBy: '-createdAt', limit: 60 });
    return { prompts: list.map(publicPrompt) };
  });

  r.post('/api/prompts/:id/apply', async (ctx) => {
    const p = await store.get('prompt', ctx.params.id);
    if (!p) throw new HttpError(404, '계획을 찾을 수 없어요');
    if (p.teamId) await requireTeam(ctx, p.teamId); else if (p.userId !== requireUser(ctx).id) throw new HttpError(403, '권한이 없어요');
    return orch.apply({ user: ctx.user, promptId: p.id });
  });

  r.post('/api/prompts/:id/dismiss', async (ctx) => {
    const p = await store.get('prompt', ctx.params.id);
    if (!p) throw new HttpError(404, '계획을 찾을 수 없어요');
    if (p.teamId) await requireTeam(ctx, p.teamId); else requireUser(ctx);
    if (p.status === 'planned' || p.status === 'failed') { p.status = 'dismissed'; delete p.opsFull; await store.put('prompt', p); }
    return { ok: true };
  });

  r.get('/api/oplog', async (ctx) => {
    const { team } = await requireTeam(ctx, ctx.query.get('teamId'));
    const list = await store.list('oplog', { teamId: team.id }, { orderBy: '-createdAt', limit: 60 });
    const users = {};
    for (const e of list) if (e.userId && !users[e.userId]) users[e.userId] = (await store.get('user', e.userId))?.name;
    return { entries: list.map(({ before, after, ...e }) => ({ ...e, userName: users[e.userId] || null })) };
  });

  r.post('/api/oplog/:id/undo', async (ctx) => {
    requireUser(ctx);
    return orch.undo({ user: ctx.user, oplogId: ctx.params.id, force: Boolean(ctx.body.force) });
  });

  // ---- seasons / admin -------------------------------------------------
  r.get('/api/seasons', async (ctx) => { requireUser(ctx); return { seasons: await store.list('season', {}, { orderBy: '-createdAt' }) }; });
  r.post('/api/seasons', async (ctx) => {
    const user = requireAdmin(ctx);
    return orch.applyDirect({ user, teamId: null, ops: [{ op: 'create_season', name: ctx.body.name, sourceText: ctx.body.sourceText, year: ctx.body.year }], summary: '시즌 생성' });
  }, { bodyLimit: 1024 * 1024 });
  r.patch('/api/seasons/:id', async (ctx) => {
    const user = requireAdmin(ctx);
    return orch.applyDirect({ user, teamId: null, ops: [{ op: 'update_season', season: ctx.params.id, ...ctx.body }], summary: '시즌 수정' });
  });

  r.get('/api/admin/overview', async (ctx) => {
    requireAdmin(ctx);
    const season = await latestSeason(store);
    const teams = await store.list('team', {});
    const rows = [];
    for (const t of teams) {
      const col = await findSys(store, t.id, 'deliverables');
      const items = col ? (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted) : [];
      const f = (n) => fieldByName(col, n)?.id;
      rows.push({
        team: { id: t.id, name: t.name, projectTitle: t.projectTitle, members: t.members.length },
        deliverables: items.map((it) => ({ id: it.id, title: it.title, kind: it.props?.[f('종류')], round: it.props?.[f('차수')], status: it.props?.[f('상태')], due: it.props?.[f('D-day')], submittedAt: it.props?.[f('제출일')] })),
      });
    }
    const users = (await store.list('user', {})).map(publicUser);
    return { season, rows, users, currentRound: season ? roundForDate(season, new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) : null };
  });

  r.patch('/api/admin/users/:id', async (ctx) => {
    requireAdmin(ctx);
    const u = await store.get('user', ctx.params.id);
    if (!u) throw new HttpError(404, '사용자 없음');
    if (ctx.body.isAdmin !== undefined) u.isAdmin = Boolean(ctx.body.isAdmin);
    await store.put('user', u);
    return { user: publicUser(u) };
  });

  r.get('/api/usage', async (ctx) => {
    requireAdmin(ctx);
    const month = new Date().toISOString().slice(0, 7);
    const prompts = (await store.list('prompt', {})).filter((p) => (p.createdAt || '').startsWith(month));
    const byProvider = {};
    for (const p of prompts) {
      const k = p.provider || 'unknown';
      byProvider[k] ||= { prompts: 0, tokensIn: 0, tokensOut: 0 };
      byProvider[k].prompts++; byProvider[k].tokensIn += p.tokensIn || 0; byProvider[k].tokensOut += p.tokensOut || 0;
    }
    return { storage: await store.usage(), month, byProvider };
  });

  // ---- requests (human input asks) ------------------------------------
  r.post('/api/requests/:id/done', async (ctx) => {
    const rq = await store.get('request', ctx.params.id);
    if (!rq) throw new HttpError(404, '요청 없음');
    await requireTeam(ctx, rq.teamId);
    rq.done = true; rq.doneAt = new Date().toISOString();
    await store.put('request', rq);
    return { ok: true };
  });

  // ---- attachments (client compresses to WebP first) ------------------
  r.post('/api/attachments', async (ctx) => {
    const { team } = await requireTeam(ctx, ctx.body.teamId);
    const m = String(ctx.body.dataUrl || '').match(/^data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new HttpError(400, '이미지 데이터 URL(webp/png/jpeg/gif)이 필요해요');
    const bytes = Math.floor(m[2].length * 0.75);
    if (bytes > 1.5 * 1024 * 1024) throw new HttpError(413, '이미지는 1.5MB 이하로 압축해 주세요');
    const id = newId('att');
    await store.put('attachment', { id, teamId: team.id, mime: m[1], data: m[2], bytes, uploadedBy: ctx.user.id });
    return { id, src: `/api/attachments/${id}`, bytes };
  }, { bodyLimit: 2.2 * 1024 * 1024 });

  r.get('/api/attachments/:id', async (ctx) => {
    const a = await store.get('attachment', ctx.params.id);
    if (!a) throw new HttpError(404, 'not found');
    if (a.teamId) await requireTeam(ctx, a.teamId);
    return { raw: Buffer.from(a.data, 'base64'), headers: { 'content-type': a.mime, 'cache-control': 'private, max-age=86400' } };
  });

  // ---- sandboxed HTML rendering (reports never share the app origin) --
  r.get('/api/render/:nodeId/:blockId', async (ctx) => {
    const node = await nodeAccess(ctx, ctx.params.nodeId);
    const block = (node.content || []).find((b) => b.id === ctx.params.blockId && b.type === 'html');
    if (!block) throw new HttpError(404, 'HTML 블록이 없어요');
    const interactive = ctx.query.get('mode') === 'interactive';
    let html = block.html;
    if (!interactive) {
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
    }
    const csp = interactive
      ? "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'"
      : "sandbox; default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; form-action 'none'";
    return { raw: html, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-frame-options': 'SAMEORIGIN', 'cache-control': 'no-store' } };
  });

  r.get('/api/export/:nodeId', async (ctx) => {
    const node = await nodeAccess(ctx, ctx.params.nodeId);
    const { html, filename, validation } = await exportNodeHtml(store, node);
    if (ctx.query.get('format') === 'json') return { filename, validation };
    return { raw: html, headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="export.html"; filename*=UTF-8''${encodeURIComponent(filename)}` } };
  });

  // ---- ingest API (agents, CI, Prowler) --------------------------------
  r.post('/api/ingest', async (ctx) => {
    const user = requireUser(ctx);
    const teamId = user.isToken ? user.tokenTeamId : ctx.body.teamId;
    await requireTeam(ctx, teamId);
    const { kind = 'report', content, title, source } = ctx.body;
    if (!content) throw new HttpError(400, 'content가 필요해요');
    if (!['report', 'devlog', 'article', 'prowler'].includes(kind)) throw new HttpError(400, 'kind는 report|devlog|article|prowler 중 하나예요');
    const text = `${title ? `${title}: ` : ''}${kind} 가져오기 (${source || 'api'})`;
    // Ingest itself is additive and safe -> apply directly; follow-up suggestions land in the inbox.
    const format = ctx.body.format || (/^\s*</.test(content) ? 'html' : /^\s*[[{]/.test(content) ? 'json' : 'markdown');
    const op = { op: 'ingest_content', kind, title, source: source || (user.isToken ? `api:${user.name}` : 'api'), ...(format === 'html' ? { html: content } : format === 'json' ? { text: content } : { markdown: content }) };
    if (kind === 'prowler') { delete op.html; delete op.markdown; op.text = content; }
    const res = await orch.applyDirect({ user, teamId, ops: [op], summary: text });
    const pending = [];
    if (kind !== 'prowler' && res.results[0]?.id) {
      const nodeNow = await store.get('node', res.results[0].id);
      if (nodeNow && kind !== 'article') {
        pending.push(orch.followUp({ user, teamId, ingest: { nodeId: nodeNow.id, kind, text: (nodeNow.content || []).map((b) => b.text || '').join('\n').slice(0, 12000) } }).catch((e) => ({ error: e.message })));
      }
    }
    const follow = ctx.query.get('wait') === '1' ? await Promise.all(pending) : [];
    return { ok: true, oplogId: res.oplogId, result: res.results[0], notes: res.notes, followUps: follow.map((f) => f?.id || f?.error).filter(Boolean) };
  }, { bodyLimit: 6 * 1024 * 1024 });

  r.post('/api/tokens', async (ctx) => {
    const { user } = await requireTeam(ctx, ctx.body.teamId, 'pm');
    return auth.createApiToken(ctx.body.teamId, ctx.body.name, user.id);
  });
  r.get('/api/tokens', async (ctx) => {
    const { team } = await requireTeam(ctx, ctx.query.get('teamId'), 'pm');
    return { tokens: (await store.list('apitoken', { teamId: team.id })).filter((t) => !t.revoked).map(({ id, name, prefix, lastUsedAt, createdAt }) => ({ id, name, prefix, lastUsedAt, createdAt })) };
  });
  r.delete('/api/tokens/:id', async (ctx) => {
    const t = await store.get('apitoken', ctx.params.id);
    if (!t) throw new HttpError(404, '토큰 없음');
    await requireTeam(ctx, t.teamId, 'pm');
    t.revoked = true;
    await store.put('apitoken', t);
    return { ok: true };
  });

  // ---- Notion import ---------------------------------------------------
  r.post('/api/import/notion', async (ctx) => {
    const { user } = await requireTeam(ctx, ctx.body.teamId, 'pm');
    const { token, root, maxDepth = 4, images = true } = ctx.body;
    if (!token || !root) throw new HttpError(400, 'Notion integration 토큰과 페이지 URL이 필요해요');
    const { tree, images: imgs, calls } = await fetchNotionTree(token, root, { maxDepth: Math.min(6, Number(maxDepth) || 4), images });
    const res = await orch.applyDirect({ user, teamId: ctx.body.teamId, ops: [{ op: 'import_tree', tree, images: imgs }], summary: `노션 가져오기: ${tree.title}` });
    return { ...res, apiCalls: calls };
  });

  // ---- cron (GitHub Actions schedule) ----------------------------------
  r.post('/api/cron/tick', async (ctx) => {
    if (!env.CRON_SECRET || ctx.req.headers['x-cron-secret'] !== env.CRON_SECRET) throw new HttpError(401, 'bad cron secret');
    return runReminders(store, { baseUrl: env.PUBLIC_URL || '' });
  });

  // ---- request handler -------------------------------------------------
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const cookies = [];
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = r.match(req.method, url.pathname);
        if (!route) throw new HttpError(404, 'API 경로를 찾을 수 없어요');
        if (req.method !== 'GET' && !req.headers.authorization?.startsWith('Bearer ') && url.pathname !== '/api/cron/tick') {
          // CSRF: browsers can't send this header cross-site without CORS preflight (which we never allow)
          if (req.headers['x-shapeshift'] !== '1') throw new HttpError(403, 'CSRF 헤더가 없어요');
        }
        const body = req.method === 'GET' ? {} : await readBody(req, route.opts.bodyLimit);
        const user = await auth.userFromRequest(req);
        const ctx = { req, res, params: route.params, query: url.searchParams, body, user, setCookie: (c) => cookies.push(c) };
        const out = await route.handler(ctx);
        const extra = cookies.length ? { 'set-cookie': cookies } : {};
        if (out && out.raw !== undefined) return send(res, 200, out.raw, { ...out.headers, ...extra });
        return send(res, 200, out ?? { ok: true }, extra);
      }
      return serveStatic(url.pathname, res);
    } catch (e) {
      const status = e.status || (e instanceof OpError ? 422 : 500);
      if (status >= 500) log(`[error] ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      return send(res, status, { error: status >= 500 && !(e instanceof OpError) ? '서버 오류가 발생했어요' : e.message, ...(e.conflicts ? { conflicts: e.conflicts } : {}) }, cookies.length ? { 'set-cookie': cookies } : {});
    }
  };
}

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
    return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    ...(ext === '.html' ? { 'content-security-policy': APP_CSP } : {}),
  });
  fs.createReadStream(file).pipe(res);
}
