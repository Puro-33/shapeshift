import { html, render, useState, useEffect, useRef, useMemo } from './lib/preact-htm.js';
import { AppCtx, Spinner } from './components/common.js';
import { PromptBar, PlanCard } from './components/prompt.js';
import { AuthScreen, Onboarding, Home, NodePage } from './components/pages.js';
import { Inbox, Activity, Settings, Admin } from './components/manage.js';
import { get, post, ApiError } from './lib/api.js';
import { kstToday } from './lib/util.js';

function parseRoute() {
  const h = location.hash.replace(/^#/, '').split('?')[0] || '/';
  let m;
  if ((m = h.match(/^\/t\/([^/]+)\/n\/([^/]+)/))) return { name: 'node', teamId: m[1], nodeId: m[2] };
  if ((m = h.match(/^\/t\/([^/]+)\/(inbox|activity|settings)/))) return { name: m[2], teamId: m[1] };
  if ((m = h.match(/^\/t\/([^/]+)/))) return { name: 'home', teamId: m[1] };
  if (h.startsWith('/admin')) return { name: 'admin' };
  if (h.startsWith('/new')) return { name: 'new' };
  if (h.startsWith('/login')) return { name: 'login' };
  return { name: 'root' };
}

function Tree({ nodes, teamId, activeId, go }) {
  const [open, setOpen] = useState({});
  const kids = useMemo(() => {
    const m = {};
    for (const n of nodes) (m[n.parentId || 'root'] ||= []).push(n);
    for (const k in m) m[k].sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
    return m;
  }, [nodes]);
  const row = (n, depth) => {
    const ch = kids[n.id] || [];
    const isOpen = open[n.id] ?? depth === 0;
    return html`<div key=${n.id}>
      <a class="nav ${activeId === n.id ? 'active' : ''}" style=${`padding-left:${8 + depth * 14}px`} href=${`#/t/${teamId}/n/${n.id}`} data-node-id=${n.id} data-node-type=${n.type} aria-current=${activeId === n.id ? 'page' : null}>
        <span class="caret" role="button" aria-label=${isOpen ? '접기' : '펼치기'} onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setOpen({ ...open, [n.id]: !isOpen }); }}>${ch.length ? (isOpen ? '▾' : '▸') : ''}</span>
        <span class="ic">${n.icon || (n.type === 'collection' ? '🗂' : '📄')}</span><span style="overflow:hidden;text-overflow:ellipsis">${n.title}</span>
      </a>
      ${isOpen ? ch.map((c) => row(c, depth + 1)) : null}
    </div>`;
  };
  return html`<div>${(kids.root || []).map((n) => row(n, 0))}</div>`;
}

function Search({ teamId, go }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const t = useRef();
  useEffect(() => {
    clearTimeout(t.current);
    if (!q.trim()) { setRes(null); return; }
    t.current = setTimeout(async () => { try { setRes((await get(`/api/search?teamId=${teamId}&q=${encodeURIComponent(q)}`)).results); } catch { setRes([]); } }, 250);
  }, [q]);
  return html`<div style="position:relative;margin-top:8px">
    <input class="input" placeholder="🔍 검색" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Escape' && setQ('')} />
    ${res ? html`<div class="card" style="position:absolute;z-index:30;left:0;right:0;top:36px;padding:4px;max-height:360px;overflow:auto">
      ${res.length ? res.map((r) => html`<div class="nav" style="white-space:normal" onClick=${() => { setQ(''); go(`#/t/${teamId}/n/${r.id}`); }}><div><div>${r.title}</div>${r.snippet ? html`<div class="small faint">${r.snippet}</div>` : null}</div></div>`) : html`<div class="small faint" style="padding:6px">결과 없음</div>`}
    </div>` : null}
  </div>`;
}

function App() {
  const [route, setRoute] = useState(parseRoute());
  const [me, setMe] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [node, setNode] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toastMsg, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [menu, setMenu] = useState(false);
  const promptApi = useRef({});
  const toastTimer = useRef();

  useEffect(() => { const f = () => { setRoute(parseRoute()); setMenu(false); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const reloadMe = async () => { const m = await get('/api/me'); setMe(m); return m; };
  useEffect(() => { reloadMe().catch(() => setMe({ user: null, error: true })); }, []);

  const teamId = route.teamId || null;
  const reloadTeam = async () => { if (!teamId) { setTeamData(null); return; } try { setTeamData(await get(`/api/teams/${teamId}`)); } catch (e) { toast(e.message, true); } };
  useEffect(() => { setTeamData(null); reloadTeam(); }, [teamId]);

  const toast = (msg, bad = false) => { clearTimeout(toastTimer.current); setToast({ msg, bad }); toastTimer.current = setTimeout(() => setToast(null), bad ? 6000 : 3000); };
  const go = (h) => { if (location.hash !== h) location.hash = h; else setRoute(parseRoute()); };
  const bump = () => setRefreshKey((k) => k + 1);

  const currentRound = useMemo(() => {
    const w = (teamData?.season?.milestones || []).filter((m) => m.kind === 'weekly' && m.due).sort((a, b) => a.round - b.round);
    const today = kstToday();
    return (w.find((m) => m.due >= today) || w.at(-1))?.round ?? null;
  }, [teamData?.season]);

  const runOps = async (ops, summary, tid = teamId, { quiet = false } = {}) => {
    try {
      const r = await post('/api/ops', { teamId: tid, ops, summary });
      if (!quiet) { toast(`${summary} ✓`); }
      if (ops.some((o) => ['create_node', 'create_team', 'add_field', 'create_view', 'convert_node', 'merge_collections', 'delete_node', 'update_node'].includes(o.op))) reloadTeam();
      return r;
    } catch (e) { toast(e.message, true); throw e; }
  };

  const submitPrompt = async (text, attachment = null) => {
    setBusy(true);
    setPlan({ pending: true, text });
    try {
      const p = await post('/api/prompts', { teamId, text, attachment, selection: node ? { nodeId: node.id } : null });
      setPlan(p);
      if (p.status === 'applied') { toast('바로 적용했어요 (자동 적용 모드)'); bump(); reloadTeam(); }
    } catch (e) {
      setPlan({ status: 'failed', text, error: { message: e.message }, plan: {} });
    } finally { setBusy(false); }
  };
  const applyPrompt = async (p) => {
    try {
      const r = await post(`/api/prompts/${p.id}/apply`);
      setPlan(r);
      toast('적용했어요');
      await reloadTeam();
      if (!teamId && r.created?.length) { const m = await reloadMe(); if (m.teams?.length) go(`#/t/${m.teams.at(-1).id}`); }
      bump();
      const target = (r.results || []).find((x) => x.op === 'draft_weekly_report' || x.op === 'ingest_content' || x.op === 'create_team');
      if (target?.teamId) go(`#/t/${target.teamId}`);
      else if (target?.id && teamId) go(`#/t/${teamId}/n/${target.id}`);
    } catch (e) { toast(e.message, true); }
  };
  const dismissPrompt = async (p) => { await post(`/api/prompts/${p.id}/dismiss`); bump(); };
  const undo = async (oplogId, force = false) => {
    try {
      await post(`/api/oplog/${oplogId}/undo`, { force });
      toast('되돌렸어요');
      setPlan((p) => (p && p.oplogId === oplogId ? { ...p, status: 'reverted' } : p));
      await reloadTeam(); bump();
    } catch (e) {
      if (e instanceof ApiError && e.data?.conflicts && confirm(`${e.message}\n그래도 되돌릴까요? (이후 수정 내용이 사라져요)`)) return undo(oplogId, true);
      toast(e.message, true);
    }
  };

  const app = {
    me, reloadMe, teamId, teamData, reloadTeam, route, go, node, setNode, refreshKey, bump, toast, busy, plan, currentRound,
    showPlan: setPlan, submitPrompt, applyPrompt, dismissPrompt, undo, runOps, promptApi,
    setPromptText: (t) => promptApi.current.set?.(t),
  };

  if (!me) return html`<div class="boot"><div><${Spinner} /> 불러오는 중… <small>(무료 서버가 잠들어 있었다면 최대 1분 걸려요)</small></div></div>`;
  if (!me.user) return html`<${AuthScreen} onDone=${async () => { const m = await reloadMe(); go(m.teams?.length ? `#/t/${m.teams[0].id}` : '#/'); }} />`;
  if (route.name === 'root' || route.name === 'login') {
    if (me.teams?.length) { setTimeout(() => go(`#/t/${me.teams[0].id}`)); return null; }
  }

  let view;
  if (route.name === 'node') view = html`<${NodePage} id=${route.nodeId} />`;
  else if (route.name === 'home') view = html`<${Home} />`;
  else if (route.name === 'inbox') view = html`<${Inbox} />`;
  else if (route.name === 'activity') view = html`<${Activity} />`;
  else if (route.name === 'settings') view = html`<${Settings} />`;
  else if (route.name === 'admin') view = me.user.isAdmin ? html`<${Admin} />` : html`<div class="err">운영진만 볼 수 있어요</div>`;
  else view = html`<${Onboarding} />`;

  const td = teamData;
  const crumbs = [];
  if (td && route.name !== 'home') crumbs.push(html`<a href=${`#/t/${teamId}`}>${td.team.name}</a>`);
  const pending = td ? undefined : null;

  const logout = async () => { await post('/api/auth/logout'); setMe({ user: null }); go('#/login'); };
  return html`<${AppCtx.Provider} value=${app}>
    <div class="shell ${menu ? 'menu' : ''}">
      <aside class="side">
        <div class="side-head">
          <div class="brand"><img src="/favicon.svg" alt="" /> Shapeshift</div>
          <select class="team-switch" value=${teamId || ''} onChange=${(e) => go(e.target.value === '__new' ? '#/new' : `#/t/${e.target.value}`)}>
            ${!teamId ? html`<option value="">팀 선택</option>` : null}
            ${(me.teams || []).map((t) => html`<option value=${t.id}>${t.name}</option>`)}
            <option value="__new">+ 새 팀 / 참여</option>
          </select>
          ${teamId ? html`<${Search} teamId=${teamId} go=${go} />` : null}
        </div>
        <div class="side-scroll">
          ${teamId ? html`
            <nav aria-label="팀 메뉴">
            <a class="nav ${route.name === 'home' ? 'active' : ''}" href=${`#/t/${teamId}`}><span class="ic">🏠</span>홈</a>
            <a class="nav ${route.name === 'inbox' ? 'active' : ''}" href=${`#/t/${teamId}/inbox`}><span class="ic">📥</span>인박스${td?.requests?.length ? html`<span class="cnt">${td.requests.length}</span>` : null}</a>
            <a class="nav ${route.name === 'activity' ? 'active' : ''}" href=${`#/t/${teamId}/activity`}><span class="ic">↺</span>변경 기록</a>
            <a class="nav ${route.name === 'settings' ? 'active' : ''}" href=${`#/t/${teamId}/settings`}><span class="ic">⚙️</span>팀 설정</a>
            <a class="nav" href=${`/t/${teamId}`} target="_blank" rel="noopener"><span class="ic">🔍</span>AI용 보기</a>
            </nav>
            <nav class="side-sec" aria-label="워크스페이스"><div class="side-label">워크스페이스</div>
              ${td ? html`<${Tree} nodes=${td.nodes} teamId=${teamId} activeId=${route.nodeId} go=${go} />` : html`<div style="padding:8px"><${Spinner} /></div>`}
            </nav>` : null}
          ${me.user.isAdmin ? html`<div class="side-sec"><div class="side-label">운영</div><a class="nav ${route.name === 'admin' ? 'active' : ''}" href="#/admin"><span class="ic">🛡️</span>운영진 대시보드</a></div>` : null}
        </div>
        <div class="side-foot"><span class="grow">${me.user.name}${me.user.isAdmin ? ' · 운영진' : td?.role === 'pm' ? ' · PM' : ''}</span>
          <a class="small" href="/agent" target="_blank" rel="noopener" title="내장 AI 없음. 개인 AI가 읽고 편집하는 방법">🤖 내 AI 연결</a>
          <button class="btn sm ghost" onClick=${logout}>로그아웃</button></div>
      </aside>
      <main class="main">
        <div class="topbar">
          <button class="btn sm ghost" style="display:none" id="menu-btn" onClick=${() => setMenu(!menu)}>☰</button>
          <div class="crumbs">${crumbs}${route.name === 'node' && node ? html`<span>›</span><span>${node.title}</span>` : null}${route.name !== 'node' && route.name !== 'home' ? html`<span>›</span><span>${{ inbox: '인박스', activity: '변경 기록', settings: '팀 설정', admin: '운영진', new: '시작하기' }[route.name] || ''}</span>` : null}</div>
          <span class="spacer"></span>
          ${td?.season && currentRound ? html`<span class="pill">${td.season.name} · ${currentRound}차</span>` : null}
        </div>
        <div class="content">${view}</div>
        ${route.name !== 'admin' ? html`<${PromptBar} />` : null}
        ${plan ? html`<${PlanCard} prompt=${plan} onClose=${() => setPlan(null)} />` : null}
      </main>
    </div>
    ${toastMsg ? html`<div class="toast ${toastMsg.bad ? 'bad' : ''}">${toastMsg.msg}</div>` : null}
  <//>`;
}

render(html`<${App} />`, document.getElementById('app'));
