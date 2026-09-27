// LLM providers over plain fetch (no SDKs). All default choices are free tiers.
// Fallback order is configured by LLM_PROVIDERS. The heuristic planner is always last.

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(`${provider}: ${status} ${message}`.slice(0, 500));
    this.provider = provider;
    this.status = status;
    this.retryable = status === 429 || status >= 500 || status === 0;
  }
}

// Per-provider pacing so free-tier RPM limits are respected across concurrent users.
class Pacer {
  constructor(minIntervalMs) { this.min = minIntervalMs; this.next = 0; this.chain = Promise.resolve(); this.cooldownUntil = 0; }
  async wait() {
    const run = async () => {
      const now = Date.now();
      const at = Math.max(this.next, now);
      this.next = at + this.min;
      if (at > now) await new Promise((r) => setTimeout(r, at - now));
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }
  coolDown(ms) { this.cooldownUntil = Date.now() + ms; }
  get cooling() { return Date.now() < this.cooldownUntil; }
}

async function postJson(provider, url, headers, body, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    throw new ProviderError(provider, 0, e.name === 'AbortError' ? 'timeout' : e.message);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(provider, res.status, text.slice(0, 300));
  try { return JSON.parse(text); } catch { throw new ProviderError(provider, 502, 'invalid JSON from provider'); }
}

export function makeProviders(env = process.env) {
  const list = [];
  const order = (env.LLM_PROVIDERS || 'gemini,groq,openrouter,anthropic').split(',').map((s) => s.trim()).filter(Boolean);
  const defs = {
    gemini: env.GEMINI_API_KEY && {
      name: 'gemini', model: env.GEMINI_MODEL || 'gemini-flash-latest', pacer: new Pacer(Number(env.GEMINI_MIN_INTERVAL_MS || 4500)),
      async complete({ system, messages, maxTokens = 4096 }) {
        const data = await postJson('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, { 'x-goog-api-key': env.GEMINI_API_KEY }, {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: maxTokens },
        });
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (!text) throw new ProviderError('gemini', 502, `empty response (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'unknown'})`);
        return { text, usage: { in: data.usageMetadata?.promptTokenCount || 0, out: data.usageMetadata?.candidatesTokenCount || 0 } };
      },
    },
    groq: env.GROQ_API_KEY && {
      name: 'groq', model: env.GROQ_MODEL || 'openai/gpt-oss-120b', pacer: new Pacer(Number(env.GROQ_MIN_INTERVAL_MS || 2200)),
      async complete({ system, messages, maxTokens = 4096 }) {
        const data = await postJson('groq', 'https://api.groq.com/openai/v1/chat/completions', { authorization: `Bearer ${env.GROQ_API_KEY}` }, {
          model: this.model, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, ...messages],
        });
        return { text: data.choices?.[0]?.message?.content || '', usage: { in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 } };
      },
    },
    openrouter: env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL && {
      name: 'openrouter', model: env.OPENROUTER_MODEL, pacer: new Pacer(4000),
      async complete({ system, messages, maxTokens = 4096 }) {
        const data = await postJson('openrouter', 'https://openrouter.ai/api/v1/chat/completions', { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'x-title': 'Shapeshift' }, {
          model: this.model, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, ...messages],
        });
        return { text: data.choices?.[0]?.message?.content || '', usage: { in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 } };
      },
    },
    anthropic: env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL && {
      name: 'anthropic', model: env.ANTHROPIC_MODEL, pacer: new Pacer(1000),
      async complete({ system, messages, maxTokens = 4096 }) {
        const data = await postJson('anthropic', 'https://api.anthropic.com/v1/messages', { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, {
          model: this.model, system: `${system}\nRespond with a single JSON object only.`, max_tokens: maxTokens, messages,
        });
        return { text: data.content?.map((c) => c.text || '').join('') || '', usage: { in: data.usage?.input_tokens || 0, out: data.usage?.output_tokens || 0 } };
      },
    },
  };
  for (const name of order) if (defs[name]) list.push(defs[name]);
  return list;
}

/** Try providers in order; skip ones cooling down after 429s. */
export async function completeWithFallback(providers, req, { log = () => {} } = {}) {
  const errors = [];
  for (const p of providers) {
    if (p.pacer.cooling) { errors.push(`${p.name}: cooling down`); continue; }
    try {
      await p.pacer.wait();
      const t0 = Date.now();
      const out = await p.complete(req);
      return { ...out, provider: p.name, model: p.model, latencyMs: Date.now() - t0 };
    } catch (e) {
      errors.push(e.message);
      log(`[llm] ${e.message}`);
      if (e.status === 429) p.pacer.coolDown(60_000);
      else if (e.status >= 500 || e.status === 0) p.pacer.coolDown(15_000);
    }
  }
  const err = new Error(`모든 LLM 프로바이더 호출 실패: ${errors.join(' | ') || '설정된 프로바이더 없음'}`);
  err.providerErrors = errors;
  throw err;
}

export function parseJsonLoose(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('LLM이 JSON이 아닌 응답을 반환했어요');
}
