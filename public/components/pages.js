import { html, useState, useEffect } from '../lib/preact-htm.js';
import { useApp, useAsync, Spinner, FieldInput, Tag } from './common.js';
import { BlockEditor } from './editor.js';
import { CollectionView } from './collection.js';
import { get, post } from '../lib/api.js';
import { dday, mdLabel, kstToday, timeAgo, downloadText } from '../lib/util.js';

// ---- auth ---------------------------------------------------------------
export function AuthScreen({ onDone }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ email: '', password: '', name: '', inviteCode: new URLSearchParams(location.hash.split('?')[1] || '').get('invite') || '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (f.inviteCode) setMode('register'); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', f);
      onDone();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<div class="auth"><form class="card col" onSubmit=${submit}>
    <div class="brand"><img src="/favicon.svg" alt="" /> Shapeshift</div>
    <h2>${mode === 'login' ? '로그인' : '가입하기'}</h2>
    <div class="subtle small mb">각자의 AI가 읽고 편집하기 쉬운 팀 프로젝트 워크스페이스</div>
    ${mode === 'register' ? html`<div><label class="lbl" for="f-name">이름 (팀원 목록과 같은 이름)</label><input id="f-name" name="name" class="input" autocomplete="name" value=${f.name} onInput=${set('name')} required /></div>` : null}
    <div><label class="lbl" for="f-email">이메일</label><input id="f-email" name="email" class="input" type="email" autocomplete="email" value=${f.email} onInput=${set('email')} required /></div>
    <div><label class="lbl" for="f-password">비밀번호 ${mode === 'register' ? '(8자 이상)' : ''}</label><input id="f-password" name="password" class="input" type="password" autocomplete=${mode === 'login' ? 'current-password' : 'new-password'} value=${f.password} onInput=${set('password')} required /></div>
    ${mode === 'register' ? html`<div><label class="lbl" for="f-invite">초대 코드 (선택)</label><input id="f-invite" name="inviteCode" class="input" value=${f.inviteCode} onInput=${set('inviteCode')} /></div>` : null}
    ${err ? html`<div class="err">${err}</div>` : null}
    <button class="btn primary" disabled=${busy}>${busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입'}</button>
    <div class="small subtle">${mode === 'login' ? html`계정이 없나요? <a href="#" onClick=${(e) => { e.preventDefault(); setMode('register'); }}>가입하기</a>` : html`이미 계정이 있나요? <a href="#" onClick=${(e) => { e.preventDefault(); setMode('login'); }}>로그인</a>`}</div>
  </form></div>`;
}

// ---- onboarding (no team yet) ------------------------------------------
export function Onboarding() {
  const app = useApp();
  const [f, setF] = useState({ name: '', project: '', topic: '', members: '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!f.name.trim()) return app.toast('팀명을 입력해 주세요', true);
    setBusy(true);
    try {
      const members = f.members.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map((m) => ({ name: m.replace(/\(PM\)/i, ''), role: /\(PM\)/i.test(m) ? 'pm' : 'member' }));
      const r = await app.runOps([{ op: 'create_team', name: f.name.trim(), project: f.project.trim() || f.name.trim(), topic: f.topic.trim() || f.project.trim(), members }], '팀 만들기', null);
      await app.reloadMe();
      app.go(`#/t/${r.teamId || r.results?.[0]?.teamId}`);
    } catch (e) { app.toast(e.message, true); } finally { setBusy(false); }
  };
  const join = async () => {
    try { const r = await post('/api/invites/join', { code }); await app.reloadMe(); app.go(`#/t/${r.teamId}`); } catch (e) { app.toast(e.message, true); }
  };
  return html`<div class="page-w">
    <h1 class="title">시작하기 👋</h1>
    <p class="subtle">팀을 만들면 산출물(주간보고서/아티클 마감 슬롯), 활동 로그, 태스크 구조가 자동으로 생겨요. 이후엔 빠른 명령이나 각자의 AI로 자유롭게 바꾸면 돼요.</p>
    <div class="grid2 mt">
      <div class="card col">
        <h3>새 팀 만들기</h3>
        <div><label class="lbl">팀명</label><input class="input" value=${f.name} onInput=${set('name')} placeholder="컴공컴공컴공경영let'sgo" /></div>
        <div><label class="lbl">프로젝트명</label><input class="input" value=${f.project} onInput=${set('project')} placeholder="DevSecOps CI/CD 파이프라인 통합 보안 스캐너" /></div>
        <div><label class="lbl">주제</label><input class="input" value=${f.topic} onInput=${set('topic')} placeholder="DevSecOps" /></div>
        <div><label class="lbl">팀원 (쉼표 구분, PM은 이름(PM))</label><input class="input" value=${f.members} onInput=${set('members')} placeholder="김성주(PM), 김원준, 변정현, 차정훈" /></div>
        <button class="btn primary" disabled=${busy} onClick=${create}>${busy ? '만드는 중…' : '팀 만들기'}</button>
      </div>
      <div class="col">
        <div class="card col"><h3>초대 코드로 참여</h3><input class="input" value=${code} onInput=${(e) => setCode(e.target.value)} placeholder="PM에게 받은 코드" /><button class="btn" onClick=${join}>참여</button></div>
        ${app.me?.user?.isAdmin ? html`<div class="card"><h3>운영진</h3><p class="small subtle">먼저 운영 안내문으로 시즌(제출 일정·규칙)을 만들어 두면, 팀을 만들 때 마감 슬롯이 자동으로 채워져요.</p><a class="btn" href="#/admin">시즌 설정으로 이동</a></div>` : null}
      </div>
    </div>
  </div>`;
}

// ---- team home ------------------------------------------------------------
export function Home() {
  const app = useApp();
  const td = app.teamData;
  const deliv = td?.nodes?.find((n) => n.sys === 'deliverables');
  const act = td?.nodes?.find((n) => n.sys === 'activity');
  const { data, loading, reload } = useAsync(async () => {
    const [d, a, prompts] = await Promise.all([
      deliv ? get(`/api/nodes/${deliv.id}`) : null,
      act ? get(`/api/nodes/${act.id}`) : null,
      get(`/api/prompts?teamId=${app.teamId}&status=planned`),
    ]);
    return { d, a, prompts: prompts.prompts };
  }, [app.teamId, app.refreshKey, deliv?.id, act?.id]);
  if (!td) return html`<${Spinner} />`;
  const f = (col, name) => col?.fields?.find((x) => x.name === name);
  const items = data?.d?.children || [];
  const fDue = f(deliv, 'D-day'); const fSt = f(deliv, '상태'); const fKind = f(deliv, '종류'); const fRound = f(deliv, '차수');
  const today = kstToday();
  const upcoming = items.filter((it) => it.props?.[fDue?.id] && it.props[fDue.id] >= today && it.props?.[fSt?.id] !== '완료').sort((a, b) => a.props[fDue.id].localeCompare(b.props[fDue.id])).slice(0, 4);
  const overdue = items.filter((it) => it.props?.[fDue?.id] && it.props[fDue.id] < today && it.props?.[fSt?.id] !== '완료');
  const round = app.currentRound;
  const report = items.find((it) => it.props?.[fKind?.id] === '주간보고' && it.props?.[fRound?.id] === round);
  const fDate = f(act, '날짜'); const fWho = f(act, '팀원');
  const recent = (data?.a?.children || []).slice().sort((a, b) => String(b.props?.[fDate?.id] || '').localeCompare(String(a.props?.[fDate?.id] || ''))).slice(0, 8);
  return html`<div class="page-w" style="max-width:1080px">
    <div class="row"><h1 class="title grow">${td.team.projectTitle}</h1></div>
    <div class="subtle">${td.team.name} · ${td.team.members.map((m) => (m.role === 'pm' ? `${m.name}(PM)` : m.name)).join(', ')}${td.season ? ` · ${td.season.name}` : ''}</div>
    ${!td.season ? html`<div class="note mt">아직 시즌(제출 일정)이 없어요. 운영진이 시즌을 만들면 마감 슬롯이 자동으로 생겨요.${app.me?.user?.isAdmin ? html` <a href="#/admin">시즌 만들기</a>` : ''}</div>` : null}
    <div class="grid3 mt">
      <div class="card">
        <h3>이번 차수 ${round ? `(${round}차)` : ''}</h3>
        ${report ? html`<div class="col">
          <a href=${`#/t/${app.teamId}/n/${report.id}`} style="font-weight:600">${report.title}</a>
          <div class="row"><${Tag} field=${fSt} value=${report.props?.[fSt.id] || '시작 전'} /><span class="small">${mdLabel(report.props?.[fDue.id])} 23:59 · <b>${dday(report.props?.[fDue.id])}</b></span></div>
          <button class="btn primary sm" style="align-self:flex-start" onClick=${() => app.submitPrompt(`${round}차 주간보고서 초안 만들어줘`)}>✨ 활동 로그로 초안 만들기</button>
        </div>` : html`<div class="small subtle">표시할 보고서 슬롯이 없어요</div>`}
      </div>
      <div class="card">
        <h3>다가오는 마감</h3>
        ${upcoming.length ? upcoming.map((it) => html`<div class="row small" style="padding:3px 0"><span class="grow"><a href=${`#/t/${app.teamId}/n/${it.id}`}>${it.title}</a></span><b>${dday(it.props[fDue.id])}</b></div>`) : html`<div class="small subtle">없음</div>`}
        ${overdue.length ? html`<div class="small badge-bad mt">⚠ 마감 지난 미완료 ${overdue.length}건</div>` : null}
      </div>
      <div class="card">
        <h3>입력 요청 · 인박스</h3>
        ${(td.requests || []).slice(0, 4).map((r) => html`<div class="small" style="padding:3px 0">📝 ${r.assignee ? html`<b>${r.assignee}</b> ` : ''}${r.text}</div>`)}
        ${data?.prompts?.length ? html`<a class="small" href=${`#/t/${app.teamId}/inbox`}>검토 대기 계획 ${data.prompts.length}건 →</a>` : null}
        ${!(td.requests || []).length && !data?.prompts?.length ? html`<div class="small subtle">처리할 일이 없어요 🎉</div>` : null}
      </div>
    </div>
    <div class="grid2 mt">
      <div class="card">
        <div class="row"><h3 class="grow">최근 활동</h3>${act ? html`<a class="small" href=${`#/t/${app.teamId}/n/${act.id}`}>전체 보기</a>` : null}</div>
        ${loading ? html`<${Spinner} />` : recent.length ? recent.map((it) => html`<div class="row small" style="padding:4px 0;border-bottom:1px solid var(--line2)"><span class="faint" style="width:64px">${mdLabel(it.props?.[fDate?.id])}</span><span class="grow">${it.title}</span><span class="subtle">${(it.props?.[fWho?.id] || []).join(', ')}</span></div>`) : html`<div class="small subtle">아직 활동 기록이 없어요. 아래 프롬프트에 "오늘 ○○ 했어"라고 적어 보세요.</div>`}
      </div>
      <div class="card">
        <h3>구조</h3>
        ${(td.nodes || []).filter((n) => n.parentId && n.type === 'collection').map((n) => html`<a class="nav" href=${`#/t/${app.teamId}/n/${n.id}`}><span class="ic">${n.icon || '🗂'}</span>${n.title}<span class="small faint" style="margin-left:auto">${(n.fields || []).length}개 필드 · ${(n.views || []).length}개 뷰</span></a>`)}
        <div class="small subtle mt">구조를 크게 바꾸고 싶으면 "🤖 내 AI에게"로 요청하세요. 예: "CloudGoat 시나리오 DB 만들어줘. 난이도, 풀이자, Root Cause, Prowler Coverage 필드 넣어서"</div>
      </div>
    </div>
  </div>`;
}

// ---- node page --------------------------------------------------------------
function RulePanel({ validation, node, onFix }) {
  if (!validation) return null;
  const icon = (c) => (c.passed ? '✅' : c.level === 'info' ? 'ℹ️' : c.level === 'warn' ? '⚠️' : '❌');
  return html`<aside class="rules"><div class="card">
    <h3>규칙 검증 ${validation.passed ? html`<span class="badge-ok small">통과</span>` : html`<span class="badge-bad small">오류 ${validation.errors} · 경고 ${validation.warnings}</span>`}</h3>
    ${validation.checks.map((c) => html`<div class="rule"><span class="mark">${icon(c)}</span><div class="grow"><div>${c.label}</div><div class="d">${c.detail}</div>
      ${c.fix?.title ? html`<button class="btn sm mt" onClick=${() => onFix({ title: c.fix.title })}>제목 고치기</button>` : null}</div></div>`)}
    ${validation.filename ? html`<div class="small subtle mt">제출 파일명: <code>${validation.filename}</code></div>` : null}
  </div></aside>`;
}

export function NodePage({ id }) {
  const app = useApp();
  const { data, loading, error, reload } = useAsync(() => get(`/api/nodes/${id}`), [id, app.refreshKey]);
  useEffect(() => { app.setNode(data?.node || null); return () => app.setNode(null); }, [data?.node?.id, data?.node?.type]);
  if (loading && !data) return html`<div class="page-w"><${Spinner} /></div>`;
  if (error) return html`<div class="page-w err">${error.message}</div>`;
  const { node, children, parentFields, validation } = data;
  const members = (app.teamData?.team?.members || []).map((m) => m.name);
  const saveContent = async (blocks) => { await app.runOps([{ op: 'set_content', node: node.id, content: blocks }], `${node.title} 본문 편집`, undefined, { quiet: true }); reload(); };
  const rename = async (title) => { if (title && title !== node.title) { await app.runOps([{ op: 'update_node', node: node.id, title }], '제목 변경'); app.reloadTeam(); reload(); } };
  const exportHtml = async () => {
    const res = await fetch(`/api/export/${node.id}`, { credentials: 'same-origin' });
    if (!res.ok) return app.toast('내보내기 실패', true);
    const cd = res.headers.get('content-disposition') || '';
    const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || `${node.title}.html`);
    downloadText(name, await res.text());
    app.toast(`${name} 다운로드`);
  };
  const markDone = async () => {
    await app.runOps([{ op: 'update_node', node: node.id, values: { 상태: '완료', 제출일: kstToday() } }], `${node.title} 완료 처리`);
    reload();
  };
  const title = html`<h1 class="title">${node.icon ? html`<span style="margin-right:8px">${node.icon}</span>` : null}<span contenteditable="true" style="outline:none" onBlur=${(e) => rename(e.currentTarget.innerText.trim())} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}>${node.title}</span></h1>`;

  const aiLinks = html`<span class="row small" style="gap:10px"><a href=${`/p/${node.id}`} target="_blank" rel="noopener" title="JS 없이 읽히는 시맨틱 HTML + 편집 폼">🔍 AI용 보기</a><a href=${`/p/${node.id}.md`} target="_blank" rel="noopener">Markdown</a><a href="#" onClick=${(e) => { e.preventDefault(); app.promptApi.current.myAi?.(''); }}>🤖 내 AI에게 맡기기</a></span>`;
  if (node.type === 'collection') {
    return html`<div style="max-width:1400px;margin:0 auto" data-node-id=${node.id} data-node-type="collection">
      ${aiLinks}
      ${title}
      ${node.content?.length ? html`<div class="subtle small">${node.content.map((b) => b.text).filter(Boolean).join(' ')}</div>` : null}
      <${CollectionView} col=${node} items=${children} onChanged=${() => { reload(); app.reloadTeam(); }} />
    </div>`;
  }

  const actions = html`<div class="row mb">
    ${validation ? html`<button class="btn sm" onClick=${exportHtml}>⬇ HTML 내보내기</button><button class="btn sm" onClick=${() => window.print()}>🖨 PDF</button>` : null}
    ${validation && node.props && parentFields?.some((f) => f.name === '상태') ? html`<button class="btn sm" onClick=${markDone}>✔ 제출 완료로 표시</button>` : null}
    ${validation?.kind === 'weekly_report' ? html`<button class="btn sm primary" onClick=${() => app.submitPrompt(`${node.title} 초안을 활동 로그 기준으로 다시 만들어줘`)}>✨ 다시 생성</button>` : null}
  </div>`;
  const body = html`<div data-node-id=${node.id} data-node-type=${node.type}>
    ${aiLinks}
    ${title}
    ${parentFields ? html`<div class="props">${parentFields.map((f) => html`<div class="k">${f.name}</div><div class="v"><${FieldInput} field=${f} value=${node.props?.[f.id]} members=${members} onChange=${async (v) => { await app.runOps([{ op: 'update_node', node: node.id, values: { [f.name]: v } }], `${f.name} 변경`); reload(); }} /></div>`)}</div>` : null}
    ${actions}
    <${BlockEditor} key=${node.id} nodeId=${node.id} blocks=${node.content} onChange=${saveContent} />
    ${children?.length ? html`<div class="mt2"><div class="side-label">하위 페이지</div>${children.map((c) => html`<div class="nav" onClick=${() => app.go(`#/t/${app.teamId}/n/${c.id}`)}><span class="ic">${c.icon || (c.type === 'collection' ? '🗂' : '📄')}</span>${c.title}</div>`)}</div>` : null}
  </div>`;
  if (validation) return html`<div class="split"><div>${body}</div><${RulePanel} validation=${validation} node=${node} onFix=${async (p) => { await rename(p.title); }} /></div>`;
  return html`<div class="page-w">${body}</div>`;
}
