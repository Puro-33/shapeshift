import { html, useState, useEffect, useRef } from '../lib/preact-htm.js';
import { useApp, Spinner } from './common.js';
import { looksLikeHtml, readFileText } from '../lib/util.js';

const ACTION_LABEL = { create: '추가', update: '변경', delete: '삭제' };
const INTENT_LABEL = { build: '구조', log: '활동 기록', draft: '초안', ingest: '가져오기', ask: '질문', admin: '운영' };

export function PromptBar() {
  const app = useApp();
  const [text, setText] = useState('');
  const [att, setAtt] = useState(null);
  const ta = useRef();
  const fileRef = useRef();
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ta.current?.focus(); } };
    window.addEventListener('keydown', k);
    app.promptApi.current.set = (t) => { setText(t); setTimeout(() => ta.current?.focus(), 0); };
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (ta.current) { ta.current.style.height = 'auto'; ta.current.style.height = `${Math.min(180, ta.current.scrollHeight)}px`; } }, [text]);

  const submit = async () => {
    if (app.busy || (!text.trim() && !att)) return;
    const t = text.trim() || (att ? `${att.name} 가져와줘` : '');
    const a = att?.text || null;
    setText(''); setAtt(null);
    await app.submitPrompt(t, a);
  };
  const onPaste = (e) => {
    const h = e.clipboardData.getData('text/html');
    const t = e.clipboardData.getData('text/plain');
    if ((h && looksLikeHtml(h) && h.length > 1500) || (t && t.length > 2500)) {
      e.preventDefault();
      setAtt({ name: h ? `붙여넣은 HTML (${Math.round(h.length / 1024)}KB)` : `붙여넣은 텍스트 (${t.length}자)`, text: h || t });
    }
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { app.toast('5MB 이하 파일만 첨부할 수 있어요', true); return; }
    setAtt({ name: f.name, text: await readFileText(f) });
  };

  const round = app.teamData?.season ? app.currentRound : null;
  const sugg = app.teamId ? [
    ['📝 오늘 한 일', '오늘 '],
    [`📄 ${round ? `${round}차 ` : ''}주간보고서 초안`, `${round ? `${round}차 ` : ''}주간보고서 초안 만들어줘`],
    ['🙋 이번 주 누가 뭐 했어?', '이번 주 팀원별로 누가 뭐 했는지 요약해줘'],
    ...(app.node?.type === 'page' ? [['🗂 이 페이지를 DB로', '이 페이지를 컬렉션(DB)으로 바꿔줘']] : []),
    ...(app.node?.type === 'collection' ? [['▥ 보드 뷰', `${app.node.title}를 상태별 칸반 보드로 보여줘`]] : []),
  ] : [['🚀 팀 만들기', 'DevSecOps 보안 스캐너 팀 만들어줘. 팀명 ___, PM ___, 팀원 ___ ___ ___']];

  return html`<div class="promptbar">
    ${!text && !att && !app.busy ? html`<div class="suggest">${sugg.map(([l, t]) => html`<button onClick=${() => app.setPromptText(t)}>${l}</button>`)}</div>` : null}
    <div class="pb-box">
      ${att ? html`<div class="mb"><span class="chip">📎 ${att.name} <button class="btn ghost sm" onClick=${() => setAtt(null)}>✕</button></span></div>` : null}
      <textarea ref=${ta} rows="1" value=${text} placeholder=${app.teamId ? '무엇이든 말하세요: "오늘 lambda_privesc 풀었어", "태스크에 예상 시간 필드 추가", "2차 주간보고서 만들어줘"' : '팀을 만들거나 초대 코드로 참여해 보세요'}
        onInput=${(e) => setText(e.target.value)} onPaste=${onPaste}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } }}></textarea>
      <div class="pb-actions">
        <button class="btn sm ghost" title="HTML/Markdown/JSON(Prowler) 파일 첨부" onClick=${() => fileRef.current.click()}>📎 파일</button>
        <input type="file" ref=${fileRef} style="display:none" accept=".html,.htm,.md,.txt,.json,.csv" onChange=${onFile} />
        <span class="hint">${app.busy ? html`<${Spinner} /> 계획을 세우는 중… (무료 AI 한도에 따라 몇 초 걸려요)` : html`<span class="kbd">Enter</span> 보내기 · <span class="kbd">Shift+Enter</span> 줄바꿈 · <span class="kbd">Ctrl+K</span>`}</span>
        <span class="grow"></span>
        <button class="btn primary sm" disabled=${app.busy || (!text.trim() && !att)} onClick=${submit}>보내기</button>
      </div>
    </div>
  </div>`;
}

function Reply({ text }) {
  const app = useApp();
  const parts = String(text || '').split(/(\[\[[\w-]+\]\])/g);
  return html`<div class="reply">${parts.map((p) => {
    const m = p.match(/^\[\[([\w-]+)\]\]$/);
    return m ? html`<a href=${`#/t/${app.teamId}/n/${m[1]}`}>🔗</a>` : p;
  })}</div>`;
}

export function PlanCard({ prompt, onClose }) {
  const app = useApp();
  const [working, setWorking] = useState(false);
  if (!prompt) return null;
  const p = prompt;
  const act = async (fn) => { setWorking(true); try { await fn(); } finally { setWorking(false); } };
  const diff = p.plan?.diff || [];
  return html`<div class="plan">
    <div class="plan-h">
      <div class="grow">
        <div class="row small faint">${p.pending ? html`<${Spinner} /> 계획 중` : html`<span class="pill">${INTENT_LABEL[p.intent] || p.intent || '계획'}</span>`}
          ${p.origin === 'followup' ? html`<span class="pill" style="background:#e3f4ec;color:#17704c">가져오기 후속 제안</span>` : null}
          ${p.status === 'applied' ? html`<span class="badge-ok">✔ 적용됨</span>` : p.status === 'reverted' ? html`<span class="badge-warn">↺ 되돌림</span>` : null}</div>
        <div style="font-weight:600;margin-top:4px">${p.plan?.summary || p.text}</div>
        ${p.plan?.summary && p.text ? html`<div class="small subtle" style="margin-top:2px">"${p.text.length > 120 ? `${p.text.slice(0, 120)}…` : p.text}"</div>` : null}
      </div>
      <button class="btn ghost sm" onClick=${onClose}>✕</button>
    </div>
    <div class="plan-b">
      ${p.pending ? html`<div class="subtle small">요청을 분석해서 변경 계획을 만들고 있어요. 아직 아무것도 바뀌지 않았어요.</div>` : null}
      ${p.warning ? html`<div class="note small mb">AI 호출 실패로 규칙 기반 플래너가 대신 처리했어요.</div>` : null}
      ${p.error ? html`<div class="err mb">${p.error.message}</div>` : null}
      ${p.plan?.reply && (p.intent === 'ask' || !diff.length) ? html`<${Reply} text=${p.plan.reply} />` : null}
      ${p.plan?.destructive ? html`<div class="err mb">⚠ 삭제나 구조 변경이 포함돼 있어요. 확인 후 적용해 주세요.</div>` : null}
      ${diff.length ? html`<ul class="diff">${diff.map((d) => html`<li class=${d.action}>
        <b>${ACTION_LABEL[d.action]}</b> ${d.kind === 'node' ? ({ page: '📄', collection: '🗂', item: '•' }[d.type] || '') : d.kind === 'season' ? '📆' : d.kind === 'team' ? '👥' : d.kind === 'request' ? '📝' : ''} ${d.title}
        ${d.changes?.length ? html`<div class="ch">${d.changes.slice(0, 6).join(' · ')}${d.changes.length > 6 ? ` 외 ${d.changes.length - 6}` : ''}</div>` : null}
      </li>`)}</ul>` : null}
      ${(p.plan?.notes || []).length ? html`<div class="small subtle">${p.plan.notes.slice(0, 8).map((n) => html`<div>· ${n}</div>`)}</div>` : null}
      ${!p.pending ? html`<div class="meta mt">${p.provider}${p.model && p.provider !== 'heuristic' ? ` · ${p.model}` : ''}${p.tokensIn ? ` · ${p.tokensIn}+${p.tokensOut} tok` : ''}${p.latencyMs ? ` · ${(p.latencyMs / 1000).toFixed(1)}s` : ''}</div>` : null}
    </div>
    ${!p.pending ? html`<div class="plan-f">
      ${p.status === 'planned' ? html`
        <button class="btn" disabled=${working} onClick=${() => act(async () => { await app.dismissPrompt(p); onClose(); })}>취소</button>
        <button class="btn" disabled=${working} onClick=${() => { app.setPromptText(`${p.text}\n(수정: )`); }}>수정 요청</button>
        <button class="btn primary" disabled=${working} onClick=${() => act(() => app.applyPrompt(p))}>${working ? '적용 중…' : '적용'}</button>` : null}
      ${p.status === 'applied' && p.oplogId ? html`<button class="btn" disabled=${working} onClick=${() => act(() => app.undo(p.oplogId))}>되돌리기</button><button class="btn primary" onClick=${onClose}>닫기</button>` : null}
      ${['failed', 'answered', 'reverted', 'dismissed'].includes(p.status) ? html`${p.status === 'failed' ? html`<button class="btn" onClick=${() => app.setPromptText(p.text)}>다시 쓰기</button>` : null}<button class="btn primary" onClick=${onClose}>닫기</button>` : null}
    </div>` : null}
  </div>`;
}
