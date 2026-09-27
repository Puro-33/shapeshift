// Rule-based quick commands (no AI). Covers the core club workflows directly on the server;
// anything smarter is done by the user's own AI via Markdown or operation JSON.

const has = (s, re) => re.test(s);

export function heuristicPlan(text, context = {}) {
  const t = String(text || '').trim();
  const attachment = context.attachment;
  const cols = (context.nodes || []).filter((n) => n.type === 'collection');
  const findCol = (name) => cols.find((c) => t.includes(c.title)) || cols.find((c) => c.title === name);

  if (attachment || /^\s*</.test(t) || t.length > 1500) {
    const ask = attachment ? t : t.slice(0, 200); // what the user asked for, not the pasted body
    const head = String(attachment || t).slice(0, 4000);
    const prowlerData = (/^\s*[[{]/.test(head) && /(status_code|CheckID|event_code)/.test(head)) || /CHECK_ID[;,]|[;,]STATUS[;,]/.test(head) || /<t[hd][^>]*>\s*Check\s*ID/i.test(head);
    const kind = /아티클|article|hub/i.test(ask) ? 'article'
      : prowlerData || /prowler\s*(결과|리포트|스캔|report|scan)/i.test(ask) ? 'prowler'
      : /codex|checkpoint|entry\s*\d+|\bCI\b|개발\s*로그/i.test(ask.slice(0, 300)) ? 'devlog' : 'report';
    if (/안내|제출 일정|최소 요구사항|차수/.test(t) && context.role === 'admin') {
      return { intent: 'admin', summary: '안내문으로 시즌 일정과 규칙을 만들어요', ops: [{ op: 'create_season', sourceText: attachment || t }] };
    }
    return { intent: 'ingest', summary: `붙여넣은 내용을 ${kind}(으)로 가져와요`, ops: [{ op: 'ingest_content', kind, useAttachment: Boolean(attachment), ...(attachment ? {} : { markdown: t }) }] };
  }

  let m;
  if ((m = t.match(/(\d+)\s*차\s*주간\s*보고/)) || has(t, /주간\s*보고서?.*(만들|작성|초안|써)/)) {
    return { intent: 'draft', summary: '활동 로그와 지난 차주 계획으로 주간보고서 초안을 만들어요', ops: [{ op: 'draft_weekly_report', ...(m ? { round: Number(m[1]) } : {}) }] };
  }
  if (has(t, /팀\s*(을|를)?\s*(만들|생성)/) || has(t, /팀명/)) {
    const name = t.match(/팀명\s*[:은는]?\s*([^\s,.]+)/)?.[1] || '새 팀';
    const pm = t.match(/PM\s*[:은는]?\s*([가-힣A-Za-z]+)/)?.[1];
    const membersRaw = t.match(/팀원\s*[:은는]?\s*([가-힣A-Za-z\s,]+)/)?.[1] || '';
    const members = membersRaw.split(/[\s,]+/).filter((x) => x && x.length >= 2 && !/만들|하고|으로|단계/.test(x));
    const project = t.match(/^(.+?)\s*팀\s*(을|를)?\s*(만들|생성)/)?.[1]?.trim() || name;
    return {
      intent: 'build', summary: `${name} 팀과 프로젝트 구조를 만들어요`,
      ops: [{ op: 'create_team', name, project, topic: project, members: [...(pm ? [{ name: pm, role: 'pm' }] : []), ...members.filter((x) => x !== pm).map((x) => ({ name: x, role: 'member' }))] }],
    };
  }
  if ((m = t.match(/(.+?)에\s*['"]?(.+?)['"]?\s*(숫자|날짜|선택|체크|텍스트|사람|URL)?\s*(필드|속성|열|컬럼)\s*(을|를)?\s*추가/))) {
    const col = findCol(m[1].trim());
    const type = { 숫자: 'number', 날짜: 'date', 선택: 'select', 체크: 'checkbox', 사람: 'person', URL: 'url' }[m[3]] || 'text';
    if (col) return { intent: 'build', summary: `${col.title}에 ${m[2]} 필드를 추가해요`, ops: [{ op: 'add_field', collection: col.id, field: { name: m[2].trim(), type } }] };
  }
  if (has(t, /(칸반|보드|캘린더|달력|타임라인)\s*(뷰|로|으로)/)) {
    const col = findCol('');
    const type = /칸반|보드/.test(t) ? 'board' : /캘린더|달력/.test(t) ? 'calendar' : 'timeline';
    if (col) return { intent: 'build', summary: `${col.title}에 ${type} 뷰를 추가해요`, ops: [{ op: 'create_view', collection: col.id, view: { type } }] };
  }
  if (has(t, /\?$|뭐야|어때|알려줘|누가|몇|현황/)) {
    return { intent: 'ask', summary: '질문', reply: 'Shapeshift에는 내장 AI가 없어요. 질문은 개인 AI에게 맡겨 주세요: "내 AI에게 맡기기"로 자료를 복사하거나, Aside 같은 AI 브라우저에서 이 페이지의 "AI용 보기"를 열어 물어보면 돼요. (활동 기록, 주간보고서 초안, 팀 생성, 필드/뷰 추가는 빠른 명령으로 바로 처리돼요)', ops: [] };
  }
  const tags = [];
  if (/풀었|풀이|문제/.test(t)) tags.push('문제풀이');
  if (/회의|미팅/.test(t)) tags.push('회의');
  if (/공부|개념|정리/.test(t)) tags.push('개념 공부');
  if (/prowler|점검|스캔/i.test(t)) tags.push('점검');
  if (/구현|코드|커밋|배포|CI/i.test(t)) tags.push('개발');
  const dayOffset = /^(어제|어젯밤)/.test(t) ? -1 : /^그제|^그저께/.test(t) ? -2 : 0;
  const body = t.replace(/^(오늘|어제|어젯밤|그제|그저께)\s*(은|는)?\s*/, '');
  const parts = body.split(/(?:,|\.|그리고|하고\s)/).map((s) => s.trim()).filter((s) => s.length > 3);
  const items = parts.length > 1 && parts.length <= 5 ? parts : [body || t];
  return { intent: 'log', summary: `활동 ${items.length}건을 기록해요`, ops: items.map((x) => ({ op: 'log_activity', text: x, tags, ...(dayOffset ? { dayOffset } : {}) })) };
}
