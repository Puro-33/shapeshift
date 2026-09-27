// AI-readable surface: server-rendered semantic HTML (no JS), Markdown/JSON views,
// plain HTML forms an AI browser can fill, and an MCP endpoint for personal AI clients.
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { nodeToMarkdown, workspaceOutline } from './core/markdown.js';
import { markdownToBlocks } from './core/model.js';
import { blocksToHtml } from './services/reports.js';
import { validateNode } from './services/reports.js';
import { latestSeason } from './services/season.js';
import { agentGuide, llmsTxt, contextPackage, OP_REFERENCE } from './ai/guide.js';
import { kstToday, publicPrompt } from './ai/orchestrator.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const CSS = `body{font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 20px;color:#222;line-height:1.6}
header{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:13px;color:#666;border-bottom:1px solid #eee;padding-bottom:10px}
header a{color:#4b4bc8}nav[aria-label=breadcrumbs]{flex:1}h1{font-size:28px;margin:18px 0 6px}
dl#properties{display:grid;grid-template-columns:160px 1fr;gap:4px 12px;background:#fafaf8;padding:10px 14px;border-radius:8px}
dt{color:#777}dd{margin:0}table{border-collapse:collapse;width:100%;font-size:14px;margin:10px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f4f2}
section{margin-top:28px}section h2{font-size:16px;border-bottom:1px solid #eee;padding-bottom:4px}
textarea{width:100%;font-family:ui-monospace,Consolas,monospace;font-size:13px;border:1px solid #ccc;border-radius:6px;padding:8px}
button,.btn{background:#5b5bd6;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:14px;text-decoration:none;display:inline-block}
.btn.secondary{background:#eee;color:#333}.muted{color:#888;font-size:13px}li[data-passed=false]{color:#b3261e}
ul.diff li{padding:4px 8px;border-radius:6px;margin:3px 0;list-style:none}li[data-action=create]{background:#e4f6ee}li[data-action=update]{background:#fdf3e1}li[data-action=delete]{background:#fdecea}
iframe{width:100%;height:420px;border:1px solid #ddd;border-radius:8px}pre{background:#f4f4f2;padding:10px;border-radius:6px;overflow:auto}
.warn{background:#fdecea;color:#8a1f17;padding:8px 10px;border-radius:6px}.ok{background:#e4f6ee;padding:8px 10px;border-radius:6px}`;

function page({ title, body, alternates = [], head = '' }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Shapeshift</title><meta name="generator" content="shapeshift">
${alternates.map((a) => `<link rel="alternate" type="${a.type}" href="${esc(a.href)}">`).join('\n')}
<link rel="help" href="/agent"><style>${CSS}</style>${head}</head><body>${body}</body></html>`;
}

function propValueHtml(f, v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">(비어 있음)</span>';
  if (Array.isArray(v)) return v.map(esc).join(', ');
  if (typeof v === 'object') return v.start !== undefined ? `${esc(v.start)} ~ ${esc(v.end)}` : esc(JSON.stringify(v));
  if (f?.type === 'url') return `<a href="${esc(v)}">${esc(v)}</a>`;
  return esc(v);
}

function blocksHtml(node) {
  return (node.content || []).map((b) => {
    const inner = b.type === 'html'
      ? `<figure><figcaption>첨부 HTML 리포트: ${esc(b.title)}</figcaption><iframe sandbox src="/api/render/${esc(node.id)}/${esc(b.id)}?mode=safe" title="${esc(b.title)}"></iframe></figure>`
      : blocksToHtml([b]);
    return `<div data-block-id="${esc(b.id)}" data-block-type="${b.type}"${b.type === 'todo' ? ` data-checked="${Boolean(b.checked)}"` : ''}>${inner}</div>`;
  }).join('\n');
}

export function csrfFor(secret, user) {
  if (!user?.sessionToken) return '';
  return crypto.createHmac('sha256', secret).update(`csrf:${user.sessionToken}`).digest('base64url').slice(0, 32);
}

export function registerAgentRoutes(r, { store, orch, auth, env, requireUser, requireTeam, nodeAccess }) {
  const secret = env.SESSION_SECRET || 'dev-secret';
  const base = (ctx) => env.PUBLIC_URL || `${ctx.req.headers['x-forwarded-proto'] || 'http'}://${ctx.req.headers.host}`;
  const needLogin = (ctx) => {
    if (!ctx.user) {
      const next = encodeURIComponent(ctx.req.url);
      return { raw: page({ title: '로그인 필요', body: `<main><h1>로그인이 필요해요</h1><p>브라우저로 <a href="/#/login?next=${next}">로그인</a>하거나, <code>Authorization: Bearer ss_...</code> 개인 토큰으로 요청하세요. <a href="/agent">AI 안내</a></p></main>` }), status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } };
    }
    return null;
  };
  const checkCsrf = (ctx) => {
    if (ctx.user?.viaToken || ctx.user?.isToken) return;
    if (!ctx.body.csrf || ctx.body.csrf !== csrfFor(secret, ctx.user)) throw new HttpError(403, 'CSRF 토큰이 맞지 않아요. 페이지를 새로고침한 뒤 다시 제출해 주세요.');
  };

  // ---- public docs --------------------------------------------------------
  r.get('/llms.txt', async (ctx) => ({ raw: llmsTxt(base(ctx)), headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  r.get('/agent.md', async (ctx) => ({ raw: agentGuide(base(ctx)), headers: { 'content-type': 'text/markdown; charset=utf-8' } }));
  r.get('/agent', async (ctx) => ({
    raw: page({ title: 'AI 에이전트 안내', alternates: [{ type: 'text/markdown', href: '/agent.md' }], body: `<header><a href="/">Shapeshift</a><a href="/agent.md">Markdown</a><a href="/llms.txt">llms.txt</a></header><main id="agent-guide">${blocksToHtml(markdownToBlocks(agentGuide(base(ctx))))}</main>` }),
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }));

  // ---- workspace outline ---------------------------------------------------
  r.get('/t/:teamId', async (ctx) => {
    const nl = needLogin(ctx); if (nl) return nl;
    const raw = ctx.params.teamId;
    const fmt = raw.endsWith('.md') ? 'md' : raw.endsWith('.json') ? 'json' : 'html';
    const teamId = raw.replace(/\.(md|json)$/, '');
    const { team } = await requireTeam(ctx, teamId);
    const season = team.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
    const nodes = (await store.list('node', { teamId })).filter((n) => !n.deleted);
    const requests = await store.list('request', { teamId, done: false });
    const { discordWebhook, ...safeTeam } = team;
    if (fmt === 'json') return { team: safeTeam, season, nodes: nodes.filter((n) => n.type !== 'item').map(({ content, ...n }) => n), requests };
    const md = workspaceOutline({ team, season, nodes, requests, today: kstToday(), base: base(ctx) });
    if (fmt === 'md') return { raw: md, headers: { 'content-type': 'text/markdown; charset=utf-8' } };
    const body = `<header><nav aria-label="breadcrumbs">${esc(team.name)}</nav><a href="/#/t/${esc(teamId)}">앱에서 열기</a><a href="/t/${esc(teamId)}.md">Markdown</a><a href="/agent">AI 안내</a></header>
<main data-team-id="${esc(teamId)}">${blocksToHtml(markdownToBlocks(md.replace(/^---[\s\S]*?---\n/, '')).map((b) => (b.type === 'bullet' ? { ...b, text: b.text.replace(/\[([^\]]+)\]\(([^)]*?)\.md\)/, '[$1]($2)') } : b)))}
${quickCommandForm(ctx, teamId, null)}</main>`;
    return { raw: page({ title: team.projectTitle, body, alternates: [{ type: 'text/markdown', href: `/t/${teamId}.md` }, { type: 'application/json', href: `/t/${teamId}.json` }] }), headers: { 'content-type': 'text/html; charset=utf-8' } };
  });

  const quickCommandForm = (ctx, teamId, nodeId) => `<section id="quick"><h2>빠른 명령 (AI 없이 규칙으로 처리)</h2>
<form id="quick-command" method="post" action="/p/${esc(nodeId || '_')}/preview"><input type="hidden" name="csrf" value="${esc(csrfFor(secret, ctx.user))}"><input type="hidden" name="mode" value="command"><input type="hidden" name="teamId" value="${esc(teamId)}">
<label for="cmd">명령</label> <input id="cmd" name="command" style="width:70%" placeholder="예: 오늘 lambda_privesc 풀었어 / 2차 주간보고서 만들어줘"> <button type="submit">미리보기</button></form></section>`;

  // ---- node views ----------------------------------------------------------
  r.get('/p/:id', async (ctx) => {
    const nl = needLogin(ctx); if (nl) return nl;
    const raw = ctx.params.id;
    const fmt = raw.endsWith('.md') ? 'md' : raw.endsWith('.json') ? 'json' : 'html';
    const id = raw.replace(/\.(md|json)$/, '');
    const node = await nodeAccess(ctx, id);
    const parent = node.parentId ? await store.get('node', node.parentId) : null;
    const children = (await store.list('node', { parentId: node.id })).filter((n) => !n.deleted).sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
    const team = node.teamId ? await store.get('team', node.teamId) : null;
    const md = nodeToMarkdown(node, { parent, children, team });
    if (fmt === 'md') return { raw: md, headers: { 'content-type': 'text/markdown; charset=utf-8' } };
    const validation = await validateNode(store, node).catch(() => null);
    if (fmt === 'json') return { node, parentFields: parent?.type === 'collection' ? parent.fields : null, children: children.map(({ content, ...c }) => c), validation };

    const crumbs = [];
    let p = parent;
    while (p && crumbs.length < 8) { crumbs.unshift(`<a href="/p/${esc(p.id)}">${esc(p.title)}</a>`); p = p.parentId ? await store.get('node', p.parentId) : null; }
    if (team) crumbs.unshift(`<a href="/t/${esc(team.id)}">${esc(team.name)}</a>`);
    let props = '';
    if (node.type === 'item' && parent?.fields) {
      props = `<dl id="properties" aria-label="속성">${parent.fields.map((f) => `<dt data-field-name="${esc(f.name)}" data-field-type="${f.type}">${esc(f.name)}</dt><dd data-field-name="${esc(f.name)}" data-value="${esc(JSON.stringify(node.props?.[f.id] ?? null))}">${propValueHtml(f, node.props?.[f.id])}</dd>`).join('')}</dl>`;
    }
    let collection = '';
    if (node.type === 'collection') {
      const fields = node.fields || [];
      const items = children.filter((c) => c.type === 'item');
      collection = `<section id="items"><h2>항목 ${items.length}개 · 뷰: ${(node.views || []).map((v) => `${esc(v.name)}(${v.type})`).join(', ')}</h2>
<table data-collection-id="${esc(node.id)}"><thead><tr><th data-field-name="이름" data-field-type="title">이름</th>${fields.map((f) => `<th data-field-name="${esc(f.name)}" data-field-type="${f.type}"${f.options?.length ? ` data-options="${esc(f.options.join('|'))}"` : ''}>${esc(f.name)}</th>`).join('')}</tr></thead>
<tbody>${items.map((it) => `<tr data-item-id="${esc(it.id)}"><td><a href="/p/${esc(it.id)}">${esc(it.title)}</a></td>${fields.map((f) => `<td data-field-name="${esc(f.name)}">${propValueHtml(f, it.props?.[f.id]).replace('<span class="muted">(비어 있음)</span>', '')}</td>`).join('')}</tr>`).join('\n')}</tbody></table></section>`;
    }
    const subpages = node.type !== 'collection' && children.length ? `<nav aria-label="하위 페이지"><h2>하위 페이지</h2><ul>${children.map((c) => `<li><a href="/p/${esc(c.id)}" data-node-type="${c.type}">${esc(c.title)}</a></li>`).join('')}</ul></nav>` : '';
    const rules = validation ? `<section id="rule-checks" aria-label="규칙 검증" data-passed="${validation.passed}"><h2>규칙 검증: ${validation.passed ? '통과' : `오류 ${validation.errors} · 경고 ${validation.warnings}`}</h2><ul>${validation.checks.map((c) => `<li data-rule-id="${esc(c.ruleId)}" data-key="${esc(c.key || '')}" data-passed="${c.passed}" data-level="${c.level}">${c.passed ? '✅' : c.level === 'warn' ? '⚠️' : c.level === 'info' ? 'ℹ️' : '❌'} ${esc(c.label)}: ${esc(c.detail)}</li>`).join('')}</ul>${validation.filename ? `<p>제출 파일명: <code>${esc(validation.filename)}</code> · <a href="/api/export/${esc(node.id)}">HTML 내보내기</a></p>` : ''}</section>` : '';
    const csrf = esc(csrfFor(secret, ctx.user));
    const notice = ctx.query.get('applied') ? `<p class="ok" role="status">적용했어요. <form method="post" action="/oplog/${esc(ctx.query.get('applied'))}/undo" style="display:inline"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="back" value="/p/${esc(node.id)}"><button class="btn secondary" type="submit">되돌리기</button></form></p>` : ctx.query.get('undone') ? '<p class="ok" role="status">되돌렸어요.</p>' : '';
    const edit = `<section id="edit"><h2>편집 (개인 AI나 사람이 이 폼을 채우면 미리보기 후 적용돼요)</h2>
<form id="edit-markdown" method="post" action="/p/${esc(node.id)}/preview"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="mode" value="markdown">
<label for="markdown"><b>Markdown으로 편집</b> <span class="muted">front matter의 id는 유지. ${node.type === 'collection' ? '표의 id 없는 행은 새 항목으로 추가돼요.' : '속성은 front matter의 properties에서 바꿔요.'}</span></label>
<textarea id="markdown" name="markdown" rows="${Math.min(40, Math.max(12, md.split('\n').length + 2))}">${esc(md)}</textarea><p><button type="submit">미리보기</button></p></form>
<form id="submit-ops" method="post" action="/p/${esc(node.id)}/preview"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="mode" value="ops">
<label for="ops"><b>Operation JSON</b> <span class="muted">구조 변경용. 형식은 <a href="/agent">AI 안내</a> 참고</span></label>
<textarea id="ops" name="ops" rows="8">{"summary": "", "ops": []}</textarea><p><button type="submit">미리보기</button></p></form></section>`;
    const body = `<header><nav aria-label="breadcrumbs">${crumbs.join(' › ')}</nav><a href="/#/t/${esc(node.teamId || '')}/n/${esc(node.id)}">앱에서 열기</a><a href="/p/${esc(node.id)}.md">Markdown</a><a href="/p/${esc(node.id)}.json">JSON</a><a href="/agent">AI 안내</a></header>
<main data-node-id="${esc(node.id)}" data-node-type="${node.type}" data-team-id="${esc(node.teamId || '')}"${node.sys ? ` data-role="${esc(node.sys)}"` : ''}>
${notice}<h1 data-field="title">${node.icon ? `${esc(node.icon)} ` : ''}${esc(node.title)}</h1>
${props}<article id="content" aria-label="본문">${blocksHtml(node)}</article>${collection}${subpages}${rules}${edit}${quickCommandForm(ctx, node.teamId, node.id)}
<script type="application/json" id="shapeshift-node">${jsonForScript({ id: node.id, type: node.type, teamId: node.teamId, title: node.title, parent: parent ? { id: parent.id, title: parent.title, fields: parent.fields } : null, props: node.props, fields: node.fields, views: node.views })}</script>
</main>`;
    return { raw: page({ title: node.title, body, alternates: [{ type: 'text/markdown', href: `/p/${node.id}.md` }, { type: 'application/json', href: `/p/${node.id}.json` }] }), headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } };
  });

  // ---- form submissions (no JS) ---------------------------------------------
  r.post('/p/:id/preview', async (ctx) => {
    const nl = needLogin(ctx); if (nl) return nl;
    checkCsrf(ctx);
    const b = ctx.body;
    let node = null;
    let teamId = b.teamId || null;
    if (ctx.params.id !== '_') { node = await nodeAccess(ctx, ctx.params.id); teamId = node.teamId; } else if (teamId) await requireTeam(ctx, teamId);
    let p;
    try {
      if (b.mode === 'markdown') p = await orch.plan({ user: ctx.user, teamId, markdown: b.markdown, nodeId: node?.id, origin: 'agent-form' });
      else if (b.mode === 'ops') p = await orch.plan({ user: ctx.user, teamId, ops: b.ops, origin: 'agent-form', selection: node ? { nodeId: node.id } : null });
      else p = await orch.plan({ user: ctx.user, teamId, text: b.command || '', origin: 'agent-form', selection: node ? { nodeId: node.id } : null });
    } catch (e) {
      return { raw: page({ title: '미리보기 실패', body: `<main><h1>미리보기 실패</h1><p class="warn" role="alert">${esc(e.message)}</p><p><a class="btn secondary" href="${node ? `/p/${esc(node.id)}` : `/t/${esc(teamId)}`}">돌아가기</a></p></main>` }), headers: { 'content-type': 'text/html; charset=utf-8' } };
    }
    const back = node ? `/p/${node.id}` : `/t/${teamId}`;
    const diff = p.plan?.diff || [];
    const csrf = esc(csrfFor(secret, ctx.user));
    const body = `<header><nav aria-label="breadcrumbs"><a href="${esc(back)}">← 돌아가기</a></nav><a href="/agent">AI 안내</a></header>
<main id="plan-preview" data-prompt-id="${esc(p.id)}" data-status="${p.status}" data-destructive="${Boolean(p.plan?.destructive)}">
<h1>변경 미리보기</h1><p><b>${esc(p.plan?.summary || p.text || '')}</b> <span class="muted">(출처: ${esc(p.provider)})</span></p>
${p.error ? `<p class="warn" role="alert">검증 실패: ${esc(p.error.message)}</p>` : ''}
${p.plan?.reply ? `<p>${esc(p.plan.reply)}</p>` : ''}
${p.plan?.destructive ? '<p class="warn" role="alert">⚠ 삭제나 구조 변경이 포함돼 있어요.</p>' : ''}
<ul class="diff" id="plan-diff">${diff.map((d) => `<li data-action="${d.action}" data-kind="${esc(d.kind)}" data-id="${esc(d.id)}"><b>${{ create: '추가', update: '변경', delete: '삭제' }[d.action]}</b> ${esc(d.title)}${d.changes?.length ? ` <span class="muted">${esc(d.changes.join(' · '))}</span>` : ''}</li>`).join('')}</ul>
${(p.plan?.notes || []).length ? `<ul class="muted">${p.plan.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
${p.status === 'planned' ? `<form id="apply-plan" method="post" action="/prompts/${esc(p.id)}/apply"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="back" value="${esc(back)}"><button type="submit">적용</button> <a class="btn secondary" href="${esc(back)}">취소</a></form>` : `<p><a class="btn secondary" href="${esc(back)}">돌아가기</a></p>`}
<details><summary>계획 JSON</summary><pre>${esc(JSON.stringify(p.plan?.ops || [], null, 2))}</pre></details>
<script type="application/json" id="shapeshift-plan">${jsonForScript(p)}</script></main>`;
    return { raw: page({ title: '변경 미리보기', body }), headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } };
  }, { bodyLimit: 6 * 1024 * 1024 });

  r.post('/prompts/:id/apply', async (ctx) => {
    const nl = needLogin(ctx); if (nl) return nl;
    checkCsrf(ctx);
    const res = await orch.apply({ user: ctx.user, promptId: ctx.params.id });
    const back = /^\/(p|t)\/[\w-]+$/.test(ctx.body.back || '') ? ctx.body.back : '/';
    const target = back.startsWith('/p/') && !(await store.get('node', back.slice(3)))?.deleted ? back : (res.teamId ? `/t/${res.teamId}` : '/');
    return { redirect: `${target}?applied=${res.oplogId}` };
  });

  r.post('/oplog/:id/undo', async (ctx) => {
    const nl = needLogin(ctx); if (nl) return nl;
    checkCsrf(ctx);
    await orch.undo({ user: ctx.user, oplogId: ctx.params.id, force: ctx.body.force === '1' });
    const back = /^\/(p|t)\/[\w-]+$/.test(ctx.body.back || '') ? ctx.body.back : '/';
    return { redirect: `${back}?undone=1` };
  });

  // ---- JSON API helpers for agents ------------------------------------------
  r.post('/api/nodes/:id/markdown', async (ctx) => {
    const node = await nodeAccess(ctx, ctx.params.id);
    const p = await orch.plan({ user: ctx.user, teamId: node.teamId, markdown: ctx.body.markdown, nodeId: node.id, origin: 'api', summary: ctx.body.summary || '' });
    if (ctx.body.apply && p.status === 'planned') return orch.apply({ user: ctx.user, promptId: p.id, confirmDestructive: Boolean(ctx.body.confirm_destructive) });
    return p;
  }, { bodyLimit: 6 * 1024 * 1024 });

  r.get('/api/agent/package', async (ctx) => {
    const teamId = ctx.query.get('teamId');
    const { team } = await requireTeam(ctx, teamId);
    const season = team.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
    const nodes = (await store.list('node', { teamId })).filter((n) => !n.deleted);
    const outline = workspaceOutline({ team, season, nodes, requests: await store.list('request', { teamId, done: false }), today: kstToday(), base: base(ctx) });
    let nodeMd = null;
    const nodeId = ctx.query.get('nodeId');
    if (nodeId) {
      const node = await nodeAccess(ctx, nodeId);
      const parent = node.parentId ? await store.get('node', node.parentId) : null;
      const children = (await store.list('node', { parentId: node.id })).filter((n) => !n.deleted);
      nodeMd = nodeToMarkdown(node, { parent, children, team });
    }
    return { markdown: contextPackage({ task: ctx.query.get('task') || '', outline, nodeMd, base: base(ctx) }) };
  });

  r.post('/api/tokens/personal', async (ctx) => {
    const user = requireUser(ctx);
    if (user.viaToken || user.isToken) throw new HttpError(403, '토큰으로는 새 토큰을 만들 수 없어요');
    return auth.createPersonalToken(user.id, ctx.body.name);
  });
  r.get('/api/tokens/personal', async (ctx) => {
    const user = requireUser(ctx);
    return { tokens: (await store.list('apitoken', { kind: 'personal', userId: user.id })).filter((t) => !t.revoked).map(({ id, name, prefix, lastUsedAt, createdAt }) => ({ id, name, prefix, lastUsedAt, createdAt })) };
  });
  r.delete('/api/tokens/personal/:id', async (ctx) => {
    const user = requireUser(ctx);
    const t = await store.get('apitoken', ctx.params.id);
    if (!t || t.userId !== user.id) throw new HttpError(404, '토큰 없음');
    t.revoked = true;
    await store.put('apitoken', t);
    return { ok: true };
  });

  // ---- MCP (JSON-RPC 2.0 over HTTP, stateless) -------------------------------
  const TOOLS = [
    { name: 'list_teams', description: 'List teams the user can access (id, name, project, role).', inputSchema: { type: 'object', properties: {} } },
    { name: 'workspace_outline', description: 'Markdown outline of a team workspace: members, season deadlines, club rules, node tree with ids and collection fields. Start here.', inputSchema: { type: 'object', properties: { teamId: { type: 'string' } }, required: ['teamId'] } },
    { name: 'read_node', description: 'Read a page/collection/item as Markdown (front matter + body; collections include an item table) or JSON.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, format: { type: 'string', enum: ['markdown', 'json'] } }, required: ['nodeId'] } },
    { name: 'search', description: 'Full-text search in a team workspace.', inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, query: { type: 'string' } }, required: ['teamId', 'query'] } },
    { name: 'validate', description: 'Run club rule checks (weekly report sections, article title rules, filename) on a node.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] } },
    { name: 'preview_ops', description: `Validate and preview an operation plan without changing anything. Returns promptId and diff.\n${OP_REFERENCE}`, inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, summary: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } } }, required: ['ops'] } },
    { name: 'apply_ops', description: 'Apply a previewed plan (promptId from preview_ops/edit_markdown/quick_command), or preview+apply ops directly. Destructive plans need confirm_destructive=true and should only be used when the user explicitly asked.', inputSchema: { type: 'object', properties: { promptId: { type: 'string' }, teamId: { type: 'string' }, summary: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } }, confirm_destructive: { type: 'boolean' } } } },
    { name: 'edit_markdown', description: 'Submit an edited Markdown document (from read_node). Returns a preview (promptId, diff); set apply=true to apply immediately.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, markdown: { type: 'string' }, apply: { type: 'boolean' } }, required: ['nodeId', 'markdown'] } },
    { name: 'quick_command', description: 'Rule-based Korean quick command without AI, e.g. "오늘 lambda_privesc 풀었어", "2차 주간보고서 만들어줘". Returns a preview.', inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, text: { type: 'string' } }, required: ['teamId', 'text'] } },
    { name: 'undo', description: 'Undo an applied change by oplogId.', inputSchema: { type: 'object', properties: { oplogId: { type: 'string' } }, required: ['oplogId'] } },
  ];
  const summarizePrompt = (p) => JSON.stringify({ promptId: p.id, status: p.status, source: p.provider, summary: p.plan?.summary, destructive: p.plan?.destructive, diff: (p.plan?.diff || []).map((d) => ({ action: d.action, kind: d.kind, id: d.id, title: d.title, changes: d.changes })), notes: p.plan?.notes, error: p.error, reply: p.plan?.reply, oplogId: p.oplogId }, null, 1);

  async function callTool(ctx, name, a = {}) {
    switch (name) {
      case 'list_teams': {
        const ms = ctx.user.isAdmin ? (await store.list('team', {})).map((t) => ({ teamId: t.id, role: 'admin' })) : await store.list('membership', { userId: ctx.user.id });
        const out = [];
        for (const m of ms) { const t = await store.get('team', m.teamId); if (t) out.push({ id: t.id, name: t.name, project: t.projectTitle, role: m.role }); }
        return JSON.stringify(out, null, 1);
      }
      case 'workspace_outline': {
        const { team } = await requireTeam(ctx, a.teamId);
        const season = team.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
        return workspaceOutline({ team, season, nodes: (await store.list('node', { teamId: team.id })).filter((n) => !n.deleted), requests: await store.list('request', { teamId: team.id, done: false }), today: kstToday(), base: base(ctx) });
      }
      case 'read_node': {
        const node = await nodeAccess(ctx, a.nodeId);
        const parent = node.parentId ? await store.get('node', node.parentId) : null;
        const children = (await store.list('node', { parentId: node.id })).filter((n) => !n.deleted);
        if (a.format === 'json') return JSON.stringify({ node, parentFields: parent?.fields || null, children: children.map(({ content, ...c }) => c) }, null, 1);
        return nodeToMarkdown(node, { parent, children, team: node.teamId ? await store.get('team', node.teamId) : null });
      }
      case 'search': {
        await requireTeam(ctx, a.teamId);
        const q = String(a.query || '').toLowerCase();
        const nodes = (await store.list('node', { teamId: a.teamId })).filter((n) => !n.deleted);
        return JSON.stringify(nodes.filter((n) => n.title.toLowerCase().includes(q) || (n.content || []).some((b) => String(b.text || '').toLowerCase().includes(q))).slice(0, 30).map((n) => ({ id: n.id, type: n.type, title: n.title })), null, 1);
      }
      case 'validate': return JSON.stringify(await validateNode(store, await nodeAccess(ctx, a.nodeId)), null, 1);
      case 'preview_ops': {
        if (a.teamId) await requireTeam(ctx, a.teamId);
        return summarizePrompt(await orch.plan({ user: ctx.user, teamId: a.teamId || null, ops: a.ops, summary: a.summary || '', origin: 'mcp' }));
      }
      case 'apply_ops': {
        let promptId = a.promptId;
        if (!promptId) {
          if (a.teamId) await requireTeam(ctx, a.teamId);
          const p = await orch.plan({ user: ctx.user, teamId: a.teamId || null, ops: a.ops, summary: a.summary || '', origin: 'mcp' });
          if (p.status !== 'planned') return summarizePrompt(p);
          promptId = p.id;
        }
        return summarizePrompt(await orch.apply({ user: ctx.user, promptId, confirmDestructive: Boolean(a.confirm_destructive) }));
      }
      case 'edit_markdown': {
        const node = await nodeAccess(ctx, a.nodeId);
        const p = await orch.plan({ user: ctx.user, teamId: node.teamId, markdown: a.markdown, nodeId: node.id, origin: 'mcp' });
        if (a.apply && p.status === 'planned') return summarizePrompt(await orch.apply({ user: ctx.user, promptId: p.id, confirmDestructive: false }));
        return summarizePrompt(p);
      }
      case 'quick_command': {
        await requireTeam(ctx, a.teamId);
        return summarizePrompt(await orch.plan({ user: ctx.user, teamId: a.teamId, text: a.text, origin: 'mcp' }));
      }
      case 'undo': return JSON.stringify(await orch.undo({ user: ctx.user, oplogId: a.oplogId }));
      default: throw new HttpError(404, `unknown tool ${name}`);
    }
  }

  r.get('/mcp', async () => ({ raw: JSON.stringify({ error: 'Use POST with JSON-RPC 2.0 (MCP streamable HTTP, JSON responses). See /agent' }), status: 405, headers: { 'content-type': 'application/json', allow: 'POST' } }));
  r.post('/mcp', async (ctx) => {
    if (!ctx.user || !(ctx.user.viaToken || ctx.user.isToken)) {
      return { raw: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Authorization: Bearer <personal token> required (팀 설정 > 개인 AI 연결)' } }), status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } };
    }
    const msgs = Array.isArray(ctx.body) ? ctx.body : [ctx.body];
    const out = [];
    for (const m of msgs) {
      if (!m || m.jsonrpc !== '2.0' || !m.method) { out.push({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Invalid Request' } }); continue; }
      if (m.id === undefined || m.id === null) continue; // notification
      try {
        let result;
        if (m.method === 'initialize') result = { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'shapeshift', version: '0.2.0' }, instructions: 'Start with list_teams, then workspace_outline. Read with read_node (Markdown), edit with edit_markdown or preview_ops/apply_ops. Every change is previewed and undoable. Respect club rules via validate.' };
        else if (m.method === 'ping') result = {};
        else if (m.method === 'tools/list') result = { tools: TOOLS };
        else if (m.method === 'tools/call') {
          try { result = { content: [{ type: 'text', text: await callTool(ctx, m.params?.name, m.params?.arguments || {}) }] }; } catch (e) { result = { content: [{ type: 'text', text: `오류: ${e.message}` }], isError: true }; }
        } else { out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } }); continue; }
        out.push({ jsonrpc: '2.0', id: m.id, result });
      } catch (e) {
        out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: e.message } });
      }
    }
    if (!out.length) return { raw: '', status: 202, headers: {} };
    return { raw: JSON.stringify(Array.isArray(ctx.body) ? out : out[0]), headers: { 'content-type': 'application/json' } };
  }, { bodyLimit: 6 * 1024 * 1024 });
}
