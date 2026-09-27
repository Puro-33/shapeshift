// Team/project scaffolding, deliverable sync (P5/P6), activity logging (S3).
import { newId, markdownToBlocks } from '../core/model.js';
import { OpError, HANDLERS } from '../core/ops.js';
import { makeField } from '../core/values.js';
import { latestSeason, stageForDate } from './season.js';

export const DELIVERABLE_FIELDS = () => [
  makeField({ name: '종류', type: 'select', options: ['주간보고', '아티클', '산출물', '발표자료', '깃허브', '킥오프'] }),
  makeField({ name: '상태', type: 'status', options: ['시작 전', '진행 중', '완료'] }),
  makeField({ name: 'D-day', type: 'date' }),
  makeField({ name: '단계', type: 'select', options: ['킥오프', '1단계', '2단계', '최종', '1차발표', '2차 발표'] }),
  makeField({ name: '차수', type: 'number' }),
  makeField({ name: '담당', type: 'person' }),
  makeField({ name: '제출일', type: 'date' }),
];

export async function findSys(store, teamId, sys) {
  const hits = (await store.list('node', { teamId, sys })).filter((n) => !n.deleted);
  return hits[0] || null;
}

export function fieldByName(col, name) {
  return (col?.fields || []).find((f) => f.name === name) || null;
}

export function today(ctx) {
  return new Date(ctx.now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST date
}

async function mkCollection(ctx, { parent, teamId, title, icon, sys, fields, views }) {
  const col = {
    id: newId('n'), type: 'collection', teamId, parentId: parent, title, icon, sys,
    props: {}, content: [], fields, views: [], sortKey: await ctx.nextSortKey(parent), createdBy: ctx.user?.id || 'system', deleted: false,
  };
  const fid = (name) => col.fields.find((f) => f.name === name)?.id;
  col.views = views.map((v) => ({ id: newId('v'), type: v.type, name: v.name, config: Object.fromEntries(Object.entries(v.config || {}).map(([k, val]) => [k, k === 'sort' ? val.map((s) => ({ field: fid(s.field), dir: s.dir })) : fid(val)])) }));
  await ctx.save('node', col);
  ctx.created.push(col.id);
  return col;
}

export const teamMacros = {
  async create_team(op, ctx) {
    if (!op.name) throw new OpError('create_team needs name (팀명)');
    const season = op.season ? await ctx.store.get('season', op.season) : await latestSeason(ctx.store);
    const teamId = newId('team');
    const members = (op.members || []).map((m) => (typeof m === 'string' ? { name: m.replace(/\(PM\)/i, '').trim(), role: /\(PM\)/i.test(m) ? 'pm' : 'member' } : { name: m.name, role: m.role === 'pm' ? 'pm' : 'member' }));
    if (ctx.user && !members.some((m) => m.name === ctx.user.name)) members.unshift({ name: ctx.user.name, role: members.some((m) => m.role === 'pm') ? 'member' : 'pm' });
    for (const m of members) if (ctx.user && m.name === ctx.user.name) m.userId = ctx.user.id;
    const team = {
      id: teamId, name: op.name, projectTitle: op.project || op.projectTitle || op.name, topic: op.topic || op.project || '',
      seasonId: season?.id || null, members, discordWebhook: null,
    };
    await ctx.save('team', team);
    ctx.created.push(team.id);
    if (ctx.user) {
      const me = members.find((m) => m.userId === ctx.user.id);
      await ctx.save('membership', { id: `${teamId}:${ctx.user.id}`, teamId, userId: ctx.user.id, role: me?.role || 'pm' });
    }
    ctx.teamId = teamId;
    if (ctx.role !== 'admin') ctx.role = 'pm'; // creator runs the rest of the plan as the new team's PM

    const project = {
      id: newId('n'), type: 'page', teamId, parentId: null, title: team.projectTitle, icon: op.icon || '🛡️', sys: 'project',
      props: {}, sortKey: await ctx.nextSortKey(null), createdBy: ctx.user?.id || 'system', deleted: false,
      content: markdownToBlocks([
        '## 프로젝트 개요',
        `프로젝트 주제 : ${team.topic || team.projectTitle}`,
        `팀 이름 : ${team.name}`,
        `팀 구성원 : ${members.map((m) => (m.role === 'pm' ? `${m.name}(PM)` : m.name)).join(', ')}`,
        ...(op.stages?.length ? ['## 단계', ...op.stages.map((s) => `- ${s}`)] : []),
        ...(op.description ? ['## 설명', op.description] : []),
      ].join('\n')),
    };
    await ctx.save('node', project);
    ctx.created.push(project.id);

    const deliverables = await mkCollection(ctx, {
      parent: project.id, teamId, title: '산출물', icon: '📦', sys: 'deliverables', fields: DELIVERABLE_FIELDS(),
      views: [
        { type: 'table', name: '전체', config: { sort: [{ field: 'D-day', dir: 'asc' }] } },
        { type: 'board', name: '상태별', config: { groupBy: '상태' } },
        { type: 'calendar', name: '캘린더', config: { dateField: 'D-day' } },
      ],
    });
    const activity = await mkCollection(ctx, {
      parent: project.id, teamId, title: '활동 로그', icon: '📝', sys: 'activity',
      fields: [makeField({ name: '날짜', type: 'date' }), makeField({ name: '팀원', type: 'person' }), makeField({ name: '태그', type: 'multi_select', options: ['문제풀이', '회의', '개념 공부', '점검', '개발', '발표'] }), makeField({ name: '링크', type: 'url' })],
      views: [
        { type: 'table', name: '최신순', config: { sort: [{ field: '날짜', dir: 'desc' }] } },
        { type: 'calendar', name: '캘린더', config: { dateField: '날짜' } },
      ],
    });
    const tasks = await mkCollection(ctx, {
      parent: project.id, teamId, title: '태스크', icon: '✅', sys: 'tasks',
      fields: [makeField({ name: '상태', type: 'status', options: ['할 일', '진행 중', '완료'] }), makeField({ name: '담당', type: 'person' }), makeField({ name: '단계', type: 'select', options: ['킥오프', '1단계', '2단계', '최종'] }), makeField({ name: '마감', type: 'date' })],
      views: [
        { type: 'board', name: '보드', config: { groupBy: '상태' } },
        { type: 'table', name: '표', config: { sort: [{ field: '마감', dir: 'asc' }] } },
        { type: 'timeline', name: '타임라인', config: { dateField: '마감' } },
      ],
    });
    for (const [ref, id] of [['$team', teamId], ['$project', project.id], ['$deliverables', deliverables.id], ['$activity', activity.id], ['$tasks', tasks.id]]) ctx.temp.set(ref, id);
    if (op.ref) ctx.temp.set(op.ref.startsWith('$') ? op.ref : `$${op.ref}`, project.id);

    const synced = season ? await syncDeliverables(ctx, team, season, deliverables) : 0;
    return { id: project.id, teamId, deliverables: synced };
  },

  async sync_deliverables(op, ctx) {
    const team = await ctx.store.get('team', op.team || ctx.teamId);
    if (!team) throw new OpError('team not found');
    const season = team.seasonId ? await ctx.store.get('season', team.seasonId) : await latestSeason(ctx.store);
    if (!season) throw new OpError('no season yet: create a season first');
    const col = await findSys(ctx.store, team.id, 'deliverables');
    if (!col) throw new OpError('deliverables collection missing (sys=deliverables)');
    const n = await syncDeliverables(ctx, team, season, col);
    return { id: col.id, created: n };
  },

  async log_activity(op, ctx) {
    const teamId = op.team || ctx.teamId;
    if (!teamId) throw new OpError('log_activity needs a team context');
    const col = await findSys(ctx.store, teamId, 'activity');
    if (!col) throw new OpError('activity collection missing (sys=activity)');
    const text = String(op.text || '').trim();
    if (!text) throw new OpError('log_activity needs text');
    const values = {
      날짜: op.date || (op.dayOffset ? new Date(ctx.now.getTime() + 9 * 3600 * 1000 + Number(op.dayOffset) * 86400000).toISOString().slice(0, 10) : today(ctx)),
      팀원: op.member ? [].concat(op.member) : (ctx.user ? [ctx.user.name] : []),
    };
    if (op.tags?.length) values['태그'] = op.tags;
    if (op.link) values['링크'] = op.link;
    const title = op.title || (text.length > 60 ? `${text.slice(0, 57)}...` : text);
    return HANDLERS.create_node({ type: 'item', parent: col.id, title, values, content: [{ type: 'p', text }], ref: op.ref }, ctx);
  },
};

export async function syncDeliverables(ctx, team, season, col) {
  const items = (await ctx.children(col.id));
  const f = (n) => fieldByName(col, n);
  const has = (kind, round, title) => items.some((it) => it.props?.[f('종류')?.id] === kind && (round === undefined || it.props?.[f('차수')?.id] === round) || it.title === title);
  let sk = await ctx.nextSortKey(col.id);
  let n = 0;
  const add = async (title, kind, due, round, stage) => {
    if (has(kind, round, title)) return;
    const props = { [f('종류').id]: kind, [f('상태').id]: '시작 전', [f('D-day').id]: due || null, [f('단계').id]: stage };
    if (round !== undefined) props[f('차수').id] = round;
    const item = { id: newId('n'), type: 'item', teamId: team.id, parentId: col.id, title, props, content: [], sortKey: sk++, createdBy: 'system', deleted: false };
    await ctx.save('node', item);
    ctx.created.push(item.id);
    items.push(item);
    n++;
  };
  let kickoffIdx = 0;
  for (const m of season.milestones || []) {
    if (m.kind === 'kickoff') {
      kickoffIdx++;
      await add(m.title || (kickoffIdx === 1 ? '킥오프 보고서' : '킥오프 보고서 (수정본)'), '킥오프', m.due, 100 + kickoffIdx, '킥오프');
    } else if (m.kind === 'weekly') {
      const stage = stageForDate(m.due, season);
      await add(`${m.round}차 주간보고서`, '주간보고', m.due, m.round, stage);
      if ((m.deliverables || []).includes('아티클')) await add(`${m.round}주차 아티클`, '아티클', m.due, m.round, stage);
    } else if (m.kind === 'final') {
      await add('최종 발표자료', '발표자료', m.due, m.round, '최종');
    }
  }
  return n;
}
