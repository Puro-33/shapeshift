// Field value coercion. Flexible on input (AI and humans are messy), strict on output.
import { FIELD_TYPES, newId } from './model.js';

export function makeField(spec = {}) {
  const type = FIELD_TYPES.includes(spec.type) ? spec.type : 'text';
  const f = { id: spec.id || newId('f'), name: String(spec.name || 'Untitled').trim(), type };
  if (['select', 'multi_select', 'status'].includes(type)) {
    f.options = uniq((spec.options || []).map((o) => (typeof o === 'string' ? o : o?.value ?? o?.name)).filter(Boolean).map(String));
  }
  if (type === 'relation' && spec.target) f.target = String(spec.target);
  return f;
}

export function coerce(field, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  switch (field.type) {
    case 'number':
    case 'percent': {
      if (typeof value === 'number') return value;
      const n = parseFloat(String(value).replace(/[,%\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      return ['true', 'yes', 'y', '1', 'o', '완료', 'done', 'checked'].includes(String(value).trim().toLowerCase());
    case 'select':
    case 'status': {
      const s = Array.isArray(value) ? String(value[0] ?? '') : String(value);
      const hit = (field.options || []).find((o) => o.toLowerCase() === s.trim().toLowerCase());
      if (hit) return hit;
      field.options = [...(field.options || []), s.trim()]; // grow options on demand
      return s.trim();
    }
    case 'multi_select':
    case 'person': {
      const arr = Array.isArray(value) ? value : String(value).split(/[,/·]/);
      const out = uniq(arr.map((x) => String(x).trim()).filter(Boolean));
      if (field.type === 'multi_select') {
        for (const v of out) if (!(field.options || []).includes(v)) field.options = [...(field.options || []), v];
      }
      return out;
    }
    case 'date':
      return toDate(value);
    case 'daterange': {
      if (typeof value === 'object' && !Array.isArray(value)) return { start: toDate(value.start), end: toDate(value.end ?? value.start) };
      const parts = String(value).split(/\s*(?:~|→|->|to)\s*/);
      return { start: toDate(parts[0]), end: toDate(parts[1] ?? parts[0]) };
    }
    case 'relation':
      return uniq((Array.isArray(value) ? value : [value]).map(String).filter(Boolean));
    case 'json':
      return value;
    default:
      return typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function displayValue(field, v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (field?.type === 'daterange' && typeof v === 'object') return `${v.start || ''} ~ ${v.end || ''}`;
  if (field?.type === 'percent') return `${v}%`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function uniq(a) { return [...new Set(a)]; }
