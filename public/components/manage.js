import { html, useState } from '../lib/preact-htm.js';
import { useApp, useAsync, Spinner, Modal } from './common.js';
import { get, post, patch, del } from '../lib/api.js';
import { timeAgo, dday, kstToday } from '../lib/util.js';

const STATUS = { planned: '검토 대기', applied: '적용됨', failed: '실패', answered: '답변', reverted: '되돌림', dismissed: '취소됨' };

export function Inbox() {
  const app = useApp();
  const { data, loading, reload } = useAsync(() => get(`/api/prompts?teamId=${app.teamId}`), [app.teamId, app.refreshKey]);
  const reqs = app.teamData?.requests || [];
  const pending = (data?.prompts || []).filter((p) => p.status === 'planned');
  const done = async (r) => { await post(`/api/requests/${r.id}/done`); app.reloadTeam(); };
  return html`<div class="page-w">
    <h1 class="title">인박스</h1>
    <p class="subtle">개인 AI나 폼으로 제출됐지만 아직 적용하지 않은 계획과, 사람만 채울 수 있는 입력 요청이에요.</p>
    <h3 class="mt2">검토 대기 계획</h3>
    ${loading ? html`<${Spinner} />` : pending.length ? pending.map((p) => html`<div class="card mb row">
      <div class="grow"><div style="font-weight:600">${p.plan?.summary || p.text}</div><div class="small subtle">${{ 'user-ai': '내 AI JSON · ', markdown: '내 AI Markdown · ', rules: '빠른 명령 · ' }[p.provider] || ''}${(p.plan?.diff || []).length}개 변경 · ${timeAgo(p.createdAt)}</div></div>
      <button class="btn sm" onClick=${() => app.showPlan(p)}>검토</button>
    </div>`) : html`<div class="empty">대기 중인 계획이 없어요</div>`}
    <h3 class="mt2">입력 요청</h3>
    ${reqs.length ? reqs.map((r) => html`<div class="card mb row"><div class="grow">📝 ${r.assignee ? html`<b>${r.assignee}</b> · ` : ''}${r.text}</div>
      ${r.nodeId ? html`<a class="btn sm" href=${`#/t/${app.teamId}/n/${r.nodeId}`}>열기</a>` : null}<button class="btn sm" onClick=${() => done(r)}>완료</button></div>`) : html`<div class="empty">요청이 없어요</div>`}
    <h3 class="mt2">최근 프롬프트</h3>
    ${(data?.prompts || []).filter((p) => p.status !== 'planned').slice(0, 20).map((p) => html`<div class="row small" style="padding:5px 0;border-bottom:1px solid var(--line2)">
      <span class="pill">${STATUS[p.status] || p.status}</span><span class="grow" style="cursor:pointer" onClick=${() => app.showPlan(p)}>${p.plan?.summary || p.text}</span><span class="faint">${p.provider} · ${timeAgo(p.createdAt)}</span></div>`)}
  </div>`;
}

export function Activity() {
  const app = useApp();
  const { data, loading, reload } = useAsync(() => get(`/api/oplog?teamId=${app.teamId}`), [app.teamId, app.refreshKey]);
  const undo = async (e) => { await app.undo(e.id); reload(); };
  return html`<div class="page-w">
    <h1 class="title">변경 기록</h1>
    <p class="subtle">AI든 사람이든 모든 변경은 여기에 남고, 한 번에 되돌릴 수 있어요.</p>
    ${loading ? html`<${Spinner} />` : (data?.entries || []).map((e) => html`<div class="card mb">
      <div class="row"><div class="grow"><b>${e.summary || '변경'}</b> ${e.manual ? html`<span class="tag">직접 편집</span>` : html`<span class="tag c0">프롬프트</span>`} ${e.revertedAt ? html`<span class="tag c2">되돌림</span>` : null}</div>
        <span class="small faint">${e.userName || ''} · ${timeAgo(e.createdAt)}</span>
        ${!e.revertedAt ? html`<button class="btn sm" onClick=${() => undo(e)}>되돌리기</button>` : null}</div>
      <div class="small subtle" style="margin-top:4px">${(e.diff || []).slice(0, 6).map((d) => `${{ create: '+', update: '~', delete: '-' }[d.action]} ${d.title}`).join('  ·  ')}${(e.diff || []).length > 6 ? ` 외 ${e.diff.length - 6}` : ''}</div>
    </div>`)}
  </div>`;
}

function PersonalAi() {
  const app = useApp();
  const list = useAsync(() => get('/api/tokens/personal'), []);
  const [tok, setTok] = useState(null);
  const origin = location.origin;
  const mcpJson = JSON.stringify({ mcpServers: { shapeshift: { type: 'http', url: `${origin}/mcp`, headers: { Authorization: `Bearer ${tok || 'ss_...'}` } } } }, null, 2);
  return html`<div class="card mt col" id="personal-ai">
    <h3>🤖 개인 AI 연결</h3>
    <div class="small subtle">Shapeshift에는 내장 AI가 없어요. 각자 쓰는 AI가 읽고 편집해요. 모든 변경은 미리보기를 거치고, 변경 기록에서 되돌릴 수 있어요.</div>
    <div class="grid3">
      <div><b>AI 브라우저 (Aside 등)</b><div class="small subtle">로그인된 브라우저에서 <a href=${`/t/${app.teamId}`} target="_blank">AI용 보기</a>를 열고 요청하면 돼요. 페이지마다 Markdown 편집 폼과 JSON 폼이 있어요.</div></div>
      <div><b>채팅 AI (ChatGPT/Claude/Gemini)</b><div class="small subtle">프롬프트 바의 "내 AI에게"로 자료를 복사하고, 답을 다시 붙여넣으면 돼요.</div></div>
      <div><b>MCP / API (Claude Desktop, Codex 등)</b><div class="small subtle">아래 개인 토큰으로 <code>${origin}/mcp</code>에 연결해요. 토큰은 나와 같은 권한을 가져요.</div></div>
    </div>
    ${(list.data?.tokens || []).map((t) => html`<div class="row small"><code>${t.prefix}…</code><span class="grow">${t.name}</span><span class="faint">${t.lastUsedAt ? `최근 사용 ${timeAgo(t.lastUsedAt)}` : '미사용'}</span><button class="btn sm danger" onClick=${async () => { await del(`/api/tokens/personal/${t.id}`); list.reload(); }}>폐기</button></div>`)}
    <div class="row"><button class="btn sm" onClick=${async () => { const name = prompt('토큰 이름 (예: claude-desktop)', 'my-ai'); if (!name) return; setTok((await post('/api/tokens/personal', { name })).token); list.reload(); }}>개인 토큰 만들기</button>
      <a class="small" href="/agent" target="_blank">AI 안내 문서</a><a class="small" href="/llms.txt" target="_blank">llms.txt</a></div>
    ${tok ? html`<div class="note small">지금만 보여요. AI 앱 설정에만 넣고 다른 곳에 공유하지 마세요.<br /><code style="word-break:break-all">${tok}</code></div>` : null}
    <pre class="code">${mcpJson}</pre>
  </div>`;
}

export function Settings() {
  const app = useApp();
  const td = app.teamData;
  const isPm = ['pm', 'admin'].includes(td?.role);
  const [hook, setHook] = useState('');
  const [invite, setInvite] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const [notion, setNotion] = useState({ token: '', root: '' });
  const [importing, setImporting] = useState(false);
  const [importRes, setImportRes] = useState(null);
  const tokens = useAsync(() => (isPm ? get(`/api/tokens?teamId=${app.teamId}`) : Promise.resolve({ tokens: [] })), [app.teamId, isPm]);
  if (!td) return html`<${Spinner} />`;
  const settings = td.team.settings || {};
  const save = async (body, msg = '저장했어요') => { try { await patch(`/api/teams/${app.teamId}`, body); app.toast(msg); app.reloadTeam(); } catch (e) { app.toast(e.message, true); } };
  const origin = location.origin;
  return html`<div class="page-w">
    <h1 class="title">팀 설정</h1>
    ${!isPm ? html`<div class="note">설정 변경은 PM만 할 수 있어요.</div>` : null}
    <div class="card mt col">
      <h3>팀원</h3>
      ${td.team.members.map((m, i) => html`<div class="row"><span class="grow">${m.name} ${m.userId ? html`<span class="tag c1">가입</span>` : html`<span class="tag">미가입</span>`}</span>
        <select class="select input" style="width:120px" disabled=${!isPm} value=${m.role} onChange=${(e) => save({ members: td.team.members.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })}><option value="pm">PM</option><option value="member">팀원</option></select></div>`)}
      ${isPm ? html`<div class="row"><button class="btn sm" onClick=${async () => setInvite((await post(`/api/teams/${app.teamId}/invites`, { role: 'member' })).code)}>초대 코드 만들기</button>
        ${invite ? html`<code>${invite}</code><span class="small subtle">가입 링크: ${origin}/#/login?invite=${invite}</span>` : null}</div>` : null}
    </div>
    <${PersonalAi} />
    <div class="card mt col">
      <h3>변경 적용 방식</h3>
      <label class="row"><input type="radio" name="trust" disabled=${!isPm} checked=${settings.trust !== 'auto'} onChange=${() => save({ settings: { trust: 'confirm' } })} /> 항상 확인 후 적용 (기본)</label>
      <label class="row"><input type="radio" name="trust" disabled=${!isPm} checked=${settings.trust === 'auto'} onChange=${() => save({ settings: { trust: 'auto' } })} /> 안전한 변경(추가·수정)은 바로 적용, 삭제·병합·형식 변경만 확인</label>
    </div>
    <div class="card mt col">
      <h3>Discord 알림</h3>
      <div class="small subtle">마감 D-2 / D-day, 입력 요청을 팀 디스코드 채널로 보내요. (채널 설정 → 연동 → 웹후크 → URL 복사)</div>
      <div class="row"><input class="input" placeholder=${td.team.hasWebhook ? '연결됨 (바꾸려면 새 URL 입력)' : 'https://discord.com/api/webhooks/...'} value=${hook} onInput=${(e) => setHook(e.target.value)} disabled=${!isPm} />
        <button class="btn" disabled=${!isPm || !hook} onClick=${() => { save({ discordWebhook: hook }, '웹훅을 저장했어요'); setHook(''); }}>저장</button>
        ${td.team.hasWebhook ? html`<button class="btn" onClick=${async () => { const r = await post(`/api/teams/${app.teamId}/discord-test`); app.toast(r.ok ? '테스트 메시지를 보냈어요' : '전송 실패', !r.ok); }}>테스트</button>` : null}</div>
      <label class="row small"><input type="checkbox" disabled=${!isPm} checked=${Boolean(settings.notifyApplied)} onChange=${(e) => save({ settings: { notifyApplied: e.target.checked } })} /> AI 변경이 적용될 때도 알림</label>
    </div>
    ${isPm ? html`<div class="card mt col">
      <h3>Ingest API 토큰 (Codex·CI·Prowler 연동)</h3>
      <div class="small subtle">에이전트나 GitHub Actions가 체크포인트, 리포트, Prowler 결과를 바로 보낼 수 있어요.</div>
      ${(tokens.data?.tokens || []).map((t) => html`<div class="row small"><code>${t.prefix}…</code><span class="grow">${t.name}</span><span class="faint">${t.lastUsedAt ? `최근 사용 ${timeAgo(t.lastUsedAt)}` : '미사용'}</span><button class="btn sm danger" onClick=${async () => { await del(`/api/tokens/${t.id}`); tokens.reload(); }}>폐기</button></div>`)}
      <div class="row"><button class="btn sm" onClick=${async () => { const name = prompt('토큰 이름 (예: github-actions)', 'github-actions'); if (!name) return; setNewToken((await post('/api/tokens', { teamId: app.teamId, name })).token); tokens.reload(); }}>새 토큰</button></div>
      ${newToken ? html`<div class="note small">지금만 보여요. 안전한 곳(GitHub Secrets 등)에 저장하세요.<br /><code style="word-break:break-all">${newToken}</code></div>
        <pre class="code">curl -X POST ${origin}/api/ingest \\
  -H "Authorization: Bearer ${newToken.slice(0, 10)}…" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"prowler","content":"<prowler json-ocsf 결과>","source":"github-actions"}'</pre>` : null}
    </div>
    <div class="card mt col">
      <h3>노션에서 가져오기</h3>
      <div class="small subtle">1) notion.so/my-integrations 에서 Internal Integration 생성 → 토큰 복사. 2) 가져올 페이지(예: "DevSecOps CI/CD 파이프라인 통합 보안 스캐너")의 ··· → 연결 → 방금 만든 integration 추가. 3) 아래에 토큰과 페이지 URL 입력. 산출물 DB는 우리 팀 산출물에 합쳐지고, 비어 있던 종류/차수는 자동 추론돼요.</div>
      <input class="input" type="password" placeholder="ntn_... 또는 secret_..." value=${notion.token} onInput=${(e) => setNotion({ ...notion, token: e.target.value })} />
      <input class="input" placeholder="https://www.notion.so/..." value=${notion.root} onInput=${(e) => setNotion({ ...notion, root: e.target.value })} />
      <div class="row"><button class="btn primary" disabled=${importing || !notion.token || !notion.root} onClick=${async () => {
        setImporting(true); setImportRes(null);
        try { const r = await post('/api/import/notion', { teamId: app.teamId, ...notion }); setImportRes(r); app.reloadTeam(); app.bump(); } catch (e) { app.toast(e.message, true); } finally { setImporting(false); }
      }}>${importing ? html`<${Spinner} /> 가져오는 중…` : '가져오기'}</button><span class="small faint">토큰은 저장하지 않아요</span></div>
      ${importRes ? html`<div class="note small">${importRes.results?.[0]?.imported}개 항목을 가져왔어요 (API 호출 ${importRes.apiCalls}회). ${(importRes.notes || []).slice(0, 10).map((n) => html`<div>· ${n}</div>`)}</div>` : null}
    </div>` : null}
  </div>`;
}

export function Admin() {
  const app = useApp();
  const ov = useAsync(() => get('/api/admin/overview'), [app.refreshKey]);
  const usage = useAsync(() => get('/api/usage'), [app.refreshKey]);
  const [guide, setGuide] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const createSeason = async () => {
    setBusy(true);
    try {
      const r = await post('/api/seasons', { sourceText: guide });
      app.toast(`시즌 생성: 일정 ${r.results[0].milestones}개, 규칙 ${r.results[0].rules}개`);
      setGuide(''); ov.reload();
    } catch (e) { app.toast(e.message, true); } finally { setBusy(false); }
  };
  const season = ov.data?.season;
  const rounds = (season?.milestones || []).filter((m) => m.kind === 'weekly').map((m) => m.round);
  const cell = (row, round) => {
    const d = row.deliverables.find((x) => x.kind === '주간보고' && x.round === round);
    if (!d) return html`<td>-</td>`;
    const late = d.due && d.due < kstToday() && d.status !== '완료';
    const cls = d.status === '완료' ? 's-done' : late ? 's-late' : d.status === '진행 중' ? 's-doing' : '';
    return html`<td class=${cls} title=${`${d.title} · ${d.status || '시작 전'}`}>${d.status === '완료' ? '✔' : late ? '!' : d.status === '진행 중' ? '…' : ''}</td>`;
  };
  return html`<div class="page-w" style="max-width:1100px">
    <h1 class="title">운영진</h1>
    <div class="card mt col">
      <h3>시즌 ${season ? html`<span class="subtle small">· ${season.name} (${season.start} ~ ${season.end})</span>` : ''}</h3>
      ${season ? html`<details><summary class="small">일정 ${season.milestones.length}개 · 규칙 ${season.rules.length}개 보기</summary>
        <table class="btable mt"><tbody><tr><td>일정</td><td>마감</td><td>종류</td></tr>${season.milestones.map((m) => html`<tr><td>${m.title}</td><td>${m.due || m.start || '-'} ${m.due ? dday(m.due) : ''}</td><td>${m.kind}</td></tr>`)}</tbody></table>
        <div class="small mt">${season.rules.map((r) => html`<div>· ${r.label}</div>`)}</div></details>` : html`<div class="small subtle">아직 시즌이 없어요.</div>`}
      <label class="lbl mt">운영 안내문 붙여넣기 (예: 노션 "SSG 팀 프로젝트 안내" 페이지 전체)</label>
      <textarea class="input" rows="8" value=${guide} onInput=${(e) => setGuide(e.target.value)} placeholder=${'프로젝트 기간 : 8월 31일(월) ~ 1월 3일(일)\n| 1차 | 9월 20일(일) | 주간 보고서 제출, SSG HUB articles 작성 |\n...'}></textarea>
      <div class="row"><button class="btn primary" disabled=${busy || guide.length < 20} onClick=${createSeason}>${busy ? '만드는 중…' : '이 안내문으로 새 시즌 만들기'}</button><span class="small faint">제출 일정표, 최소 요구사항, 파일명 규칙, [팀명] 규칙을 자동으로 읽어요</span></div>
    </div>
    <div class="card mt">
      <h3>팀별 주간보고 현황</h3>
      ${ov.loading ? html`<${Spinner} />` : html`<div style="overflow:auto"><table class="matrix"><thead><tr><th>팀</th>${rounds.map((r) => html`<th>${r}차${r === ov.data?.currentRound ? ' ●' : ''}</th>`)}</tr></thead>
        <tbody>${(ov.data?.rows || []).map((row) => html`<tr><td style="text-align:left"><b>${row.team.name}</b><div class="small faint">${row.team.projectTitle}</div></td>${rounds.map((r) => cell(row, r))}</tr>`)}</tbody></table></div>
        <div class="small faint mt">✔ 완료 · … 진행 중 · ! 마감 지남</div>`}
    </div>
    <div class="grid2 mt">
      <div class="card"><h3>사용자</h3>${(ov.data?.users || []).map((u) => html`<div class="row small" style="padding:3px 0"><span class="grow">${u.name} <span class="faint">${u.email}</span></span>
        <label class="row"><input type="checkbox" checked=${u.isAdmin} onChange=${async (e) => { await patch(`/api/admin/users/${u.id}`, { isAdmin: e.target.checked }); ov.reload(); }} />운영진</label></div>`)}</div>
      <div class="card"><h3>무료 한도 사용량</h3>
        ${usage.data ? html`<div class="small">DB: ${(usage.data.storage.bytes / 1024 / 1024).toFixed(1)}MB / 512MB (${usage.data.storage.backend})
          <div style="height:6px;background:#eee;border-radius:4px;margin:6px 0"><div style=${`height:6px;border-radius:4px;background:${usage.data.storage.bytes / usage.data.storage.limitBytes > 0.8 ? 'var(--bad)' : 'var(--ok)'};width:${Math.min(100, (usage.data.storage.bytes / usage.data.storage.limitBytes) * 100).toFixed(1)}%`}></div></div>
          ${Object.entries(usage.data.byProvider).map(([k, v]) => html`<div>${k}: 프롬프트 ${v.prompts}회 · 토큰 ${v.tokensIn + v.tokensOut}</div>`)}
          <div class="faint mt">${usage.data.month} 기준</div></div>` : html`<${Spinner} />`}
      </div>
    </div>
  </div>`;
}
