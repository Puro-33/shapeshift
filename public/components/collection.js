import { html, useState, useMemo } from '../lib/preact-htm.js';
import { useApp, FieldInput, Tag, Modal, FIELD_TYPE_LABELS } from './common.js';
import { display, kstToday, addDays, daysBetween, mdLabel, dday } from '../lib/util.js';

const VIEW_LABEL = { table: '표', board: '보드', calendar: '캘린더', timeline: '타임라인', list: '리스트', gallery: '갤러리' };
const VIEW_ICON = { table: '▦', board: '▥', calendar: '📅', timeline: '▬', list: '☰', gallery: '▣' };

function applyView(items, col, view) {
  let out = [...items];
  for (const f of view?.config?.filter || []) {
    out = out.filter((it) => {
      const v = it.props?.[f.field];
      const s = Array.isArray(v) ? v.join(',') : String(v ?? '');
      switch (f.op) {
        case 'neq': return s !== String(f.value);
        case 'contains': return s.includes(String(f.value));
        case 'empty': return !s;
        case 'not_empty': return Boolean(s);
        default: return Array.isArray(v) ? v.includes(f.value) : s === String(f.value);
      }
    });
  }
  const sorts = view?.config?.sort || [];
  if (sorts.length) {
    out.sort((a, b) => {
      for (const s of sorts) {
        const av = a.props?.[s.field]; const bv = b.props?.[s.field];
        const as = typeof av === 'object' && av ? av.start || JSON.stringify(av) : av ?? '';
        const bs = typeof bv === 'object' && bv ? bv.start || JSON.stringify(bv) : bv ?? '';
        if (as === bs) continue;
        if (as === '' || as === null) return 1;
        if (bs === '' || bs === null) return -1;
        return (as < bs ? -1 : 1) * (s.dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  return out;
}

export function CollectionView({ col, items, onChanged }) {
  const app = useApp();
  const [viewId, setViewId] = useState(col.views?.[0]?.id);
  const [addField, setAddField] = useState(false);
  const view = col.views?.find((v) => v.id === viewId) || col.views?.[0];
  const rows = useMemo(() => applyView(items, col, view), [items, col, view]);
  const members = (app.teamData?.team?.members || []).map((m) => m.name);

  const setValue = async (item, field, value) => {
    await app.runOps([{ op: 'update_node', node: item.id, values: { [field.name]: value } }], `${item.title}: ${field.name} 변경`);
    onChanged();
  };
  const addItem = async (values = {}) => {
    const r = await app.runOps([{ op: 'create_node', type: 'item', parent: col.id, title: '새 항목', values }], `${col.title}에 항목 추가`);
    onChanged();
    return r;
  };
  const addView = async (type) => {
    await app.runOps([{ op: 'create_view', collection: col.id, view: { type } }], `${col.title}에 ${VIEW_LABEL[type]} 뷰 추가`);
    onChanged();
  };

  return html`<div>
    <div class="views">
      ${(col.views || []).map((v) => html`<div class="vt ${v.id === view?.id ? 'on' : ''}" onClick=${() => setViewId(v.id)}>${VIEW_ICON[v.type] || ''} ${v.name}</div>`)}
      <details style="position:relative;margin-left:4px">
        <summary class="btn sm ghost" style="list-style:none">+ 뷰</summary>
        <div class="card" style="position:absolute;z-index:20;padding:4px;min-width:140px">
          ${Object.keys(VIEW_LABEL).filter((t) => t !== 'gallery').map((t) => html`<div class="nav" onClick=${(e) => { e.currentTarget.closest('details').open = false; addView(t); }}>${VIEW_ICON[t]} ${VIEW_LABEL[t]}</div>`)}
        </div>
      </details>
      <span class="grow"></span>
      <span class="small faint">${rows.length}개</span>
      <button class="btn sm ghost" onClick=${() => setAddField(true)}>+ 필드</button>
      <button class="btn sm primary" onClick=${() => addItem()}>새 항목</button>
    </div>
    ${view?.type === 'board' ? html`<${Board} col=${col} view=${view} rows=${rows} setValue=${setValue} addItem=${addItem} />`
      : view?.type === 'calendar' ? html`<${Calendar} col=${col} view=${view} rows=${rows} />`
      : view?.type === 'timeline' ? html`<${Timeline} col=${col} view=${view} rows=${rows} />`
      : view?.type === 'list' ? html`<${List} col=${col} rows=${rows} />`
      : html`<${Table} col=${col} rows=${rows} setValue=${setValue} addItem=${addItem} members=${members} onChanged=${onChanged} />`}
    ${addField ? html`<${AddFieldModal} col=${col} onClose=${() => setAddField(false)} onDone=${() => { setAddField(false); onChanged(); }} />` : null}
  </div>`;
}

function Table({ col, rows, setValue, addItem, members, onChanged }) {
  const app = useApp();
  const fields = col.fields || [];
  const rename = async (it, title) => { if (title && title !== it.title) { await app.runOps([{ op: 'update_node', node: it.id, title }], '제목 변경'); onChanged(); } };
  return html`<div class="tbl-wrap"><table class="tbl" data-collection-id=${col.id}>
    <thead><tr><th data-field-name="이름" data-field-type="title">이름</th>${fields.map((f) => html`<th title=${FIELD_TYPE_LABELS[f.type]} data-field-name=${f.name} data-field-type=${f.type}>${f.name}</th>`)}</tr></thead>
    <tbody>
      ${rows.map((it) => html`<tr data-item-id=${it.id}>
        <td class="tt"><div class="row" style="gap:0">
          <input class="cellin" style="font-weight:550" value=${it.title} onBlur=${(e) => rename(it, e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
          <a href=${`#/t/${app.teamId}/n/${it.id}`} title="열기" style="padding:4px 8px">↗</a>
        </div></td>
        ${fields.map((f) => html`<td><${FieldInput} field=${f} value=${it.props?.[f.id]} members=${members} onChange=${(v) => setValue(it, f, v)} /></td>`)}
      </tr>`)}
    </tbody>
  </table>
  <div class="addrow" onClick=${() => addItem()}>+ 새 항목</div></div>`;
}

function Board({ col, view, rows, setValue, addItem }) {
  const app = useApp();
  const field = col.fields?.find((f) => f.id === view.config?.groupBy) || col.fields?.find((f) => ['status', 'select'].includes(f.type));
  const [over, setOver] = useState(null);
  if (!field) return html`<div class="empty">보드로 묶을 선택/상태 필드가 없어요. 프롬프트로 "상태 필드 추가해줘"라고 해보세요.</div>`;
  const groups = [...(field.options || []), ''];
  const cardFields = (col.fields || []).filter((f) => f.id !== field.id && ['select', 'status', 'date', 'person', 'multi_select', 'number'].includes(f.type)).slice(0, 3);
  return html`<div class="board">
    ${groups.map((g) => {
      const list = rows.filter((it) => (it.props?.[field.id] ?? '') === g || (!g && !(field.options || []).includes(it.props?.[field.id])));
      if (!g && !list.length) return null;
      return html`<div class="bcol ${over === g ? 'over' : ''}" onDragOver=${(e) => { e.preventDefault(); setOver(g); }} onDragLeave=${() => setOver(null)}
        onDrop=${(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); const it = rows.find((r) => r.id === id); if (it && (it.props?.[field.id] ?? '') !== g) setValue(it, field, g || null); }}>
        <div class="bcol-h">${g ? html`<${Tag} field=${field} value=${g} />` : html`<span class="faint">값 없음</span>`}<span class="faint small">${list.length}</span></div>
        ${list.map((it) => html`<div class="bcard" draggable="true" onDragStart=${(e) => e.dataTransfer.setData('text/plain', it.id)} onClick=${() => app.go(`#/t/${app.teamId}/n/${it.id}`)}>
          <div class="t">${it.title}</div>
          <div class="row wrap" style="gap:4px">${cardFields.map((f) => {
            const v = it.props?.[f.id];
            if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;
            return ['select', 'status', 'multi_select'].includes(f.type) ? html`<${Tag} field=${f} value=${v} />` : html`<span class="small subtle">${f.type === 'date' ? `${mdLabel(v)} ${dday(v)}` : display(f, v)}</span>`;
          })}</div>
        </div>`)}
        ${g ? html`<div class="addrow small" onClick=${() => addItem({ [field.name]: g })}>+ 추가</div>` : null}
      </div>`;
    })}
  </div>`;
}

function dateOf(it, field) {
  const v = it.props?.[field?.id];
  if (!v) return null;
  return typeof v === 'object' ? v.start : v;
}

function Calendar({ col, view, rows }) {
  const app = useApp();
  const field = col.fields?.find((f) => f.id === view.config?.dateField) || col.fields?.find((f) => ['date', 'daterange'].includes(f.type));
  const statusF = col.fields?.find((f) => f.type === 'status');
  const [month, setMonth] = useState(() => kstToday().slice(0, 7));
  if (!field) return html`<div class="empty">날짜 필드가 없어요.</div>`;
  const first = `${month}-01`;
  const startDow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -startDow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = {};
  for (const it of rows) { const d = dateOf(it, field); if (d) (byDay[d] ||= []).push(it); }
  const shift = (n) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const today = kstToday();
  return html`<div>
    <div class="row mb"><button class="btn sm" onClick=${() => shift(-1)}>‹</button><b>${month.replace('-', '년 ')}월</b><button class="btn sm" onClick=${() => shift(1)}>›</button><button class="btn sm ghost" onClick=${() => setMonth(today.slice(0, 7))}>오늘</button><span class="small faint">기준: ${field.name}</span></div>
    <div class="cal">
      ${['일', '월', '화', '수', '목', '금', '토'].map((d) => html`<div class="dh">${d}</div>`)}
      ${days.map((d) => html`<div class="day ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''}">
        <span class="dn">${Number(d.slice(8))}</span>
        ${(byDay[d] || []).map((it) => html`<span class="ev ${statusF && it.props?.[statusF.id] === '완료' ? 'done' : ''}" title=${it.title} onClick=${() => app.go(`#/t/${app.teamId}/n/${it.id}`)}>${it.title}</span>`)}
      </div>`)}
    </div>
  </div>`;
}

function Timeline({ col, view, rows }) {
  const app = useApp();
  const field = col.fields?.find((f) => f.id === view.config?.dateField) || col.fields?.find((f) => ['date', 'daterange'].includes(f.type));
  const endF = col.fields?.find((f) => f.id === view.config?.endField);
  if (!field) return html`<div class="empty">날짜 필드가 없어요.</div>`;
  const spans = rows.map((it) => {
    const v = it.props?.[field.id];
    const s = typeof v === 'object' && v ? v.start : v;
    const e = typeof v === 'object' && v ? v.end : endF ? it.props?.[endF.id] || s : s;
    return { it, s, e: e || s };
  }).filter((x) => x.s);
  if (!spans.length) return html`<div class="empty">${field.name} 값이 있는 항목이 없어요.</div>`;
  const min = addDays(spans.reduce((a, x) => (x.s < a ? x.s : a), spans[0].s), -3);
  const max = addDays(spans.reduce((a, x) => (x.e > a ? x.e : a), spans[0].e), 7);
  const total = daysBetween(min, max) + 1;
  const px = 22;
  const weeks = Array.from({ length: Math.ceil(total / 7) }, (_, i) => addDays(min, i * 7));
  const today = kstToday();
  return html`<div class="tl"><div style=${`width:${220 + total * px}px;position:relative`}>
    <div class="tl-row" style="height:26px;background:#faf9f7"><div class="tl-label small faint">항목</div>
      ${weeks.map((w) => html`<div class="small faint" style=${`position:absolute;left:${220 + daysBetween(min, w) * px + 4}px`}>${mdLabel(w)}</div>`)}
    </div>
    ${spans.map(({ it, s, e }) => html`<div class="tl-row">
      <div class="tl-label" onClick=${() => app.go(`#/t/${app.teamId}/n/${it.id}`)}>${it.title}</div>
      ${weeks.map((w) => html`<div class="tl-grid" style=${`left:${220 + daysBetween(min, w) * px}px`}></div>`)}
      ${today >= min && today <= max ? html`<div class="tl-grid" style=${`left:${220 + daysBetween(min, today) * px}px;border-left:2px solid var(--bad)`}></div>` : null}
      <div class="tl-bar" style=${`left:${220 + daysBetween(min, s) * px}px;width:${Math.max(1, daysBetween(s, e) + 1) * px - 2}px`} title=${`${s} ~ ${e}`}>${it.title}</div>
    </div>`)}
  </div></div>`;
}

function List({ col, rows }) {
  const app = useApp();
  const tagF = (col.fields || []).filter((f) => ['status', 'select', 'date'].includes(f.type)).slice(0, 3);
  return html`<div>${rows.map((it) => html`<div class="nav" style="padding:8px" onClick=${() => app.go(`#/t/${app.teamId}/n/${it.id}`)}>
    <span class="ic">📄</span><span class="grow">${it.title}</span>
    ${tagF.map((f) => (f.type === 'date' ? html`<span class="small faint">${display(f, it.props?.[f.id])}</span>` : html`<${Tag} field=${f} value=${it.props?.[f.id]} />`))}
  </div>`)}${rows.length ? null : html`<div class="empty">항목이 없어요</div>`}</div>`;
}

function AddFieldModal({ col, onClose, onDone }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const save = async () => {
    if (!name.trim()) return;
    await app.runOps([{ op: 'add_field', collection: col.id, field: { name: name.trim(), type, options: options.split(',').map((s) => s.trim()).filter(Boolean) } }], `${col.title}에 ${name} 필드 추가`);
    onDone();
  };
  return html`<${Modal} title="필드 추가" onClose=${onClose}>
    <div class="col">
      <div><label class="lbl">이름</label><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} autofocus /></div>
      <div><label class="lbl">형식</label><select class="select input" value=${type} onChange=${(e) => setType(e.target.value)}>${Object.entries(FIELD_TYPE_LABELS).filter(([k]) => !['relation', 'json', 'html'].includes(k)).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></div>
      ${['select', 'multi_select', 'status'].includes(type) ? html`<div><label class="lbl">옵션 (쉼표로 구분)</label><input class="input" value=${options} onInput=${(e) => setOptions(e.target.value)} placeholder="할 일, 진행 중, 완료" /></div>` : null}
      <div class="note small">팁: 프롬프트로 "태스크에 예상 시간 숫자 필드 추가해줘"처럼 말해도 돼요.</div>
      <div class="row"><span class="grow"></span><button class="btn" onClick=${onClose}>취소</button><button class="btn primary" onClick=${save}>추가</button></div>
    </div>
  <//>`;
}
