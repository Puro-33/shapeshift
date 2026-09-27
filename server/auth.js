// Accounts, sessions, invites and API tokens. node:crypto only.
import crypto from 'node:crypto';
import { newId } from './core/model.js';

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const [, s, k] = String(stored || '').split('$');
  if (!s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'));
  const expected = Buffer.from(k, 'base64');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const SESSION_DAYS = 30;
export const COOKIE = 'ss_session';

export class Auth {
  constructor(store, env = process.env) {
    this.store = store;
    this.env = env;
    this.attempts = new Map();
  }

  throttle(key) {
    const now = Date.now();
    const a = (this.attempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (a.length >= 10) throw Object.assign(new Error('시도가 너무 많아요. 10분 뒤에 다시 시도해 주세요.'), { status: 429 });
    a.push(now);
    this.attempts.set(key, a);
  }

  async register({ email, name, password, inviteCode }) {
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('이메일 형식이 올바르지 않아요'), { status: 400 });
    if (name.length < 2) throw Object.assign(new Error('이름을 2자 이상 입력해 주세요'), { status: 400 });
    if (String(password || '').length < 8) throw Object.assign(new Error('비밀번호는 8자 이상이어야 해요'), { status: 400 });
    if ((await this.store.list('user', { email })).length) throw Object.assign(new Error('이미 가입된 이메일이에요'), { status: 409 });
    const isFirst = (await this.store.count('user', {})) === 0;
    const bootstrap = this.env.BOOTSTRAP_ADMIN_EMAIL && this.env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() === email;
    const openSignup = this.env.OPEN_SIGNUP !== 'false';
    let invite = null;
    if (inviteCode) invite = await this.checkInvite(inviteCode);
    if (!isFirst && !bootstrap && !invite && !openSignup) throw Object.assign(new Error('초대 코드가 필요해요'), { status: 403 });
    const user = { id: newId('u'), email, name, passwordHash: await hashPassword(password), isAdmin: Boolean(isFirst || bootstrap) };
    await this.store.put('user', user);
    if (invite) await this.joinTeam(user, invite);
    return user;
  }

  async login({ email, password }) {
    email = String(email || '').trim().toLowerCase();
    this.throttle(`login:${email}`);
    const [user] = await this.store.list('user', { email });
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw Object.assign(new Error('이메일 또는 비밀번호가 맞지 않아요'), { status: 401 });
    return user;
  }

  async createSession(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await this.store.put('session', { id: sha256(token), userId: user.id, expiresAt });
    return { token, expiresAt };
  }

  async destroySession(token) { if (token) await this.store.del('session', sha256(token)); }

  async userFromRequest(req) {
    const authz = req.headers.authorization || '';
    if (authz.startsWith('Bearer ss_')) {
      const tok = await this.store.get('apitoken', sha256(authz.slice(7).trim()));
      if (!tok || tok.revoked) return null;
      tok.lastUsedAt = new Date().toISOString();
      await this.store.put('apitoken', tok);
      if (tok.kind === 'personal') {
        // Personal AI acts as the user (same roles), so it can read and edit everything the user can.
        const user = await this.store.get('user', tok.userId);
        return user ? { ...user, viaToken: tok.name || 'personal' } : null;
      }
      return { id: `token:${tok.id}`, name: tok.name || 'API', isToken: true, tokenTeamId: tok.teamId };
    }
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const s = await this.store.get('session', sha256(token));
    if (!s || s.expiresAt < new Date().toISOString()) return null;
    const user = await this.store.get('user', s.userId);
    return user ? { ...user, sessionToken: token } : null;
  }

  async createInvite(teamId, role = 'member', createdBy) {
    const code = crypto.randomBytes(6).toString('base64url');
    await this.store.put('invite', { id: code, teamId, role, createdBy, uses: 0, maxUses: 20, expiresAt: new Date(Date.now() + 14 * 86400000).toISOString() });
    return code;
  }

  async checkInvite(code) {
    const inv = await this.store.get('invite', String(code).trim());
    if (!inv || inv.uses >= inv.maxUses || inv.expiresAt < new Date().toISOString()) throw Object.assign(new Error('초대 코드가 유효하지 않아요'), { status: 400 });
    return inv;
  }

  async joinTeam(user, invite) {
    const team = await this.store.get('team', invite.teamId);
    if (!team) throw Object.assign(new Error('팀을 찾을 수 없어요'), { status: 404 });
    const existing = team.members.find((m) => m.userId === user.id) || team.members.find((m) => !m.userId && m.name === user.name);
    let role = invite.role;
    if (existing) { existing.userId = user.id; role = existing.role === 'pm' ? 'pm' : role; }
    else team.members.push({ name: user.name, role, userId: user.id });
    await this.store.put('team', team);
    await this.store.put('membership', { id: `${team.id}:${user.id}`, teamId: team.id, userId: user.id, role });
    invite.uses += 1;
    await this.store.put('invite', invite);
    return team;
  }

  async createPersonalToken(userId, name) {
    const token = `ss_${crypto.randomBytes(24).toString('base64url')}`;
    const doc = { id: sha256(token), kind: 'personal', userId, teamId: null, name: name || 'my-ai', createdBy: userId, revoked: false, prefix: token.slice(0, 7) };
    await this.store.put('apitoken', doc);
    return { token, id: doc.id };
  }

  async createApiToken(teamId, name, createdBy) {
    const token = `ss_${crypto.randomBytes(24).toString('base64url')}`;
    const doc = { id: sha256(token), teamId, name: name || 'ingest', createdBy, revoked: false, prefix: token.slice(0, 7) };
    await this.store.put('apitoken', doc);
    return { token, id: doc.id };
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, expiresAt, secure) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
}
