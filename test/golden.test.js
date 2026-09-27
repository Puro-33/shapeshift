// Golden scenarios from SPEC §11, using real SSG structure as fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store/memory.js';
import { Orchestrator, MACROS } from '../server/ai/orchestrator.js';
import { executePlan } from '../server/core/ops.js';
import { parseSeasonText } from '../server/services/season.js';
import { validateNode, exportNodeHtml, sectionBullets } from '../server/services/reports.js';
import { findSys, fieldByName } from '../server/services/teams.js';
import { htmlToBlocks, maskSecrets, parseProwler } from '../server/services/ingest.js';
import { fetchNotionTree } from '../server/services/notion.js';
import { nodeToMarkdown, splitFrontMatter } from '../server/core/markdown.js';
import { SSG_GUIDE, REPORT_1_MD, ARTICLE_HTML, PROWLER_OCSF_1, PROWLER_OCSF_2 } from './fixtures.js';

const admin = { id: 'u_admin', name: '운영진', isAdmin: true };
const pm = { id: 'u_pm', name: '김성주' };
const jh = { id: 'u_jh', name: '차정훈' };
const NOW = new Date('2026-09-25T03:00:00Z'); // 2026-09-25 KST, inside 2차 period

async function setup() {
  const store = new MemoryStore();
  for (const u of [admin, pm, jh]) await store.put('user', { ...u, email: `${u.id}@x.io` });
  const orch = new Orchestrator({ store, log: () => {} });
  await orch.applyDirect({ user: admin, teamId: null, ops: [{ op: 'create_season', sourceText: SSG_GUIDE, year: 2026 }], now: NOW });
  const res = await orch.applyDirect({
    user: pm, teamId: null, now: NOW,
    ops: [{ op: 'create_team', name: '컴공컴공컴공경영let’sgo', project: 'DevSecOps CI/CD 파이프라인 통합 보안 스캐너', topic: 'DevSecOps', members: [{ name: '김성주', role: 'pm' }, { name: '김원준' }, { name: '변정현' }, { name: '차정훈' }] }],
  });
  const teamId = res.teamId || res.results[0].teamId;
  await store.put('membership', { id: `${teamId}:${jh.id}`, teamId, userId: jh.id, role: 'member' });
  return { store, orch, teamId };
}

test('G1 season from the SSG guide', () => {
  const s = parseSeasonText(SSG_GUIDE, { year: 2026 });
  assert.equal(s.start, '2026-08-31');
  assert.equal(s.end, '2027-01-03');
  const weekly = s.milestones.filter((m) => m.kind === 'weekly');
  assert.equal(weekly.length, 9);
  assert.equal(weekly[0].due, '2026-09-20');
  assert.equal(weekly.find((m) => m.round === 4).due, '2026-11-01');
  assert.equal(weekly.at(-1).due, '2026-12-27');
  assert.equal(s.milestones.filter((m) => m.kind === 'kickoff').length, 2);
  assert.equal(s.milestones.filter((m) => m.kind === 'break').length, 2);
  assert.equal(s.milestones.find((m) => m.kind === 'final').due, '2027-01-03');
  const fp = s.milestones.find((m) => m.title === '최종 발표');
  assert.equal(fp.start, '2027-01-04');
  const sections = s.rules.find((r) => r.kind === 'required_sections').sections;
  assert.equal(sections.length, 6);
  assert.ok(sections.some((x) => x.key === 'ask' && x.minItems === 1 && x.maxItems === 2));
  const kinds = s.rules.map((r) => `${r.kind}:${r.appliesTo}`);
  for (const k of ['title_pattern:article', 'required_mentions:article', 'filename:kickoff', 'filename:presentation', 'filename:final', 'submitter_role:deliverable', 'participation_cap:kickoff']) assert.ok(kinds.includes(k), k);
});

test('team scaffolding creates Notion-like 산출물 with season slots (P5/P6)', async () => {
  const { store, teamId } = await setup();
  const col = await findSys(store, teamId, 'deliverables');
  const items = (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted);
  assert.equal(items.length, 2 + 9 + 9 + 1);
  const r1 = items.find((i) => i.title === '1차 주간보고서');
  assert.equal(r1.props[fieldByName(col, 'D-day').id], '2026-09-20');
  assert.equal(r1.props[fieldByName(col, '종류').id], '주간보고');
  assert.equal(r1.props[fieldByName(col, '상태').id], '시작 전');
  assert.ok(col.views.some((v) => v.type === 'calendar'));
  assert.ok(await findSys(store, teamId, 'activity'));
  assert.ok(await findSys(store, teamId, 'tasks'));
});

test('G2-G4 weekly report: carry-over, rule violations, planned-vs-done', async () => {
  const { store, orch, teamId } = await setup();
  const col = await findSys(store, teamId, 'deliverables');
  const r1 = (await store.list('node', { parentId: col.id })).find((i) => i.title === '1차 주간보고서');
  await orch.applyDirect({ user: pm, teamId, ops: [{ op: 'set_content', node: r1.id, markdown: REPORT_1_MD }], now: NOW });

  // G3: the team's own template misses Ask + submit date
  const v1 = await validateNode(store, await store.get('node', r1.id));
  assert.equal(v1.kind, 'weekly_report');
  assert.equal(v1.checks.find((c) => c.key === 'ask').passed, false);
  assert.equal(v1.checks.find((c) => c.ruleId === 'r_weekly_submit_date').passed, false);
  assert.equal(v1.checks.find((c) => c.key === 'photo').passed, false);

  await orch.applyDirect({ user: jh, teamId, now: NOW, ops: [
    { op: 'log_activity', text: 'cloud goat writeup 작성하여 노션에 업로드', date: '2026-09-22', member: '차정훈', tags: ['문제풀이'] },
    { op: 'log_activity', text: 'prowler 사용해서 rollback 문제에 적용', date: '2026-09-23', member: '변정현', tags: ['점검'] },
    { op: 'log_activity', text: 'iam_privesc_by_key_rotation 풀이', date: '2026-09-24', member: '김성주' },
  ] });
  const res = await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [{ op: 'draft_weekly_report', insights: ['Prowler는 IAM 설정 오류를 CloudGoat 공격 경로와 연결해 보여준다'], asks: ['Prowler 결과를 CI에 넣는 방법 조언'], next: ['prowler 기능 분석', 'medium 2문제', '9/29(화) 22:00 디스코드 공유'] }] });
  assert.equal(res.results[0].round, 2);
  assert.equal(res.results[0].carriedGoals, 3);
  const r2 = await store.get('node', res.results[0].id);
  const goals = sectionBullets(r2.content, ['이번 주 목표']);
  assert.ok(goals.some((g) => g.includes('cloud goat writeup')), 'G2 carry-over');
  const pvd = r2.content.find((b) => b.type === 'table' && b.rows[0][0] === '구분');
  assert.deepEqual(pvd.rows[0], ['구분', '김성주', '김원준', '변정현', '차정훈']);
  assert.equal(pvd.rows[1][0], '이번 주 목표');
  const statusRow = pvd.rows.find((r) => r[0] === '금주 수행 현황');
  assert.notEqual(statusRow[4], '-', '차정훈 did work');
  assert.ok(r2.content.some((b) => b.type === 'h2' && b.text.includes('도움 필요')), 'Ask section added');
  const submit = r2.content.find((b) => b.text?.startsWith('주간 보고서 제출 날짜'));
  assert.match(submit.text, /2026-09-27/);
  const v2 = await validateNode(store, r2);
  assert.equal(v2.checks.find((c) => c.key === 'ask').passed, true);
  assert.equal(v2.checks.find((c) => c.key === 'insights').passed, true);
  assert.equal(v2.checks.find((c) => c.key === 'photo').passed, false);
  assert.ok(r2.content.some((b) => b.type === 'todo' && b.text.includes('도움 필요') && b.checked));
  const reqs = await store.list('request', { teamId });
  assert.ok(reqs.some((q) => q.text.includes('회의 사진')));
  const { html, filename } = await exportNodeHtml(store, r2);
  assert.match(filename, /^\(2차주간보고서\)SSG_팀프로젝트_컴공컴공컴공경영let’sgo\.html$/);
  assert.match(html, /<table>/);
});

test('G5 article: chat noise removed, [팀명] title, secrets masked, scripts dropped', async () => {
  const { store, orch, teamId } = await setup();
  const res = await orch.applyDirect({ user: jh, teamId, now: NOW, ops: [{ op: 'ingest_content', kind: 'article', html: ARTICLE_HTML }] });
  const item = await store.get('node', res.results[0].id);
  assert.equal(item.title, '[컴공컴공컴공경영let’sgo] DevSecOps와 CSPM 개념 정리');
  const text = JSON.stringify(item.content);
  assert.ok(!text.includes('붙여넣을 수 있게'), 'noise removed');
  assert.ok(!text.includes('AKIAABCDEFGHIJKLMNOP'), 'key masked');
  assert.ok(text.includes('MASKED:aws-access-key'));
  assert.ok(!text.includes('alert(1)'));
  assert.ok(item.content.some((b) => b.type === 'table' && b.rows[1][1] === 'Semgrep'));
  const v = await validateNode(store, item);
  assert.equal(v.kind, 'article');
  assert.ok(v.checks.every((c) => c.passed || c.level === 'info'), JSON.stringify(v.checks));
  const col = await findSys(store, teamId, 'deliverables');
  assert.equal(item.props[fieldByName(col, '차수').id], 2);
});

test('G9 Prowler: new / persisting / resolved across scans, undo restores', async () => {
  const { store, orch, teamId } = await setup();
  const a = await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [{ op: 'ingest_content', kind: 'prowler', text: PROWLER_OCSF_1 }] });
  assert.equal(a.results[0].fail, 2);
  assert.equal(a.results[0].new, 2);
  const b = await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [{ op: 'ingest_content', kind: 'prowler', text: PROWLER_OCSF_2 }] });
  assert.equal(b.results[0].new, 1);
  assert.equal(b.results[0].persisting, 1);
  assert.equal(b.results[0].resolved, 1);
  const col = await findSys(store, teamId, 'findings');
  const st = fieldByName(col, '상태').id;
  const items = (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted);
  assert.equal(items.find((i) => i.title.startsWith('S3')).props[st], '해결됨');
  await orch.undo({ user: pm, oplogId: b.oplogId });
  const after = (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted);
  assert.equal(after.length, 2);
  assert.equal(after.find((i) => i.title.startsWith('S3')).props[st], 'FAIL');
});

test('prowler HTML + CSV parsing', () => {
  const html = '<table><tr><th>Status</th><th>Severity</th><th>Service Name</th><th>Region</th><th>Check ID</th><th>Check Title</th><th>Resource ID</th></tr><tr><td>FAIL</td><td>high</td><td>iam</td><td>us-east-1</td><td>iam_root_mfa</td><td>Root MFA</td><td>root</td></tr></table>';
  const h = parseProwler(html);
  assert.equal(h[0].checkId, 'iam_root_mfa');
  assert.equal(h[0].status, 'FAIL');
  const csv = 'ACCOUNT_UID;CHECK_ID;STATUS;SEVERITY;RESOURCE_UID\n1;s3_x;PASS;low;b1\n1;s3_y;FAIL;medium;b2';
  const c = parseProwler(csv);
  assert.equal(c.length, 2);
  assert.equal(c[1].severity, 'medium');
});

test('fluid structure: convert page -> collection, merge collections, undo', async () => {
  const { store, orch, teamId } = await setup();
  const project = await findSys(store, teamId, 'project');
  const r = await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [
    { op: 'create_node', type: 'page', parent: project.id, title: 'CloudGoat 목록', ref: '$cg', content: '- [x] iam_enum_basics\n- [ ] lambda_privesc\n- [ ] sqs_flag_shop' },
    { op: 'convert_node', node: '$cg', to: 'collection' },
    { op: 'create_node', type: 'collection', parent: project.id, title: 'Issues', ref: '$is', fields: [{ name: '심각도', type: 'select', options: ['high', 'low'] }] },
    { op: 'upsert_item', collection: '$is', title: 'HF_TOKEN 빌드타임 임베딩', values: { 심각도: 'high' } },
    { op: 'merge_collections', from: '$is', into: '$cg', discriminator: '타입' },
    { op: 'create_view', collection: '$cg', view: { type: 'board', groupBy: '타입' } },
  ] });
  const cg = (await store.list('node', { teamId })).find((n) => n.title === 'CloudGoat 목록');
  assert.equal(cg.type, 'collection');
  const items = (await store.list('node', { parentId: cg.id })).filter((n) => !n.deleted);
  assert.equal(items.length, 4);
  const typeF = fieldByName(cg, '타입');
  assert.equal(items.find((i) => i.title.startsWith('HF_TOKEN')).props[typeF.id], 'Issues');
  assert.equal(items.find((i) => i.title === 'iam_enum_basics').props[fieldByName(cg, '완료').id], true);
  assert.ok(cg.views.some((v) => v.type === 'board' && v.config.groupBy === typeF.id));
  await orch.undo({ user: pm, oplogId: r.oplogId });
  assert.equal((await store.list('node', { teamId })).filter((n) => n.title === 'CloudGoat 목록').length, 0);
});

test('permissions: members cannot delete or create seasons', async () => {
  const { store, orch, teamId } = await setup();
  const project = await findSys(store, teamId, 'project');
  await assert.rejects(orch.applyDirect({ user: jh, teamId, ops: [{ op: 'delete_node', node: project.id }] }), /requires PM/);
  await assert.rejects(orch.applyDirect({ user: pm, teamId, ops: [{ op: 'create_season', sourceText: 'x' }] }), /requires admin/);
});

test('G8 heuristic fallback plans + applies without any LLM', async () => {
  const { store, orch, teamId } = await setup();
  const p = await orch.plan({ user: jh, teamId, text: '오늘 iam_privesc_by_rollback 풀었고 prowler로 rollback 문제 점검해봄. 컨테이너 개념도 좀 봄', now: NOW });
  assert.equal(p.status, 'planned');
  assert.equal(p.provider, 'rules');
  assert.ok(p.plan.diff.length >= 2);
  const before = (await store.list('node', { teamId })).length;
  assert.equal((await store.list('node', { teamId })).length, before, 'preview must not persist');
  const applied = await orch.apply({ user: jh, promptId: p.id, now: NOW });
  assert.equal(applied.status, 'applied');
  const act = await findSys(store, teamId, 'activity');
  const logs = (await store.list('node', { parentId: act.id })).filter((n) => !n.deleted);
  assert.ok(logs.length >= 2);
  assert.deepEqual(logs[0].props[fieldByName(act, '팀원').id], ['차정훈']);
  const w = await orch.plan({ user: pm, teamId, text: '2차 주간보고서 만들어줘', now: NOW });
  assert.equal(w.plan.ops[0].op, 'draft_weekly_report');
  assert.equal(w.plan.ops[0].round, 2);
});

test('BYO-AI: plan JSON from a personal AI is validated, previewed, applied', async () => {
  const { store, teamId } = await setup();
  const orch = new Orchestrator({ store, log: () => {} });
  const bad = await orch.plan({ user: pm, teamId, text: '```json\n{"summary":"x","ops":[{"op":"add_field","collection":"NoSuchCollection","field":{"name":"예상 시간","type":"number"}}]}\n```', now: NOW });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.provider, 'user-ai');
  assert.match(bad.error.message, /not found/);
  const good = await orch.plan({ user: pm, teamId, ops: [{ op: 'add_field', collection: '태스크', field: { name: '예상 시간', type: 'number' } }], summary: '태스크에 예상 시간', now: NOW });
  assert.equal(good.status, 'planned');
  assert.ok(good.plan.diff.some((d) => d.changes?.some((c) => c.includes('예상 시간'))));
  const tasks = await findSys(store, teamId, 'tasks');
  assert.ok(!fieldByName(await store.get('node', tasks.id), '예상 시간'), 'preview must not persist');
  await orch.apply({ user: pm, promptId: good.id, now: NOW });
  assert.ok(fieldByName(await store.get('node', tasks.id), '예상 시간'));
});

test('BYO-AI: Markdown round-trip edits properties, body, and keeps HTML reports', async () => {
  const { store, orch, teamId } = await setup();
  const col = await findSys(store, teamId, 'deliverables');
  const r1 = (await store.list('node', { parentId: col.id })).find((i) => i.title === '1차 주간보고서');
  await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [{ op: 'set_content', node: r1.id, content: [{ type: 'h2', text: '핵심 인사이트' }, { type: 'bullet', text: 'A' }, { type: 'html', id: 'b_rep', title: 'prowler.html', html: '<h1>scan</h1>' }] }] });
  const node = await store.get('node', r1.id);
  const md = nodeToMarkdown(node, { parent: col });
  const { meta } = splitFrontMatter(md);
  assert.equal(meta.id, r1.id);
  assert.equal(meta.properties['종류'], '주간보고');
  assert.match(md, /shapeshift:html id="b_rep"/);
  const edited = md.replace('상태: 시작 전', '상태: 진행 중').replace('- A', '- A\n- Prowler로 IAM 설정 오류 탐지 확인');
  const p = await orch.plan({ user: jh, teamId, text: edited, now: NOW });
  assert.equal(p.provider, 'markdown');
  assert.equal(p.status, 'planned', JSON.stringify(p.error));
  await orch.apply({ user: jh, promptId: p.id, now: NOW });
  const after = await store.get('node', r1.id);
  assert.equal(after.props[fieldByName(col, '상태').id], '진행 중');
  assert.ok(after.content.some((b) => b.text === 'Prowler로 IAM 설정 오류 탐지 확인'));
  const rep = after.content.find((b) => b.type === 'html');
  assert.equal(rep.id, 'b_rep');
  assert.equal(rep.html, '<h1>scan</h1>');
  const same = await orch.plan({ user: jh, teamId, markdown: nodeToMarkdown(after, { parent: col }), nodeId: after.id, now: NOW });
  assert.equal(same.status, 'answered', JSON.stringify(same.plan));
});

test('BYO-AI: collection Markdown table updates rows and adds new ones', async () => {
  const { store, orch, teamId } = await setup();
  const tasks = await findSys(store, teamId, 'tasks');
  await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [{ op: 'upsert_item', collection: tasks.id, title: 'Prowler 기능 분석', values: { 상태: '할 일', 담당: ['김성주'] } }] });
  const col = await store.get('node', tasks.id);
  const items = (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted);
  let md = nodeToMarkdown(col, { children: items });
  assert.match(md, /\| id \| 이름 \| 상태 \| 담당 \| 단계 \| 마감 \|/);
  md = md.replace(/(\| Prowler 기능 분석 \| )할 일/, '$1진행 중');
  md = md.trimEnd() + '\n|  | CloudGoat medium 2문제 | 할 일 | 김원준 | 2단계 | 2026-10-04 |\n';
  md = md.replace(/fields:\n/, 'fields:\n  예상 시간: number\n');
  const p = await orch.plan({ user: pm, teamId, markdown: md, nodeId: col.id, now: NOW });
  assert.equal(p.status, 'planned', JSON.stringify(p.error));
  await orch.apply({ user: pm, promptId: p.id, now: NOW });
  const col2 = await store.get('node', col.id);
  assert.ok(fieldByName(col2, '예상 시간'));
  const after = (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted);
  assert.equal(after.length, 2);
  assert.equal(after.find((i) => i.title === 'Prowler 기능 분석').props[fieldByName(col2, '상태').id], '진행 중');
  const nw = after.find((i) => i.title === 'CloudGoat medium 2문제');
  assert.deepEqual(nw.props[fieldByName(col2, '담당').id], ['김원준']);
  assert.equal(nw.props[fieldByName(col2, '마감').id], '2026-10-04');
});

test('G6 Notion import merges 산출물 and infers missing 종류/차수, flags duplicates', async () => {
  const { store, orch, teamId } = await setup();
  const pages = {
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { properties: { title: { type: 'title', title: [{ plain_text: 'DevSecOps CI/CD 파이프라인 통합 보안 스캐너' }] } } },
  };
  const children = {
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': [{ id: 'db1', type: 'child_database', child_database: { title: '산출물' }, has_children: false }, { id: 'db2', type: 'child_database', child_database: { title: '프로젝트 타임라인' }, has_children: false }],
    r1: [{ id: 'b1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '프로젝트 개요' }] } }, { id: 'b2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '팀 이름 : 컴공컴공컴공경영let’sgo' }] } }],
    r2: [], t1: [], t2: [], t3: [],
  };
  const dbs = {
    db1: { meta: { title: [{ plain_text: '산출물' }], properties: { 이름: { type: 'title' }, 종류: { type: 'select', select: { options: [{ name: '주간보고' }] } }, 상태: { type: 'status', status: { options: [{ name: '시작 전' }, { name: '완료' }] } }, 'D-day': { type: 'date' }, 단계: { type: 'select', select: { options: [] } } } },
      rows: [
        { id: 'r1', properties: { 이름: { type: 'title', title: [{ plain_text: '0차 주간보고서' }] }, 상태: { type: 'status', status: { name: '완료' } }, 'D-day': { type: 'date', date: { start: '2026-09-11' } }, 종류: { type: 'select', select: null } } },
        { id: 'r2', properties: { 이름: { type: 'title', title: [{ plain_text: '1주차 아티클' }] }, 상태: { type: 'status', status: null }, 'D-day': { type: 'date', date: null }, 종류: { type: 'select', select: null } } },
      ] },
    db2: { meta: { title: [{ plain_text: '프로젝트 타임라인' }], properties: { 이름: { type: 'title' }, 날짜: { type: 'date' } } },
      rows: [
        { id: 't1', properties: { 이름: { type: 'title', title: [{ plain_text: '주간 보고서 제출 (1)' }] }, 날짜: { type: 'date', date: { start: '2025-12-26' } } } },
        { id: 't2', properties: { 이름: { type: 'title', title: [{ plain_text: '주간 보고서 제출 (1)' }] }, 날짜: { type: 'date', date: { start: '2026-09-20' } } } },
        { id: 't3', properties: { 이름: { type: 'title', title: [{ plain_text: '킥오프' }] }, 날짜: { type: 'date', date: { start: '2026-08-31' } } } },
      ] },
  };
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace('/v1', '');
    let body = null;
    let m;
    if ((m = p.match(/^\/pages\/(.+)$/))) body = pages[m[1]];
    else if ((m = p.match(/^\/blocks\/(.+)\/children$/))) body = { results: children[m[1]] || [], has_more: false };
    else if ((m = p.match(/^\/databases\/(.+)\/query$/))) body = { results: dbs[m[1]].rows, has_more: false };
    else if ((m = p.match(/^\/databases\/(.+)$/))) body = dbs[m[1]].meta;
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body || { message: 'not found' }, headers: new Map() };
  };
  const { tree } = await fetchNotionTree('secret', 'https://www.notion.so/x/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { fetchImpl: fakeFetch, images: false });
  assert.equal(tree.children.length, 2);
  const res = await orch.applyDirect({ user: pm, teamId, now: NOW, ops: [{ op: 'import_tree', tree }] });
  assert.ok(res.notes.some((n) => n.includes('중복')), JSON.stringify(res.notes));
  assert.ok(res.notes.some((n) => n.includes('지난 연도')));
  const col = await findSys(store, teamId, 'deliverables');
  const items = (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted);
  const zero = items.find((i) => i.title === '0차 주간보고서');
  assert.equal(zero.props[fieldByName(col, '종류').id], '주간보고');
  assert.equal(zero.props[fieldByName(col, '차수').id], 0);
  assert.equal(zero.props[fieldByName(col, '상태').id], '완료');
  const art = items.filter((i) => i.title === '1주차 아티클');
  assert.equal(art.length, 1, 'merged into the existing slot');
  assert.equal(art[0].props[fieldByName(col, '차수').id], 1);
});

test('secret masking + html conversion basics', () => {
  const m = maskSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB and password: hunter22');
  assert.ok(!m.text.includes('ghp_abc'));
  assert.ok(m.text.includes('password: [MASKED:password]'));
  const b = htmlToBlocks('<ol><li>하나</li><li>둘<ul><li>셋</li></ul></li></ol><p>a &amp; b</p>');
  assert.equal(b[0].type, 'number');
  assert.equal(b.find((x) => x.text === '셋').indent, 1);
  assert.equal(b.at(-1).text, 'a & b');
});
