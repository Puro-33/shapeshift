import { html, useState, useEffect, useRef } from '../lib/preact-htm.js';
import { useApp, Spinner, Modal } from './common.js';
import { looksLikeHtml, readFileText } from '../lib/util.js';
import { get } from '../lib/api.js';

const ACTION_LABEL = { create: '추가', update: '변경', delete: '삭제' };
const INTENT_LABEL = { build: '구조', log: '활동 기록', draft: '초안', ingest: '가져오기', ask: '질문', admin: '운영' };
const SOURCE_LABEL = { rules: '빠른 명령 (AI 없음)', 'user-ai': '내 AI · JSON 계획', markdown: '내 AI · Markdown 편집', heuristic: '빠른 명령' };

/** Copy a context package for chat AIs, then paste their answer back. */
export function MyAiModal({ task, onClose }) {
  const app = useApp();
  const [pkg, setPkg] = useState(null);
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams({ teamId: app.teamId, task: task || '' });
    if (app.node?.id) q.set('nodeId', app.node.id);
    get(`/api/agent/package?${q}`).then((r) => setPkg(r.markdown)).catch((e) => setPkg(`자료를 만들지 못했어요: ${e.message}`));
  }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(pkg); setCopied(true); } catch { app.toast('복사 권한이 없어요. 아래 내용을 직접 선택해서 복사해 주세요', true); } };
  const submit = async () => { if (!answer.trim()) return; onClose(); await app.submitPrompt(answer.trim()); };
  const agentUrl = app.node?.id ? `/p/${app.node.id}` : `/t/${app.teamId}`;
  return html`<${Modal} title="🤖 내 AI에게 맡기기" onClose=${onClose} width="min(760px, 94vw)">
    <div class="col">
      <div class="note small"><b>AI 브라우저(Aside 등)</b>를 쓰면 복사할 필요 없어요. <a href=${agentUrl} target="_blank" rel="noopener">AI용 보기</a> 페이지를 열어 두고 AI에게 "이 페이지 편집 폼으로 ○○해줘"라고 하면 돼요. MCP를 지원하는 AI는 팀 설정 → 개인 AI 연결을 쓰세요.</div>
      <div><label class="lbl">1. 이 자료를 ChatGPT·Claude 등에 붙여넣으세요 (요청, 워크스페이스 개요, ${app.node ? '현재 문서, ' : ''}편집 규칙 포함)</label>
        <textarea class="input" rows="9" readonly value=${pkg || '만드는 중…'} style="font-family:ui-monospace,monospace;font-size:12px"></textarea>
        <div class="row mt"><button class="btn primary sm" disabled=${!pkg} onClick=${copy}>${copied ? '✔ 복사됨' : '📋 복사'}</button>
          <a class="btn sm" href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT 열기</a><a class="btn sm" href="https://claude.ai/new" target="_blank" rel="noopener">Claude 열기</a><a class="btn sm" href="https://gemini.google.com/" target="_blank" rel="noopener">Gemini 열기</a>
          <span class="small faint">${pkg ? `${pkg.length.toLocaleString()}자` : ''}</span></div></div>
      <div><label class="lbl">2. AI의 답(Markdown 문서 또는 JSON 계획)을 그대로 붙여넣으세요</label>
        <textarea class="input" rows="8" value=${answer} onInput=${(e) => setAnswer(e.target.value)} placeholder='---\nid: n_...\n...  또는  {"summary":"...","ops":[...]}' style="font-family:ui-monospace,monospace;font-size:12px"></textarea></div>
      <div class="row"><span class="small subtle grow">적용 전에 무엇이 바뀌는지 미리 보여줘요. 적용 후에도 되돌릴 수 있어요.</span><button class="btn" onClick=${onClose}>닫기</button><button class="btn primary" disabled=${!answer.trim()} onClick=${submit}>미리보기</button></div>
    </div>
  <//>`;
}

export function PromptBar() {
  const app = useApp();
  const [text, setText] = useState('');
  const [att, setAtt] = useState(null);
  const [myAi, setMyAi] = useState(null);
  const ta = useRef();
  const fileRef = useRef();
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ta.current?.focus(); } };
    window.addEventListener('keydown', k);
    app.promptApi.current.set = (t) => { setText(t); setTimeout(() => ta.current?.focus(), 0); };
    app.promptApi.current.myAi = (t) => setMyAi({ task: t });
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
    if (/^\s*(---\n|```|\{|\[)/.test(t) && (/"op"\s*:/.test(t) || /\nid:\s*\S+/.test(t))) return; // AI answer: keep as text
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
    ...(app.node?.type === 'collection' ? [['▥ 보드 뷰', `${app.node.title}를 칸반 보드로 보여줘`]] : []),
  ] : [];

  return html`<div class="promptbar">
    ${myAi ? html`<${MyAiModal} task=${myAi.task} onClose=${() => setMyAi(null)} />` : null}
    ${!text && !att && !app.busy && app.teamId ? html`<div class="suggest">${sugg.map(([l, t]) => html`<button onClick=${() => app.setPromptText(t)}>${l}</button>`)}
      <button onClick=${() => setMyAi({ task: '' })}>🤖 내 AI에게 맡기기</button>
      <a href=${app.node?.id ? `/p/${app.node.id}` : `/t/${app.teamId}`} target="_blank" rel="noopener" title="JS 없이 읽히는 AI용 HTML (Markdown/JSON/편집 폼 포함)">🔍 AI용 보기</a></div>` : null}
    <div class="pb-box">
      ${att ? html`<div class="mb"><span class="chip">📎 ${att.name} <button class="btn ghost sm" onClick=${() => setAtt(null)}>✕</button></span></div>` : null}
      <textarea ref=${ta} rows="1" value=${text} placeholder=${app.teamId ? '빠른 명령: "오늘 lambda_privesc 풀었어", "태스크에 예상 시간 숫자 필드 추가". AI 답(Markdown/JSON)을 붙여넣어도 돼요' : '팀을 만들거나 초대 코드로 참여해 보세요'}
        onInput=${(e) => setText(e.target.value)} onPaste=${onPaste}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } }}></textarea>
      <div class="pb-actions">
        <button class="btn sm ghost" title="HTML/Markdown/JSON(Prowler) 파일 첨부" onClick=${() => fileRef.current.click()}>📎 파일</button>
        <input type="file" ref=${fileRef} style="display:none" accept=".html,.htm,.md,.txt,.json,.csv" onChange=${onFile} />
        <span class="hint">${app.busy ? html`<${Spinner} /> 미리보기 만드는 중…` : html`AI 없이 규칙으로 처리 · <span class="kbd">Enter</span> 실행 · <span class="kbd">Ctrl+K</span>`}</span>
        <span class="grow"></span>
        ${app.teamId ? html`<button class="btn sm" disabled=${app.busy} onClick=${() => { setMyAi({ task: text.trim() }); setText(''); }}>🤖 내 AI에게</button>` : null}
        <button class="btn primary sm" disabled=${app.busy || (!text.trim() && !att)} onClick=${submit}>실행</button>
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
  return html`<div class="plan" role="dialog" aria-label="변경 미리보기" data-prompt-id=${p.id || ''} data-status=${p.status || ''}>
    <div class="plan-h">
      <div class="grow">
        <div class="row small faint">${p.pending ? html`<${Spinner} /> 미리보기 중` : html`<span class="pill">${INTENT_LABEL[p.intent] || p.intent || '계획'}</span>`}
          ${p.status === 'applied' ? html`<span class="badge-ok">✔ 적용됨</span>` : p.status === 'reverted' ? html`<span class="badge-warn">↺ 되돌림</span>` : null}</div>
        <div style="font-weight:600;margin-top:4px">${p.plan?.summary || p.text}</div>
        ${p.plan?.summary && p.text && p.provider === 'rules' ? html`<div class="small subtle" style="margin-top:2px">"${p.text.length > 120 ? `${p.text.slice(0, 120)}…` : p.text}"</div>` : null}
      </div>
      <button class="btn ghost sm" onClick=${onClose}>✕</button>
    </div>
    <div class="plan-b">
      ${p.pending ? html`<div class="subtle small">변경 계획을 검증하고 있어요. 아직 아무것도 바뀌지 않았어요.</div>` : null}
      ${p.error ? html`<div class="err mb">${p.error.message}</div>` : null}
      ${p.plan?.reply && (p.intent === 'ask' || !diff.length) ? html`<${Reply} text=${p.plan.reply} />` : null}
      ${p.intent === 'ask' ? html`<button class="btn sm mt" onClick=${() => { onClose(); app.promptApi.current.myAi?.(p.text); }}>🤖 이 질문을 내 AI에게</button>` : null}
      ${p.plan?.destructive ? html`<div class="err mb">⚠ 삭제나 구조 변경이 포함돼 있어요. 확인 후 적용해 주세요.</div>` : null}
      ${diff.length ? html`<ul class="diff">${diff.map((d) => html`<li class=${d.action} data-action=${d.action}>
        <b>${ACTION_LABEL[d.action]}</b> ${d.kind === 'node' ? ({ page: '📄', collection: '🗂', item: '•' }[d.type] || '') : d.kind === 'season' ? '📆' : d.kind === 'team' ? '👥' : d.kind === 'request' ? '📝' : ''} ${d.title}
        ${d.changes?.length ? html`<div class="ch">${d.changes.slice(0, 6).join(' · ')}${d.changes.length > 6 ? ` 외 ${d.changes.length - 6}` : ''}</div>` : null}
      </li>`)}</ul>` : null}
      ${(p.plan?.notes || []).length ? html`<div class="small subtle">${p.plan.notes.slice(0, 8).map((n) => html`<div>· ${n}</div>`)}</div>` : null}
      ${!p.pending ? html`<div class="meta mt">${SOURCE_LABEL[p.provider] || p.provider}${p.latencyMs ? ` · ${p.latencyMs}ms` : ''}</div>` : null}
    </div>
    ${!p.pending ? html`<div class="plan-f">
      ${p.status === 'planned' ? html`
        <button class="btn" disabled=${working} onClick=${() => act(async () => { await app.dismissPrompt(p); onClose(); })}>취소</button>
        <button class="btn primary" disabled=${working} onClick=${() => act(() => app.applyPrompt(p))}>${working ? '적용 중…' : '적용'}</button>` : null}
      ${p.status === 'applied' && p.oplogId ? html`<button class="btn" disabled=${working} onClick=${() => act(() => app.undo(p.oplogId))}>되돌리기</button><button class="btn primary" onClick=${onClose}>닫기</button>` : null}
      ${['failed', 'answered', 'reverted', 'dismissed'].includes(p.status) ? html`${p.status === 'failed' && p.provider === 'rules' ? html`<button class="btn" onClick=${() => app.setPromptText(p.text)}>다시 쓰기</button>` : null}<button class="btn primary" onClick=${onClose}>닫기</button>` : null}
    </div>` : null}
  </div>`;
}
