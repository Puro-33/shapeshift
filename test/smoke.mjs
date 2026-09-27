// End-to-end HTTP smoke test against a running server: node test/smoke.mjs http://localhost:8787
import { SSG_GUIDE, ARTICLE_HTML, PROWLER_OCSF_1 } from './fixtures.js';

const base = process.argv[2] || 'http://localhost:8787';
let cookie = '';
const results = [];
async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'x-shapeshift': '1', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
function check(name, cond, extra = '') { results.push([cond ? 'PASS' : 'FAIL', name, extra]); }

const email = `admin${Date.now()}@ssg.test`;
let r = await call('GET', '/api/health');
check('health', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await call('POST', '/api/auth/register', { email, name: '차정훈', password: 'correct-horse-1' });
check('register (first user = admin)', r.status === 200, JSON.stringify(r.data));
r = await call('POST', '/api/prompts', { text: 'x' }, { 'x-shapeshift': '' });
check('CSRF header required', r.status === 403);
r = await call('POST', '/api/seasons', { sourceText: SSG_GUIDE, year: 2026 });
check('season from guide', r.status === 200 && r.data.results[0].milestones >= 15, JSON.stringify(r.data.results?.[0]));
r = await call('POST', '/api/ops', { teamId: null, summary: '팀 만들기', ops: [{ op: 'create_team', name: '컴공컴공컴공경영let’sgo', project: 'DevSecOps CI/CD 파이프라인 통합 보안 스캐너', topic: 'DevSecOps', members: [{ name: '김성주', role: 'pm' }, '김원준', '변정현', '차정훈'] }] });
const teamId = r.data.teamId;
check('create team', r.status === 200 && teamId, JSON.stringify(r.data).slice(0, 200));
r = await call('GET', `/api/teams/${teamId}`);
check('team view', r.status === 200 && r.data.nodes.some((n) => n.sys === 'deliverables'));
const deliv = r.data.nodes.find((n) => n.sys === 'deliverables');
r = await call('POST', '/api/prompts', { teamId, text: '오늘 iam_privesc_by_rollback 풀었고 prowler로 rollback 문제 점검해봄' });
check('prompt planned (rules)', r.status === 200 && r.data.status === 'planned', `${r.data.provider} ${r.data.plan?.summary}`);
const pid = r.data.id;
r = await call('POST', `/api/prompts/${pid}/apply`);
check('apply prompt', r.status === 200 && r.data.status === 'applied');
const oplogId = r.data.oplogId;
r = await call('POST', '/api/prompts', { teamId, text: '2차 아티클로 가져와줘', attachment: ARTICLE_HTML });
check('ingest plan', r.status === 200 && r.data.status === 'planned', JSON.stringify(r.data.plan?.ops?.[0]).slice(0, 160));
r = await call('POST', `/api/prompts/${r.data.id}/apply`);
const articleId = r.data.results?.[0]?.id;
check('article applied', r.status === 200 && articleId);
r = await call('GET', `/api/nodes/${articleId}`);
check('article validated', r.data.validation?.kind === 'article' && r.data.node.title.startsWith('[컴공'), r.data.node?.title);
r = await call('POST', '/api/ops', { teamId, summary: 'html', ops: [{ op: 'set_content', node: articleId, mode: 'append', content: [{ type: 'html', id: 'b_evil', title: 'evil', html: '<h1>hi</h1><img src=x onerror="alert(1)"><script>alert(2)</script>' }] }] });
r = await call('GET', `/api/render/${articleId}/b_evil`);
check('render safe strips scripts', r.status === 200 && !String(r.data).includes('<script') && !String(r.data).includes('onerror'), String(r.data).slice(0, 80));
check('render CSP sandbox', (r.headers.get('content-security-policy') || '').startsWith('sandbox;'));
r = await call('GET', `/api/render/${articleId}/b_evil?mode=interactive`);
check('interactive CSP blocks network', /sandbox allow-scripts/.test(r.headers.get('content-security-policy')) && /connect-src 'none'/.test(r.headers.get('content-security-policy')));
r = await call('POST', '/api/prompts', { teamId, text: '2차 주간보고서 초안 만들어줘' });
check('weekly plan', r.data.status === 'planned', r.data.plan?.summary);
r = await call('POST', `/api/prompts/${r.data.id}/apply`);
const reportId = r.data.results?.[0]?.id;
r = await call('GET', `/api/export/${reportId}`);
check('export html', r.status === 200 && /2%EC%B0%A8|2차/.test(decodeURIComponent(r.headers.get('content-disposition') || '')), decodeURIComponent(r.headers.get('content-disposition') || ''));
r = await call('POST', '/api/tokens', { teamId, name: 'ci' });
const token = r.data.token;
check('api token', Boolean(token));
const savedCookie = cookie; cookie = '';
r = await call('POST', '/api/ingest', { kind: 'prowler', content: PROWLER_OCSF_1, source: 'github-actions' }, { authorization: `Bearer ${token}` });
check('token ingest prowler', r.status === 200 && r.data.result?.fail === 2, JSON.stringify(r.data).slice(0, 200));
cookie = savedCookie;
r = await call('POST', `/api/oplog/${oplogId}/undo`, {});
check('undo', r.status === 200, JSON.stringify(r.data));
r = await call('POST', '/api/cron/tick', {}, { 'x-cron-secret': 'local-cron' });
check('cron tick', r.status === 200, JSON.stringify(r.data).slice(0, 120));
r = await call('GET', '/');
check('index served with CSP', r.status === 200 && (r.headers.get('content-security-policy') || '').includes("script-src 'self'"));

// ---- AI-readable surface (BYO-AI) ----
async function form(path, fields, headers = {}) {
  const res = await fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...headers }, body: new URLSearchParams(fields).toString() });
  return { status: res.status, data: await res.text(), headers: res.headers };
}
const askLine = '## 도움 필요(Ask)\n\n- (작성 필요)';
r = await call('GET', '/agent');
check('agent guide html', r.status === 200 && String(r.data).includes('Operation reference'));
r = await call('GET', '/llms.txt');
check('llms.txt', r.status === 200 && String(r.data).startsWith('# Shapeshift'));
r = await call('GET', `/t/${teamId}.md`);
check('workspace outline md', r.status === 200 && String(r.data).includes(deliv.id), String(r.data).slice(0, 120));
r = await call('GET', `/p/${reportId}.md`);
const reportMd = String(r.data);
check('node markdown', r.status === 200 && reportMd.startsWith('---') && reportMd.includes(`id: ${reportId}`) && reportMd.includes(askLine));
r = await call('GET', `/p/${reportId}`);
const pageHtml = String(r.data);
const csrf = (pageHtml.match(/name="csrf" value="([^"]+)"/) || [])[1];
check('agent html view', r.status === 200 && pageHtml.includes('data-block-id=') && pageHtml.includes('id="edit-markdown"') && pageHtml.includes('id="rule-checks"') && Boolean(csrf));
r = await call('GET', `/p/${reportId}.json`);
check('node json', r.status === 200 && r.data.node?.id === reportId);
const editedMd = reportMd.replace(askLine, '## 도움 필요(Ask)\n\n- Prowler 결과를 CI에 넣는 방법 조언');
r = await form(`/p/${reportId}/preview`, { mode: 'markdown', markdown: editedMd });
check('form without csrf rejected', r.status === 403);
r = await form(`/p/${reportId}/preview`, { csrf, mode: 'markdown', markdown: editedMd });
const pv = String(r.data);
const pid2 = (pv.match(/data-prompt-id="([^"]+)"/) || [])[1];
check('form markdown preview', r.status === 200 && pv.includes('data-status="planned"') && Boolean(pid2), pv.slice(pv.indexOf('<main'), pv.indexOf('<main') + 300));
r = await form(`/prompts/${pid2}/apply`, { csrf, back: `/p/${reportId}` });
check('form apply redirects', r.status === 303 && /applied=op_/.test(r.headers.get('location') || ''), r.headers.get('location'));
r = await call('GET', `/p/${reportId}.md`);
check('markdown edit persisted', String(r.data).includes('Prowler 결과를 CI에 넣는 방법 조언'));
check('checklist synced with rules', String(r.data).includes('- [x] 도움 필요(Ask)가 작성 되었는가?'), (String(r.data).match(/- \[.\] 도움 필요[^\n]*/) || [''])[0]);
r = await call('POST', `/api/nodes/${reportId}/markdown`, { markdown: String(r.data).replace('Prowler 결과를 CI에 넣는 방법 조언', 'CI 통합 조언 요청') });
check('api markdown preview', r.status === 200 && r.data.status === 'planned' && r.data.provider === 'markdown', JSON.stringify(r.data).slice(0, 200));
r = await call('POST', '/api/prompts', { teamId, text: JSON.stringify({ summary: 'AI가 제안한 이슈 DB', ops: [{ op: 'create_node', type: 'collection', parent: deliv.parentId, title: 'Issues', fields: [{ name: '심각도', type: 'select', options: ['high', 'low'] }] }] }) });
check('pasted plan JSON detected', r.status === 200 && r.data.provider === 'user-ai' && r.data.status === 'planned', JSON.stringify(r.data).slice(0, 200));
r = await call('GET', `/api/agent/package?teamId=${teamId}&nodeId=${reportId}&task=${encodeURIComponent('인사이트 채워줘')}`);
check('context package', r.status === 200 && r.data.markdown.includes('인사이트 채워줘') && r.data.markdown.includes('## 현재 문서'));
r = await call('POST', '/api/tokens/personal', { name: 'claude-desktop' });
const ptok = r.data.token;
check('personal token', Boolean(ptok));
const mcp = async (body, auth = true) => { const res = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${ptok}` } : {}) }, body: JSON.stringify(body) }); return { status: res.status, data: res.status === 202 ? null : await res.json() }; };
const initMsg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } };
r = await mcp(initMsg, false);
check('mcp requires token', r.status === 401);
r = await mcp(initMsg);
check('mcp initialize', r.data?.result?.serverInfo?.name === 'shapeshift');
r = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
check('mcp notification 202', r.status === 202);
r = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
check('mcp tools/list', (r.data?.result?.tools || []).length === 10);
r = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_node', arguments: { nodeId: reportId } } });
check('mcp read_node', String(r.data?.result?.content?.[0]?.text || '').includes(`id: ${reportId}`));
r = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'apply_ops', arguments: { teamId, summary: 'MCP 활동 기록', ops: [{ op: 'log_activity', text: 'MCP로 기록한 활동', member: '차정훈' }] } } });
check('mcp apply_ops', /"status": "applied"/.test(r.data?.result?.content?.[0]?.text || ''), JSON.stringify(r.data).slice(0, 200));
r = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'apply_ops', arguments: { teamId, ops: [{ op: 'delete_node', node: deliv.id }] } } });
check('mcp destructive needs confirm', r.data?.result?.isError === true && /confirm_destructive/.test(r.data?.result?.content?.[0]?.text || ''), JSON.stringify(r.data).slice(0, 200));

for (const [s, n, e] of results) console.log(`${s}  ${n}${e && s === 'FAIL' ? `  -> ${e}` : ''}`);
console.log(`${results.filter((x) => x[0] === 'PASS').length}/${results.length} passed`);
console.log(`teamId=${teamId} email=${email}`);
