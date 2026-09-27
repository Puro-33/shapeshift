import { html, useState, useEffect, useRef, createContext, useContext } from '../lib/preact-htm.js';
import { display, optColor } from '../lib/util.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const Spinner = () => html`<span class="spin"></span>`;

export function Tag({ field, value }) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return html`${value.map((v) => html`<span class="tag ${optColor(field, v)}" style="margin-right:3px">${v}</span>`)}`;
  return html`<span class="tag ${optColor(field, value)}">${value}</span>`;
}

export function Modal({ title, onClose, children, width }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`<div class="modal-bg" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="modal" style=${width ? `width:${width}` : ''}>
      <div class="row mb"><h3 style="margin:0" class="grow">${title}</h3><button class="btn ghost sm" onClick=${onClose}>✕</button></div>
      ${children}
    </div>
  </div>`;
}

export function useAsync(fn, deps) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive && set({ loading: false, data, error: null })).catch((error) => alive && set({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

/** Inline editor for one field value; calls onChange(newValue) on commit. */
export function FieldInput({ field, value, onChange, members = [] }) {
  const [v, setV] = useState(value);
  const ref = useRef();
  useEffect(() => setV(value), [JSON.stringify(value)]);
  const commit = (nv) => { if (JSON.stringify(nv ?? null) !== JSON.stringify(value ?? null)) onChange(nv); };
  switch (field.type) {
    case 'checkbox':
      return html`<input type="checkbox" checked=${Boolean(value)} onChange=${(e) => onChange(e.target.checked)} style="margin:6px" />`;
    case 'select':
    case 'status':
      return html`<select class="cellin" value=${v ?? ''} onChange=${(e) => { setV(e.target.value); commit(e.target.value || null); }}>
        <option value="">—</option>
        ${(field.options || []).map((o) => html`<option value=${o}>${o}</option>`)}
      </select>`;
    case 'date':
      return html`<input class="cellin" type="date" value=${v || ''} onChange=${(e) => { setV(e.target.value); commit(e.target.value || null); }} />`;
    case 'daterange':
      return html`<div class="row" style="gap:2px">
        <input class="cellin" type="date" value=${v?.start || ''} onChange=${(e) => commit({ start: e.target.value, end: v?.end || e.target.value })} />
        <input class="cellin" type="date" value=${v?.end || ''} onChange=${(e) => commit({ start: v?.start || e.target.value, end: e.target.value })} />
      </div>`;
    case 'number':
    case 'percent':
      return html`<input class="cellin" type="number" value=${v ?? ''} onInput=${(e) => setV(e.target.value)} onBlur=${() => commit(v === '' || v === null ? null : Number(v))} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`;
    case 'multi_select':
    case 'person': {
      const list = field.type === 'person' ? [...new Set([...members, ...(Array.isArray(v) ? v : [])])] : [...new Set([...(field.options || []), ...(Array.isArray(v) ? v : [])])];
      const cur = Array.isArray(v) ? v : [];
      return html`<details class="cellin" style="position:relative">
        <summary style="list-style:none;cursor:pointer;min-height:20px">${cur.length ? html`<${Tag} field=${field} value=${cur} />` : html`<span class="faint">비어 있음</span>`}</summary>
        <div class="card" style="position:absolute;z-index:20;padding:6px;min-width:180px;max-height:240px;overflow:auto">
          ${list.map((o) => html`<label class="row small" style="padding:3px 4px;cursor:pointer"><input type="checkbox" checked=${cur.includes(o)} onChange=${(e) => { const nv = e.target.checked ? [...cur, o] : cur.filter((x) => x !== o); setV(nv); onChange(nv); }} />${o}</label>`)}
          <input class="input small" placeholder="추가 후 Enter" onKeyDown=${(e) => { if (e.key === 'Enter' && e.target.value.trim()) { const nv = [...cur, e.target.value.trim()]; e.target.value = ''; setV(nv); onChange(nv); } }} />
        </div>
      </details>`;
    }
    case 'url':
      return html`<div class="row" style="gap:2px"><input class="cellin" value=${v || ''} onInput=${(e) => setV(e.target.value)} onBlur=${() => commit(v || null)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />${v ? html`<a href=${v} target="_blank" rel="noopener" class="small">↗</a>` : null}</div>`;
    case 'relation':
      return html`<span class="small subtle" style="padding:4px 6px;display:block">${Array.isArray(value) ? `${value.length}개 연결` : ''}</span>`;
    case 'json':
      return html`<span class="small subtle" style="padding:4px 6px;display:block">${display(field, value)}</span>`;
    default:
      return html`<input ref=${ref} class="cellin" value=${v ?? ''} onInput=${(e) => setV(e.target.value)} onBlur=${() => commit(v || null)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`;
  }
}

export const FIELD_TYPE_LABELS = { text: '텍스트', number: '숫자', percent: '퍼센트', select: '선택', multi_select: '다중 선택', status: '상태', date: '날짜', daterange: '기간', person: '사람', url: 'URL', checkbox: '체크박스', relation: '관계', json: 'JSON', html: 'HTML' };
