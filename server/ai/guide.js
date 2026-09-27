// Documentation for *personal* AI agents (Aside, ChatGPT, Claude, Codex...).
// Shapeshift never calls an LLM itself: the user's own AI reads these docs and the
// workspace documents, then submits Markdown edits or operation JSON.

export const OP_REFERENCE = `Operations (JSON). Fields in [] are optional. Refer to nodes by id (titles also work if unique).
New nodes may set "ref":"$name" so later ops in the same plan can use "$name".
Values are keyed by field NAME; unknown names are auto-created as text fields.

create_node {type:"page"|"collection"|"item", parent, title, [ref], [icon], [content: markdown], [fields:[{name,type,options}]], [views:[{type,name,groupBy,dateField}]], [values:{field:value}]}
update_node {node, [title], [icon], [values]}
set_content {node, content: markdown, [mode:"replace"|"append"]}
move_node {node, parent}
delete_node {node}                                  (destructive)
add_field {collection, field:{name, type, [options]}}
update_field {collection, field, [name], [type], [options]}   (type change is destructive)
remove_field {collection, field}                    (destructive)
create_view {collection, view:{type:"table"|"board"|"calendar"|"timeline"|"list", name, [groupBy], [dateField], [endField], [sort:[{field,dir}]], [filter:[{field,op,value}]]}}
update_view {collection, view, patch}
delete_view {collection, view}
upsert_item {collection, [match:{field|"title":value}], title, [values], [content]}
update_items {collection, where:{field:value}, values}
link {from:itemId, to:nodeId, field}
convert_node {node, to:"collection"|"page", [strategy:"table"|"headings"|"bullets"]}   (destructive)
merge_collections {from, into, [discriminator]}    (destructive)
Field types: text number percent select multi_select status date daterange person url checkbox relation json html

Club workflow macros
create_team {name, project, topic, members:[{name, role:"pm"|"member"}]}  -> project page + 산출물/활동 로그/태스크 + deadline slots. Temp refs: $project $deliverables $activity $tasks
log_activity {text, [date YYYY-MM-DD], [member], [tags:[문제풀이|회의|개념 공부|점검|개발|발표]], [link]}
draft_weekly_report {[round], [goals], [insights:1-3], [issues], [asks:1-2], [next:3-5], [deviation:{member:reason}]}
   -> builds "N차 주간보고서" from activity logs + last week's 차주 계획; you supply the narrative parts.
ingest_content {kind:"article"|"report"|"devlog"|"prowler", [title], html|markdown|text}
sync_deliverables {}
create_season {name, sourceText|milestones, [rules]} (admin), add_milestone {title, due, kind}, set_rules {sourceText|rules}`;

export const PLAN_FORMAT = 'Submit a plan as JSON: {"summary":"<한 문장 요약>","ops":[ ... ]}\nThe server validates it, shows a diff preview to the human, and only then applies it (undoable).';

export function agentGuide(base = '') {
  return `# Shapeshift: guide for AI agents

Shapeshift is a Notion-like workspace (pages, collections = databases, items = rows, views) for SSG club team projects.
It has **no built-in AI**. You, the user's personal AI, read and edit it on the user's behalf. Every change is previewed as a diff and can be undone.

## 1. Read
| What | URL |
|---|---|
| Workspace outline (start here) | ${base}/t/{teamId}.md |
| One node as Markdown (front matter + body; collections include an item table) | ${base}/p/{id}.md |
| One node as semantic HTML (no JavaScript; data-* attributes on every block/field/row) | ${base}/p/{id} |
| Raw JSON | ${base}/p/{id}.json |
| Search | ${base}/api/search?teamId={teamId}&q=... |
| Teams you can access | ${base}/api/me |

In the HTML view: blocks are \`[data-block-id][data-block-type]\`, collection tables are \`table[data-collection-id]\` with \`th[data-field-name][data-field-type]\` and \`tr[data-item-id]\`, rule checks are in \`section#rule-checks\`, edit forms are \`form#edit-markdown\` and \`form#submit-ops\`.

## 2. Edit (pick one)
**A. Markdown round-trip (easiest).** Take \`/p/{id}.md\`, edit the text (title, front-matter properties, body, or the collection item table), then either
- fill \`form#edit-markdown\` on \`/p/{id}\` and press 미리보기, then 적용, or
- \`POST ${base}/api/nodes/{id}/markdown\` with \`{"markdown":"..."}\` to get a preview (\`id\`, \`plan.diff\`), then \`POST ${base}/api/prompts/{id}/apply\`.
Rules: keep the front matter \`id\`. Table rows with an id update items; rows with an empty id create items; removed rows are NOT deleted. \`<!-- shapeshift:html ... -->\` lines keep embedded HTML reports; deleting that line deletes the report.

**B. Operation plan (structure changes).** \`POST ${base}/api/prompts\` with \`{"teamId":"...","ops":[...],"summary":"..."}\` (or \`form#submit-ops\` on \`/p/{id}\`). The response has \`plan.diff\`; apply with \`POST ${base}/api/prompts/{id}/apply\`. Undo with \`POST ${base}/api/oplog/{oplogId}/undo\`.

**C. MCP.** \`${base}/mcp\` (JSON-RPC 2.0 over HTTP POST, \`Authorization: Bearer ss_...\` personal token) exposes tools: list_teams, workspace_outline, read_node, search, validate, preview_ops, apply_ops, edit_markdown, quick_command, undo.

Auth: the browser session cookie (AI browsers) or a personal token (팀 설정 > 개인 AI 연결). Non-GET \`/api\` calls made with a browser session also need the header \`x-shapeshift: 1\`.

## 3. Club rules to respect
- 주간보고서 must contain: 이번 주 목표 & 성공기준 / 계획 대비 실적 / 핵심 인사이트 1~3 / 도움 필요(Ask) 1~2 / 다음 주 실행 계획 3~5 / 회의 사진. See \`section#rule-checks\` or the \`validate\` tool.
- SSG HUB 아티클 titles start with [팀명] and mention member names and the topic.
- Prefer \`draft_weekly_report\` (it fills tables from activity logs) and only write the narrative parts yourself. Never invent activities.
- Never delete unless the user asked. Destructive ops always need the human to confirm.

## 4. Operation reference
\`\`\`
${OP_REFERENCE}
\`\`\`

${PLAN_FORMAT}
`;
}

export function llmsTxt(base = '') {
  return `# Shapeshift

> AI-readable team project workspace for SSG club projects. No built-in AI: bring your own agent. Read Markdown/HTML views, submit Markdown edits or operation JSON; humans preview diffs and can undo.

## Docs
- [Agent guide](${base}/agent): how to read and edit, operation reference, club rules
- [Workspace outline](${base}/t/{teamId}.md): start here for a team
- [Node as Markdown](${base}/p/{id}.md), [as HTML](${base}/p/{id}), [as JSON](${base}/p/{id}.json)

## API
- [MCP endpoint](${base}/mcp): JSON-RPC tools for personal AI clients (Bearer personal token)
- POST ${base}/api/nodes/{id}/markdown, POST ${base}/api/prompts, POST ${base}/api/prompts/{id}/apply, POST ${base}/api/oplog/{id}/undo
`;
}

/** Copy-paste package for chat AIs that can't browse (ChatGPT/Claude app). */
export function contextPackage({ task, outline, nodeMd, base }) {
  return `너는 우리 팀의 Shapeshift 워크스페이스를 편집하는 AI야. 아래 자료를 읽고 요청을 처리해줘.

## 요청
${task || '(요청을 여기에 적어 주세요)'}

## 답변 형식 (둘 중 하나만, 코드블록 하나로)
1) 현재 문서를 고치는 경우: 아래 "현재 문서"를 수정한 **Markdown 전체** (front matter의 id 유지)
2) 구조를 바꾸는 경우: \`{"summary":"...","ops":[...]}\` 형식의 **JSON**
활동을 지어내지 말고, 삭제는 요청이 있을 때만 해.

## 워크스페이스 개요
${outline}
${nodeMd ? `\n## 현재 문서\n\`\`\`markdown\n${nodeMd}\`\`\`\n` : ''}
## Operation 참고
\`\`\`
${OP_REFERENCE}
\`\`\`
(전체 안내: ${base}/agent)
`;
}
