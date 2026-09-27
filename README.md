# Shapeshift

**AI가 읽고 쓰기 쉬운 팀 프로젝트 워크스페이스.** 노션의 페이지/DB/뷰 모델을 쓰되, 서버에 AI를 넣지 않았어요.
대신 각자 쓰는 AI(Aside 같은 AI 브라우저, ChatGPT/Claude/Gemini, MCP 클라이언트)가 워크스페이스를 **읽기 쉽고 편집하기 쉽게** 만들었어요.
SSG 동아리 팀 프로젝트(주간보고서, SSG HUB 아티클, 발표자료)를 1순위 사용처로 설계했어요. 스펙은 [`docs/SPEC.md`](docs/SPEC.md).

## 왜 서버에 AI가 없나
- 비용 0원, API 키 관리 없음, 팀 데이터가 제3의 AI 서버로 가지 않음
- 각자 이미 쓰는 AI가 더 똑똑하고, 사용자의 맥락을 알고 있음
- 서버는 **검증, 미리보기(diff), 적용, 되돌리기, 규칙 검사**만 책임짐

## AI가 읽는 법
| 형식 | 주소 | 용도 |
|---|---|---|
| 워크스페이스 개요 | `/t/{teamId}.md` | 팀, 일정, 동아리 규칙, 전체 구조(id 포함)를 한 번에 |
| 시맨틱 HTML (JS 없음) | `/p/{id}` | AI 브라우저용. 블록/필드/행마다 `data-*` 속성, 규칙 검증 `section#rule-checks`, 편집 폼 포함 |
| Markdown | `/p/{id}.md` | front matter(속성) + 본문, DB는 항목 표 |
| JSON | `/p/{id}.json` | 원본 데이터 |
| 안내 | `/agent`, `/llms.txt` | AI용 사용 설명서와 Operation 레퍼런스 |

## AI가 편집하는 법
1. **Markdown 왕복**: `/p/{id}.md`를 고쳐서 `/p/{id}`의 `form#edit-markdown`에 제출하거나 `POST /api/nodes/{id}/markdown`. 서버가 차이를 Operation으로 바꿔 미리보기 → 적용.
2. **Operation JSON**: `{"summary":"...","ops":[...]}`를 `form#submit-ops` 또는 `POST /api/prompts`로. 구조 변경(필드, 뷰, 병합, 변환)에 사용.
3. **MCP**: `POST /mcp` (JSON-RPC, 개인 토큰). 도구: list_teams, workspace_outline, read_node, search, validate, preview_ops, apply_ops, edit_markdown, quick_command, undo.
4. **채팅 AI**: 앱의 "🤖 내 AI에게" 버튼이 요청 + 워크스페이스 개요 + 현재 문서 + 규칙을 묶어 복사해 줌. AI의 답을 그대로 붙여넣으면 미리보기.

모든 경로는 같은 Operation 엔진을 거쳐요: 권한 검사 → 트랜잭션 미리보기 → 적용 → 변경 기록(Undo). 삭제나 구조 변경은 항상 사람이 확인해요.

## AI 없이도 되는 것 (빠른 명령)
"오늘 lambda_privesc 풀었어" (활동 기록), "2차 주간보고서 만들어줘" (활동 로그와 지난 차주 계획으로 초안), "태스크에 예상 시간 숫자 필드 추가", "보드 뷰로", 팀 생성, HTML/Prowler 파일 가져오기는 서버 규칙으로 바로 처리돼요.

## 구조
```
server/
  core/ops.js        Operation 엔진 (검증, 미리보기 롤백, before-image 기반 Undo)
  core/markdown.js   노드 <-> Markdown(front matter) 변환, 편집 diff -> ops
  core/rules.js      동아리 규칙 (필수 섹션, [팀명] 제목, 파일명, 참여율)
  agent.js           AI용 HTML/Markdown/JSON 뷰, 폼 편집, MCP 엔드포인트
  ai/orchestrator.js 계획(ops JSON | Markdown | 빠른 명령) -> 미리보기 -> 적용 -> 되돌리기
  ai/heuristic.js    빠른 명령 (규칙 기반, AI 없음)
  ai/guide.js        /agent, /llms.txt, 복사용 자료 패키지
  services/          season, teams, reports, ingest(HTML, 비밀값, Prowler), notion, notify
  store/             JSONB 문서 저장소 (Neon Postgres 또는 로컬 JSON)
public/              무빌드 SPA (Preact + htm 벤더링)
test/                골든 시나리오 14개 + HTTP 스모크 42개
```
의존성은 `postgres` 하나뿐이에요.

## 로컬 실행
```bash
npm install
npm start        # http://localhost:8787 (DATABASE_URL 없으면 data/dev.json)
npm test
```
첫 가입자가 운영진(admin)이 돼요.

## 무료 배포 (기한 만료 없는 구성)
| 구성 | 서비스 | 무료 조건 |
|---|---|---|
| 웹 서버 | Render Free Web Service | 15분 유휴 시 슬립(재기동 약 1분), 월 750시간 |
| DB | Neon Free Postgres | 기한 없음, 0.5GB, 월 100 CU-시간, 한도 초과 시 삭제 없이 일시정지 |
| AI | 없음 (사용자 개인 AI) | 0원 |
| 스케줄/백업/CI | GitHub Actions | 공개 레포 무료 |
| 알림 | Discord 웹훅 | 무료 |

1. Neon 프로젝트 생성 → pooled 연결 문자열
2. Render → New → Blueprint → 이 레포 → `DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`
3. GitHub Secrets: `APP_URL`, `CRON_SECRET`, `DATABASE_URL` (알림/백업 워크플로)

## 보안
- HTML 리포트는 `CSP: sandbox` + iframe sandbox로 앱과 분리된 불투명 origin에서 렌더
- 저장 전 비밀값 마스킹 (AWS, GitHub, HF, OpenAI, Google, Groq 키, 개인키, 비밀번호)
- 세션 쿠키 HttpOnly/SameSite=Lax, API는 `x-shapeshift` 헤더, HTML 폼은 세션별 CSRF 토큰
- 개인 토큰은 SHA-256 해시만 저장, MCP는 Bearer 토큰 전용, 파괴적 변경은 `confirm_destructive` 필요
