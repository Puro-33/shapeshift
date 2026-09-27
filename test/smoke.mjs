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
check('prompt planned (heuristic or LLM)', r.status === 200 && r.data.status === 'planned', `${r.data.provider} ${r.data.plan?.summary}`);
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

for (const [s, n, e] of results) console.log(`${s}  ${n}${e && s === 'FAIL' ? `  -> ${e}` : ''}`);
console.log(`${results.filter((x) => x[0] === 'PASS').length}/${results.length} passed`);
console.log(`teamId=${teamId} email=${email}`);
