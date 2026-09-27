import { html, useState, useEffect, useRef } from '../lib/preact-htm.js';
import { uid, htmlToBlocks, looksLikeHtml, compressImage, readFileText } from '../lib/util.js';
import { post } from '../lib/api.js';
import { useApp } from './common.js';

const SHORTCUTS = [
  [/^###\s/, 'h3'], [/^##\s/, 'h2'], [/^#\s/, 'h1'], [/^\[\s?\]\s/, 'todo'], [/^[-*]\s/, 'bullet'], [/^1[.)]\s/, 'number'], [/^>\s/, 'quote'], [/^```$/, 'code'], [/^---$/, 'divider'],
];
const SLASH = [
  ['p', '텍스트'], ['h1', '제목 1'], ['h2', '제목 2'], ['h3', '제목 3'], ['bullet', '글머리 목록'], ['number', '번호 목록'], ['todo', '할 일'],
  ['quote', '인용'], ['callout', '콜아웃'], ['code', '코드'], ['table', '표'], ['divider', '구분선'], ['image', '사진 업로드'], ['html', 'HTML 리포트 삽입'],
];
const PH = { p: "'/' 로 블록 추가, 마크다운 단축키 사용 가능", h1: '제목 1', h2: '제목 2', h3: '제목 3', bullet: '목록', number: '목록', todo: '할 일', quote: '인용', callout: '메모', code: '코드' };

function placeCaretEnd(el) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function Ce({ value, onText, onKeyDown, onPasteBlocks, placeholder, focus, readOnly }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== (value || '')) el.innerText = value || '';
  }, [value]);
  useEffect(() => { if (focus && ref.current) placeCaretEnd(ref.current); }, [focus]);
  const onPaste = (e) => {
    const h = e.clipboardData.getData('text/html');
    const t = e.clipboardData.getData('text/plain');
    if (h && looksLikeHtml(h)) {
      const blocks = htmlToBlocks(h);
      if (blocks.length > 1 && onPasteBlocks) { e.preventDefault(); onPasteBlocks(blocks); return; }
    }
    if (t && t.includes('\n') && onPasteBlocks && t.split('\n').filter(Boolean).length > 2) {
      e.preventDefault();
      onPasteBlocks(t.split('\n').filter((l) => l.trim()).map((l) => ({ type: /^[-*]\s/.test(l) ? 'bullet' : 'p', text: l.replace(/^[-*]\s/, '') })));
      return;
    }
    e.preventDefault();
    document.execCommand('insertText', false, t);
  };
  return html`<div ref=${ref} class="ce" contenteditable=${readOnly ? 'false' : 'true'} data-ph=${placeholder}
    onInput=${(e) => onText(e.currentTarget.innerText.replace(/\n$/, ''))} onKeyDown=${onKeyDown} onPaste=${onPaste}></div>`;
}

export function HtmlBlock({ nodeId, block, onRemove, readOnly }) {
  const [interactive, setInteractive] = useState(false);
  const src = `/api/render/${nodeId}/${block.id}?mode=${interactive ? 'interactive' : 'safe'}`;
  return html`<div class="htmlblk">
    <div class="bar">
      <span>🧾 ${block.title || 'HTML 리포트'}</span>
      <span class="grow"></span>
      <label class="row small" title="리포트 안의 스크립트를 격리된 샌드박스에서 실행해요 (네트워크 차단)"><input type="checkbox" checked=${interactive} onChange=${(e) => setInteractive(e.target.checked)} /> 인터랙티브</label>
      <a class="btn sm" href=${src} target="_blank" rel="noopener">새 탭</a>
      ${!readOnly && onRemove ? html`<button class="btn sm ghost" onClick=${onRemove}>삭제</button>` : null}
    </div>
    <iframe src=${src} sandbox=${interactive ? 'allow-scripts' : ''} referrerpolicy="no-referrer" loading="lazy"></iframe>
  </div>`;
}

function TableBlock({ block, update, readOnly }) {
  const rows = block.rows?.length ? block.rows : [['', ''], ['', '']];
  const set = (r, c, val) => { const nr = rows.map((x) => [...x]); nr[r][c] = val; update({ rows: nr }); };
  return html`<div>
    <table class="btable"><tbody>
      ${rows.map((row, r) => html`<tr>${row.map((cell, c) => html`<td contenteditable=${readOnly ? 'false' : 'true'} onBlur=${(e) => e.currentTarget.innerText !== cell && set(r, c, e.currentTarget.innerText)} dangerouslySetInnerHTML=${{ __html: cell.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x])).replace(/\n/g, '<br>') }}></td>`)}</tr>`)}
    </tbody></table>
    ${readOnly ? null : html`<div class="row small"><button class="btn sm ghost" onClick=${() => update({ rows: [...rows, rows[0].map(() => '')] })}>+ 행</button><button class="btn sm ghost" onClick=${() => update({ rows: rows.map((r) => [...r, '']) })}>+ 열</button>${rows.length > 1 ? html`<button class="btn sm ghost" onClick=${() => update({ rows: rows.slice(0, -1) })}>- 행</button>` : null}</div>`}
  </div>`;
}

export function BlockEditor({ nodeId, blocks: initial, onChange, readOnly = false }) {
  const app = useApp();
  const [blocks, setBlocks] = useState(() => (initial?.length ? initial : [{ id: uid(), type: 'p', text: '' }]));
  const [focus, setFocus] = useState({ id: null, n: 0 });
  const [slash, setSlash] = useState(null);
  const timer = useRef();
  const fileRef = useRef();
  const htmlRef = useRef();
  const pending = useRef(null);
  const lastSent = useRef(JSON.stringify(initial || []));

  useEffect(() => {
    const incoming = JSON.stringify(initial || []);
    if (incoming !== lastSent.current) { lastSent.current = incoming; setBlocks(initial?.length ? initial : [{ id: uid(), type: 'p', text: '' }]); }
  }, [JSON.stringify(initial || [])]);

  const commit = (next, { now = false } = {}) => {
    setBlocks(next);
    clearTimeout(timer.current);
    const send = () => {
      const clean = next.filter((b, i) => !(i === next.length - 1 && b.type === 'p' && !b.text && next.length > 1));
      const s = JSON.stringify(clean);
      if (s === lastSent.current) return;
      lastSent.current = s;
      onChange(clean);
    };
    if (now) send(); else timer.current = setTimeout(send, 1200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (i, patch, opts) => commit(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)), opts);
  const insertAfter = (i, list) => {
    const withIds = list.map((b) => ({ id: uid(), ...b }));
    const next = [...blocks.slice(0, i + 1), ...withIds, ...blocks.slice(i + 1)];
    commit(next, { now: list.some((b) => ['image', 'html', 'divider', 'table'].includes(b.type)) });
    setFocus({ id: withIds.at(-1).id, n: focus.n + 1 });
  };
  const remove = (i) => {
    const next = blocks.filter((_, j) => j !== i);
    commit(next.length ? next : [{ id: uid(), type: 'p', text: '' }], { now: true });
    if (i > 0) setFocus({ id: blocks[i - 1].id, n: focus.n + 1 });
  };

  const onText = (i, text) => {
    const b = blocks[i];
    if (b.type === 'p' || (b.type !== 'code' && text.length < 5)) {
      for (const [re, type] of SHORTCUTS) {
        if (re.test(text) && b.type !== type) {
          if (type === 'divider') { commit([...blocks.slice(0, i), { ...b, type: 'divider', text: '' }, { id: uid(), type: 'p', text: '' }, ...blocks.slice(i + 1)]); return; }
          const rest = text.replace(re, '');
          const el = document.activeElement;
          if (el) el.innerText = rest;
          update(i, { type, text: rest });
          setFocus({ id: b.id, n: focus.n + 1 });
          return;
        }
      }
    }
    if (text === '/' && !readOnly) {
      const r = document.activeElement?.getBoundingClientRect();
      const host = document.querySelector('.content')?.getBoundingClientRect();
      setSlash({ i, top: (r?.bottom || 0) - (host?.top || 0) + (document.querySelector('.content')?.scrollTop || 0) + 4, left: (r?.left || 0) - (host?.left || 0) });
    } else if (slash) setSlash(null);
    const nb = blocks.map((x, j) => (j === i ? { ...x, text } : x));
    commit(nb);
  };

  const onKeyDown = (i, e) => {
    const b = blocks[i];
    if (slash && e.key === 'Escape') { setSlash(null); return; }
    if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code' && !e.isComposing) {
      e.preventDefault();
      if (['bullet', 'number', 'todo'].includes(b.type) && !b.text.trim()) { update(i, { type: 'p', indent: 0 }); return; }
      const cont = ['bullet', 'number', 'todo'].includes(b.type) ? b.type : 'p';
      insertAfter(i, [{ type: cont, text: '', ...(b.indent ? { indent: b.indent } : {}) }]);
    } else if (e.key === 'Backspace' && !b.text && blocks.length > 1) {
      e.preventDefault();
      if (b.type !== 'p') update(i, { type: 'p', indent: 0 }); else remove(i);
    } else if (e.key === 'Tab' && ['bullet', 'number', 'todo'].includes(b.type)) {
      e.preventDefault();
      update(i, { indent: Math.max(0, Math.min(4, (b.indent || 0) + (e.shiftKey ? -1 : 1))) });
    } else if (e.key === 'ArrowUp' && i > 0 && window.getSelection()?.anchorOffset === 0) {
      setFocus({ id: blocks[i - 1].id, n: focus.n + 1 });
    } else if (e.key === 'ArrowDown' && i < blocks.length - 1 && window.getSelection()?.anchorOffset >= (b.text || '').length) {
      setFocus({ id: blocks[i + 1].id, n: focus.n + 1 });
    }
  };

  const chooseSlash = async (type) => {
    const i = slash.i;
    setSlash(null);
    const el = document.activeElement;
    if (el?.classList?.contains('ce')) el.innerText = '';
    if (type === 'image') { pending.current = i; fileRef.current.click(); update(i, { text: '' }); return; }
    if (type === 'html') { pending.current = i; htmlRef.current.click(); update(i, { text: '' }); return; }
    if (type === 'table') { commit(blocks.map((b, j) => (j === i ? { id: b.id, type: 'table', rows: [['항목', '내용'], ['', '']] } : b)), { now: true }); return; }
    if (type === 'divider') { commit([...blocks.slice(0, i), { id: blocks[i].id, type: 'divider' }, { id: uid(), type: 'p', text: '' }, ...blocks.slice(i + 1)], { now: true }); return; }
    update(i, { type, text: '' });
    setFocus({ id: blocks[i].id, n: focus.n + 1 });
  };

  const onImage = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      app.toast('사진을 압축해서 올리는 중…');
      const dataUrl = await compressImage(f);
      const r = await post('/api/attachments', { teamId: app.teamId, dataUrl });
      const i = pending.current ?? blocks.length - 1;
      const next = [...blocks];
      if (next[i] && next[i].type === 'p' && !next[i].text) next[i] = { id: next[i].id, type: 'image', src: r.src, caption: f.name };
      else next.splice(i + 1, 0, { id: uid(), type: 'image', src: r.src, caption: f.name });
      commit(next, { now: true });
      app.toast(`사진 업로드 완료 (${Math.round(r.bytes / 1024)}KB)`);
    } catch (err) { app.toast(err.message, true); }
  };
  const onHtml = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const text = await readFileText(f);
    const i = pending.current ?? blocks.length - 1;
    const next = [...blocks];
    const blk = { id: uid(), type: 'html', title: f.name, html: text };
    if (next[i] && next[i].type === 'p' && !next[i].text) next[i] = { ...blk, id: next[i].id }; else next.splice(i + 1, 0, blk);
    commit(next, { now: true });
  };

  return html`<div class="blocks" style="position:relative">
    ${blocks.map((b, i) => {
      const common = { key: b.id, 'data-block-id': b.id, 'data-block-type': b.type };
      const handle = readOnly ? null : html`<button class="handle" title="블록 삭제" onClick=${() => remove(i)}>⋮</button>`;
      if (b.type === 'divider') return html`<div class="blk" ...${common}>${handle}<hr /></div>`;
      if (b.type === 'image') return html`<div class="blk" ...${common}>${handle}<img src=${b.src} alt=${b.caption || ''} />${b.caption ? html`<div class="small faint">${b.caption}</div>` : null}</div>`;
      if (b.type === 'html') return html`<div class="blk" ...${common}><${HtmlBlock} nodeId=${nodeId} block=${b} readOnly=${readOnly} onRemove=${() => remove(i)} /></div>`;
      if (b.type === 'table') return html`<div class="blk" ...${common}>${handle}<${TableBlock} block=${b} readOnly=${readOnly} update=${(p) => update(i, p, { now: true })} /></div>`;
      const ce = html`<${Ce} value=${b.text} placeholder=${i === blocks.length - 1 || b.type !== 'p' ? PH[b.type] : ''} readOnly=${readOnly}
        focus=${focus.id === b.id ? focus.n : 0}
        onText=${(t) => onText(i, t)} onKeyDown=${(e) => onKeyDown(i, e)} onPasteBlocks=${(list) => insertAfter(i, list)} />`;
      return html`<div class="blk ${b.type} ${b.type === 'todo' && b.checked ? 'done' : ''}" style=${b.indent ? `margin-left:${b.indent * 22}px` : ''} ...${common}>
        ${handle}
        ${b.type === 'todo' ? html`<input type="checkbox" checked=${b.checked} disabled=${readOnly} onChange=${(e) => update(i, { checked: e.target.checked }, { now: true })} />` : null}
        ${ce}
      </div>`;
    })}
    ${slash ? html`<div class="slash" style=${`top:${slash.top}px;left:${Math.max(0, slash.left)}px`}>${SLASH.map(([t, l]) => html`<div onMouseDown=${(e) => { e.preventDefault(); chooseSlash(t); }}>${l}</div>`)}</div>` : null}
    <input type="file" accept="image/*" ref=${fileRef} style="display:none" onChange=${onImage} />
    <input type="file" accept=".html,.htm,text/html" ref=${htmlRef} style="display:none" onChange=${onHtml} />
    ${readOnly ? null : html`<div class="row small faint" style="padding-left:26px;margin-top:6px">
      <button class="btn sm ghost" onClick=${() => insertAfter(blocks.length - 1, [{ type: 'p', text: '' }])}>+ 블록</button>
      <button class="btn sm ghost" onClick=${() => { pending.current = blocks.length - 1; fileRef.current.click(); }}>📷 사진</button>
      <button class="btn sm ghost" onClick=${() => { pending.current = blocks.length - 1; htmlRef.current.click(); }}>🧾 HTML 파일</button>
    </div>`}
  </div>`;
}
