export const uid = (p = 'b') => `${p}_${Math.random().toString(36).slice(2, 12)}`;

export function kstToday() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

export function dday(due) {
  if (!due) return '';
  const n = daysBetween(kstToday(), due);
  return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function mdLabel(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function optColor(field, value) {
  const opts = field?.options || [];
  const i = Math.max(0, opts.indexOf(value));
  const fixed = { 완료: 1, '진행 중': 2, '시작 전': 6, '할 일': 6, FAIL: 3, 해결됨: 1, critical: 3, high: 3, medium: 2, low: 4 };
  return `c${fixed[value] ?? (i % 6)}`;
}

export function display(field, v) {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (field?.type === 'daterange' && typeof v === 'object') return `${v.start || ''} ~ ${v.end || ''}`;
  if (field?.type === 'percent') return `${v}%`;
  if (field?.type === 'checkbox') return v ? '✔' : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Browser-side HTML -> blocks (DOMParser is more faithful than the server fallback).
export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template,iframe,object,embed').forEach((n) => n.remove());
  const blocks = [];
  const inline = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1) {
        const t = n.tagName.toLowerCase();
        if (['ul', 'ol', 'table'].includes(t)) continue;
        const inner = inline(n);
        if (t === 'strong' || t === 'b') s += inner.trim() ? `**${inner}**` : inner;
        else if (t === 'code') s += `\`${inner}\``;
        else if (t === 'a' && /^https?:/.test(n.getAttribute('href') || '')) s += `[${inner}](${n.getAttribute('href')})`;
        else if (t === 'br') s += '\n';
        else s += inner;
      }
    }
    return s;
  };
  const walk = (el, indent = 0) => {
    for (const n of el.children) {
      const t = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(t)) blocks.push({ type: `h${Math.min(3, Number(t[1]))}`, text: n.textContent.trim() });
      else if (t === 'p') { const x = inline(n).trim(); if (x) blocks.push({ type: 'p', text: x }); }
      else if (t === 'pre') blocks.push({ type: 'code', text: n.textContent.replace(/\n$/, '') });
      else if (t === 'blockquote') blocks.push({ type: 'quote', text: n.textContent.trim() });
      else if (t === 'hr') blocks.push({ type: 'divider' });
      else if (t === 'img' && /^(https?:|data:image)/.test(n.getAttribute('src') || '')) blocks.push({ type: 'image', src: n.getAttribute('src'), caption: n.getAttribute('alt') || '' });
      else if (t === 'ul' || t === 'ol') {
        for (const li of n.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const cb = li.querySelector(':scope > input[type=checkbox]');
          blocks.push({ type: cb ? 'todo' : t === 'ol' ? 'number' : 'bullet', text: inline(li).trim(), indent, ...(cb ? { checked: cb.checked || cb.hasAttribute('checked') } : {}) });
          for (const sub of li.querySelectorAll(':scope > ul, :scope > ol')) walk({ children: [sub] }, indent + 1);
        }
      } else if (t === 'table') {
        const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()));
        if (rows.length) blocks.push({ type: 'table', rows });
      } else if (n.children.length && ['div', 'section', 'article', 'main', 'header', 'footer', 'body', 'figure', 'details', 'aside', 'nav'].includes(t)) walk(n, indent);
      else { const x = inline(n).trim(); if (x) blocks.push({ type: 'p', text: x }); }
    }
  };
  walk(doc.body);
  return blocks;
}

export function looksLikeHtml(s) {
  return /<(html|body|div|p|h[1-6]|table|ul|ol|section|article|span|style)[\s>]/i.test(String(s).slice(0, 4000));
}

// Compress photos client-side to WebP so the free DB (0.5GB) lasts the whole term.
export async function compressImage(file, { maxSide = 1600, quality = 0.78 } = {}) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  let q = quality;
  let url = canvas.toDataURL('image/webp', q);
  while (url.length > 400_000 && q > 0.4) { q -= 0.12; url = canvas.toDataURL('image/webp', q); }
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.75);
  return url;
}

export function readFileText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}

export function downloadText(filename, text, type = 'text/html') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
