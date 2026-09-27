// fetch wrapper: JSON, CSRF header, friendly errors, cold-start tolerance.
export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body, timeout = 120000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'x-shapeshift': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, e.name === 'AbortError' ? '응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.' : '서버에 연결할 수 없어요 (무료 서버가 깨어나는 중일 수 있어요)');
  } finally {
    clearTimeout(t);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `요청 실패 (${res.status})`, data);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE', body: {} });
