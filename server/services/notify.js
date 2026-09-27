// Discord webhooks (free; Render free instances cannot send SMTP) + deadline reminder cron.
import { addDays, latestSeason } from './season.js';
import { findSys, fieldByName } from './teams.js';

export async function sendDiscord(webhook, content, { fetchImpl = fetch } = {}) {
  if (!webhook || !/^https:\/\/(?:discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//.test(webhook)) return { skipped: true };
  const res = await fetchImpl(webhook, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Shapeshift', content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }),
  });
  return { ok: res.ok, status: res.status };
}

function kst(now) { return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

export async function runReminders(store, { now = new Date(), baseUrl = '', fetchImpl = fetch } = {}) {
  const today = kst(now);
  const teams = await store.list('team', {});
  const sent = [];
  for (const team of teams) {
    if (!team.discordWebhook) continue;
    const season = team.seasonId ? await store.get('season', team.seasonId) : await latestSeason(store);
    const col = await findSys(store, team.id, 'deliverables');
    const items = col ? (await store.list('node', { parentId: col.id })).filter((n) => !n.deleted) : [];
    const fDue = fieldByName(col, 'D-day');
    const fStatus = fieldByName(col, '상태');
    const lines = [];
    for (const [offset, label] of [[2, 'D-2'], [0, 'D-day']]) {
      const target = addDays(today, offset);
      const due = items.filter((it) => it.props?.[fDue?.id] === target && it.props?.[fStatus?.id] !== '완료');
      for (const it of due) {
        const key = `${team.id}:${it.id}:${label}`;
        if (await store.get('cronlog', key)) continue;
        await store.put('cronlog', { id: key, at: now.toISOString() });
        lines.push(`**${label}** ${it.title} (상태: ${it.props?.[fStatus?.id] || '시작 전'}, 마감 ${target} 23:59)`);
      }
    }
    const reqs = (await store.list('request', { teamId: team.id, done: false })).filter((r) => !r.notifiedAt);
    for (const r of reqs.slice(0, 10)) {
      lines.push(`📝 ${r.assignee ? `${r.assignee}님, ` : ''}${r.text}`);
      r.notifiedAt = now.toISOString();
      await store.put('request', r);
    }
    if (!lines.length) continue;
    const msg = `[${team.name}] 오늘의 알림\n${lines.join('\n')}${baseUrl ? `\n${baseUrl}` : ''}`;
    const r = await sendDiscord(team.discordWebhook, msg, { fetchImpl }).catch((e) => ({ error: e.message }));
    sent.push({ team: team.name, lines: lines.length, ...r });
  }
  return { today, sent, season: undefined };
}

export function makeNotifier(store, log = console.log) {
  return async ({ type, teamId, user, summary }) => {
    if (type !== 'applied' || !teamId) return;
    const team = await store.get('team', teamId);
    if (!team?.discordWebhook || !team.settings?.notifyApplied) return;
    await sendDiscord(team.discordWebhook, `🔧 ${user?.name || '누군가'}: ${summary}`).catch((e) => log(`[discord] ${e.message}`));
  };
}
