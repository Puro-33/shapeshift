# Shapeshift

**프롬프트로 구조가 자라는 팀 프로젝트 워크스페이스.** 노션의 페이지/DB/뷰 모델을 그대로 쓰되, 구조를 사람이 만들지 않아요.
운영 안내문을 넣으면 시즌 일정과 규칙이 생기고, 팀원이 한 일을 말하면 활동 로그가 쌓이고, 주간보고서는 그 기록으로 자동 작성돼요.
SSG 동아리 팀 프로젝트(주간보고서, SSG HUB 아티클, 발표자료)를 1순위 사용처로 설계했어요. 전체 스펙은 [`docs/SPEC.md`](docs/SPEC.md)에 있어요.

## 무엇이 되나

| 하고 싶은 것 | 이렇게 말하면 돼요 |
|---|---|
| 시즌 만들기 (운영진) | 운영진 대시보드에 "SSG 팀 프로젝트 안내" 전문 붙여넣기 → 1~10차 마감, 시험기간, 최소 요구사항, 파일명 규칙 자동 생성 |
| 팀/프로젝트 구조 | "DevSecOps 보안 스캐너 팀 만들어줘. 팀명 ○○, PM 김성주, 팀원 김원준 변정현 차정훈" |
| 구조 변경 | "태스크에 예상 시간 숫자 필드 추가", "Issues를 태스크에 합쳐서 타입으로 구분", "이 페이지를 DB로 바꿔줘" |
| 활동 기록 | "오늘 iam_privesc_by_rollback 풀었고 prowler로 점검해봄" |
| 주간보고서 | "2차 주간보고서 만들어줘" → 지난 차주 계획 이월, 팀원별 계획 대비 실적 표, 도움 필요(Ask), 규칙 검증, 파일명 규칙대로 HTML/PDF 내보내기 |
| 아티클 | ChatGPT/Claude 정리글 HTML 붙여넣기 → 채팅 잡담 제거, `[팀명]` 제목, 작성자/주제 자동 |
| Prowler | 결과(JSON-OCSF/CSV/HTML) 첨부 또는 CI에서 API로 전송 → 신규/잔존/해결 finding 추적 |
| 질문 | "이번 주 누가 뭐 했어?" |

모든 AI 변경은 **미리보기(diff) → 적용 → 되돌리기**가 가능하고, 사람이 직접 한 편집도 같은 엔진을 거쳐 기록돼요.

## 구조

```
server/
  core/ops.js         Operation 엔진 (검증, 트랜잭션 적용, 미리보기 롤백, before-image 기반 Undo)
  core/rules.js       규칙 엔진 (필수 섹션, [팀명] 제목, 파일명, 참여율 등)
  ai/orchestrator.js  프롬프트 → 계획 → 미리보기 → 적용. 1 프롬프트 = LLM 1회 (+검증 실패 시 1회 재시도)
  ai/providers.js     Gemini → Groq → OpenRouter 무료 티어 폴백, 프로바이더별 속도 제한/쿨다운
  ai/heuristic.js     모든 LLM이 한도 초과여도 핵심 명령을 처리하는 규칙 기반 플래너
  services/           season(안내문 파싱), teams, reports(주간보고/내보내기), ingest(HTML·비밀값·Prowler), notion, notify
  store/              JSONB 문서 저장소: Neon Postgres 또는 로컬 JSON 파일 (같은 인터페이스)
public/               무빌드 SPA (Preact + htm 벤더링, CDN 의존 없음)
test/                 SSG 실데이터 기반 골든 시나리오 12개 + HTTP 스모크 21개
```

의존성은 `postgres` 하나뿐이에요 (HTTP, 인증, HTML 변환, LLM 호출 모두 Node 표준 기능).

## 로컬 실행

```bash
npm install
npm start                   # http://localhost:8787, DATABASE_URL이 없으면 data/dev.json 사용
npm test                    # 골든 시나리오
```

첫 가입자가 운영진(admin)이 돼요. AI 키가 없으면 규칙 기반 플래너로 동작해요.

## 무료 배포 (기한 만료 없는 구성)

| 구성 | 서비스 | 무료 조건 |
|---|---|---|
| 웹 서버 | Render Free Web Service | 15분 유휴 시 슬립(재기동 약 1분), 월 750시간 |
| DB | Neon Free Postgres | 기한 없음, 0.5GB, 월 100 CU-시간, 한도 초과 시 데이터 삭제 없이 일시정지 |
| LLM | Gemini API 무료 티어 → Groq 무료 티어 | 요청 수 제한만 있음 |
| 스케줄/백업/CI | GitHub Actions | 공개 레포 무료 |
| 알림 | Discord 웹훅 | 무료 (Render 무료는 SMTP 포트 차단) |

Render Free Postgres는 30일 뒤 만료돼서 쓰지 않아요.

1. **Neon**: 프로젝트 생성 → *pooled* 연결 문자열 복사
2. **Render**: New → Blueprint → 이 레포 선택 (`render.yaml`) → `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `BOOTSTRAP_ADMIN_EMAIL` 입력
3. **GitHub Secrets**: `APP_URL`, `CRON_SECRET`(Render에서 생성된 값), `DATABASE_URL` → 알림/백업 워크플로 활성화
4. 앱에서 운영진 가입 → 시즌 만들기 → 팀 만들기 → 팀 설정에서 Discord 웹훅/초대 코드

## 보안 메모

- HTML 리포트는 `/api/render`에서 `CSP: sandbox` + iframe sandbox로 앱과 다른 불투명 origin에서 렌더돼요. 기본 모드는 스크립트 제거, 인터랙티브 모드도 네트워크(`connect-src 'none'`) 차단.
- 저장 및 LLM 전송 전에 AWS/GitHub/HF/OpenAI/Google/Groq 키, 개인키, 비밀번호 패턴을 마스킹해요.
- 세션 쿠키 HttpOnly + SameSite=Lax, 변경 요청은 커스텀 헤더(`x-shapeshift`) 필수(CSRF), scrypt 비밀번호 해시, API 토큰은 SHA-256 해시만 저장.
- Gemini 무료 티어는 입력이 서비스 개선에 쓰일 수 있어요. 민감한 내용은 넣지 마세요.
