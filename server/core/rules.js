// Rule engine: club rules as data, evaluated against reports/articles/exports.

export const SSG_DEFAULT_RULES = [
  {
    id: 'r_weekly_sections', kind: 'required_sections', appliesTo: 'weekly_report', label: '주간보고서 최소 요구사항',
    sections: [
      { key: 'goals', label: '이번 주 목표 & 성공기준', keywords: ['이번 주 목표', '성공기준', '목표'], minItems: 1 },
      { key: 'planned_vs_done', label: '계획 대비 실적 (Planned vs Done)', keywords: ['계획 대비 실적', 'planned vs done'], minItems: 1 },
      { key: 'insights', label: '핵심 인사이트 1~3개', keywords: ['핵심 인사이트', '인사이트'], minItems: 1, maxItems: 3 },
      { key: 'ask', label: '도움 필요(Ask) 1~2개', keywords: ['도움 필요', 'ask'], minItems: 1, maxItems: 2 },
      { key: 'next', label: '다음 주 실행 계획(Next 3~5 To-Dos)', keywords: ['차주 계획', '다음 주', 'next'], minItems: 3, maxItems: 5, level: 'warn' },
      { key: 'photo', label: '회의 사진(증빙)', keywords: ['회의 사진', '증빙'], requireImage: true },
    ],
  },
  { id: 'r_weekly_submit_date', kind: 'required_line', appliesTo: 'weekly_report', label: '제출 날짜 기재', prefix: '주간 보고서 제출 날짜' },
  { id: 'r_article_title', kind: 'title_pattern', appliesTo: 'article', label: '아티클 제목에 [팀명] 표기', template: '[{team}]' },
  { id: 'r_article_mentions', kind: 'required_mentions', appliesTo: 'article', label: '본문에 팀원 이름 / 주제', items: [{ label: '팀원 이름', anyOf: '{members}' }, { label: '주제', anyOf: '{topic}' }] },
  { id: 'r_file_kickoff', kind: 'filename', appliesTo: 'kickoff', label: '킥오프 파일명', template: '(킥오프)SSG_팀프로젝트_{team}' },
  { id: 'r_file_monthly', kind: 'filename', appliesTo: 'presentation', label: '월 발표자료 파일명', template: '({month}월발표자료)SSG_팀프로젝트_{team}' },
  { id: 'r_file_final', kind: 'filename', appliesTo: 'final', label: '최종 발표자료 파일명', template: '(최종발표자료)SSG_팀프로젝트_{team}' },
  { id: 'r_file_weekly', kind: 'filename', appliesTo: 'weekly_report', label: '주간보고 파일명', template: '({round}차주간보고서)SSG_팀프로젝트_{team}', level: 'info' },
  { id: 'r_submitter', kind: 'submitter_role', appliesTo: 'deliverable', label: '제출자는 팀 PM', role: 'pm' },
  { id: 'r_participation', kind: 'participation_cap', appliesTo: 'kickoff', label: '팀원별 참여율 최대 100%', max: 100 },
];

const HEADINGS = new Set(['h1', 'h2', 'h3']);

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function sectionOf(blocks, keywords) {
  const idx = blocks.findIndex((b) => HEADINGS.has(b.type) && keywords.some((k) => norm(b.text).includes(norm(k))));
  if (idx < 0) return null;
  const level = Number(blocks[idx].type.slice(1));
  const body = [];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (HEADINGS.has(b.type) && Number(b.type.slice(1)) <= level) break;
    body.push(b);
  }
  return { heading: blocks[idx], body };
}

function meaningful(b) {
  if (b.type === 'table') return (b.rows || []).slice(1).some((r) => r.slice(1).some((c) => String(c).trim()));
  if (b.type === 'image' || b.type === 'html') return true;
  if (b.type === 'divider') return false;
  const t = norm(b.text);
  return Boolean(t) && !['(사진 첨부)', '-', 'tbd', '작성 예정', '없음'].includes(t) && !/^\(.*(입력|작성 필요|없어요).*\)$/.test(t);
}

function countItems(body) {
  const list = body.filter((b) => ['bullet', 'number', 'todo'].includes(b.type) && !b.indent && meaningful(b));
  if (list.length) return list.length;
  const tables = body.filter((b) => b.type === 'table' && meaningful(b));
  if (tables.length) return tables.reduce((n, t) => n + Math.max(0, (t.rows || []).length - 1), 0);
  return body.filter(meaningful).length;
}

export function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

/**
 * target: { kind, title, blocks, team:{name, members:[{name}], topic}, vars:{round, month}, filename?, submitter? }
 */
export function evaluateRules(rules, target) {
  const checks = [];
  const blocks = target.blocks || [];
  const team = target.team || {};
  const vars = { team: team.name || '', topic: team.topic || '', ...(target.vars || {}) };
  for (const rule of rules || []) {
    const applies = rule.appliesTo === target.kind || (rule.appliesTo === 'deliverable' && target.isDeliverable);
    if (!applies) continue;
    const level = rule.level || 'error';
    switch (rule.kind) {
      case 'required_sections':
        for (const s of rule.sections) {
          const sec = sectionOf(blocks, s.keywords);
          const lv = s.level || level;
          if (!sec) { checks.push({ ruleId: rule.id, key: s.key, label: s.label, level: lv, passed: false, detail: '섹션이 없어요' }); continue; }
          if (s.requireImage) {
            const ok = sec.body.some((b) => b.type === 'image');
            checks.push({ ruleId: rule.id, key: s.key, label: s.label, level: lv, passed: ok, detail: ok ? '첨부됨' : '사진이 첨부되지 않았어요' });
            continue;
          }
          const n = countItems(sec.body);
          let passed = n >= (s.minItems || 1);
          let detail = passed ? `${n}개 작성됨` : `내용이 비어 있어요 (${n}/${s.minItems || 1})`;
          if (passed && s.maxItems && n > s.maxItems) { passed = false; detail = `${n}개: 권장 최대 ${s.maxItems}개를 넘었어요`; }
          checks.push({ ruleId: rule.id, key: s.key, label: s.label, level: passed ? lv : (n > 0 ? 'warn' : lv), passed, detail });
        }
        break;
      case 'required_line': {
        const line = blocks.find((b) => norm(b.text).startsWith(norm(rule.prefix)));
        const value = line ? String(line.text).split(/[:：]/).slice(1).join(':').trim() : '';
        checks.push({ ruleId: rule.id, label: rule.label, level, passed: Boolean(value), detail: line ? (value ? value : '값이 비어 있어요') : '항목이 없어요' });
        break;
      }
      case 'title_pattern': {
        const expected = fillTemplate(rule.template, vars);
        const ok = String(target.title || '').includes(expected);
        checks.push({ ruleId: rule.id, label: rule.label, level, passed: ok, detail: ok ? expected : `제목에 "${expected}"가 없어요`, fix: ok ? null : { title: `${expected} ${String(target.title || '').replace(/^\[[^\]]*\]\s*/, '')}`.trim() } });
        break;
      }
      case 'required_mentions': {
        const text = norm([target.title, ...blocks.map((b) => b.text || (b.rows || []).flat().join(' '))].join(' '));
        for (const item of rule.items) {
          let candidates = [];
          if (item.anyOf === '{members}') candidates = (team.members || []).map((m) => m.name);
          else if (item.anyOf === '{topic}') candidates = [team.topic, team.projectTitle].filter(Boolean);
          else candidates = [fillTemplate(item.anyOf, vars)];
          const ok = candidates.some((c) => c && text.includes(norm(c)));
          checks.push({ ruleId: rule.id, label: `${rule.label}: ${item.label}`, level, passed: ok, detail: ok ? '포함됨' : `${item.label}이(가) 본문에 없어요` });
        }
        break;
      }
      case 'filename': {
        const expected = fillTemplate(rule.template, vars);
        const ok = target.filename ? target.filename.startsWith(expected) : true;
        checks.push({ ruleId: rule.id, label: rule.label, level: rule.level || 'info', passed: ok, detail: expected, expected });
        break;
      }
      case 'submitter_role':
        if (target.submitter) {
          const ok = target.submitter.role === rule.role || target.submitter.role === 'admin';
          checks.push({ ruleId: rule.id, label: rule.label, level: 'warn', passed: ok, detail: ok ? '확인됨' : 'PM이 제출해야 해요' });
        }
        break;
      case 'participation_cap': {
        const bad = (target.participation || []).filter((p) => Number(p.value) > rule.max);
        checks.push({ ruleId: rule.id, label: rule.label, level, passed: !bad.length, detail: bad.length ? bad.map((b) => `${b.name} ${b.value}%`).join(', ') : '확인됨' });
        break;
      }
      default:
        break;
    }
  }
  const failed = checks.filter((c) => !c.passed && c.level !== 'info');
  return { checks, passed: failed.length === 0, errors: failed.filter((c) => c.level === 'error').length, warnings: failed.filter((c) => c.level === 'warn').length };
}

export function expectedFilename(rules, kind, vars) {
  const r = (rules || []).find((x) => x.kind === 'filename' && x.appliesTo === kind);
  return r ? fillTemplate(r.template, vars) : null;
}
