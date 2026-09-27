# SPEC: Shapeshift (가칭) : 프롬프트로 구조가 자라는 동아리 팀 프로젝트 워크스페이스

> 상태: v0.3 (SSG 노션 구조 분석 반영 + 전부 무료 스택으로 변경, 구현 착수 승인 대기)
> 작성일: 2026-09-26
> 결정: 새 레포(가칭 `Puro-33/shapeshift`) / 범위 M1~M6 전체 / **전 구성요소 무료, 사용 기한 만료형 무료 티어 금지(사용량·시간 제한형만 허용)**

---

## 1. 배경: SSG 동아리가 지금 노션으로 프로젝트를 기록하는 방식

### 1.1 실제 구조 (노션 "2026 SSG 팀 프로젝트" 분석)

```
2026 SSG 팀 프로젝트 (page)
├─ 안내 callout
│   ├─ SSG 팀 프로젝트 안내      ← 운영진 규칙: 기간, 제출 일정표, 보고서 최소 요구사항, 아티클 규칙
│   ├─ 킥오프 계획서 예시        ← 6개 장(개요/분석 범위/팀 소개/품질·위험/비용·자원/의사소통)
│   └─ 킥오프 피드백 (DB)
├─ 프로젝트 목록 (DB)            필드: 프로젝트명(title), 인원(person), 사람(person), 회의록(text), Formula
│   ├─ (2025 우수 프로젝트) 임베디드 취약점 분석
│   ├─ DevSecOps CI/CD 파이프라인 통합 보안 스캐너   ← 우리 팀
│   │   └─ 산출물 (page) → 산출물 (DB)
│   │       필드: 이름, 종류(select: 주간보고/산출물/발표자료/깃허브),
│   │             상태(status: 시작 전/진행 중/완료), D-day(date),
│   │             단계(select: 킥오프/1단계/2단계/최종/1차발표/2차 발표)
│   │       ├─ 0차 주간보고서 (완료, 9/11)
│   │       ├─ 1차 주간보고서 (진행 중, 9/18)
│   │       ├─ 1주차 아티클
│   │       ├─ 2차 주간보고서
│   │       └─ 2주차 아티클
│   ├─ AI Jail Break & 가드레일 취약점 분석
│   ├─ Windows Kernel Driver 취약점 분석
│   ├─ 웹 버그바운티
│   ├─ MEX01 펌웨어 0-Day 취약점 연구
│   └─ Chrome Full chain with AI
└─ 프로젝트 타임라인 (DB, 캘린더 뷰)  필드: 이름, 날짜, 태그
    킥오프(8/31), 킥오프 중간발표(9/7), 프젝 시작(9/14), 주간 보고서 제출 (1) x 9, 중간 발표, 최종 발표 ...
```

### 1.2 동아리 운영 규칙 ("SSG 팀 프로젝트 안내" 페이지)
- 기간: 8/31(월) ~ 1/3(일). 킥오프 보고서 → 킥오프 중간발표(9/7~9/9) → 본 프로젝트(9/14~) → 최종발표(1/4~1/10).
- **제출 일정**: 킥오프(9/6, 9/13 수정본), 1~9차 주간보고서 + SSG HUB 아티클(매주 일요일 23:59), 중간/기말고사 기간 제외, 10차(1/3)는 최종 발표 자료.
- **제출 방법**: 팀 PM이 NAS `/Study - 재학생/2026 프로젝트/보고서 제출`에 업로드. 기한 초과 시 우수 프로젝트 선정에서 페널티.
- **발표자료 파일명**: `(n월발표자료)SSG_팀프로젝트_팀명`, `(최종발표자료)SSG_팀프로젝트_팀명`, 킥오프는 `(킥오프)SSG_팀프로젝트_팀명`. 발표 당일까지 원본 제출.
- **주간보고서 최소 요구사항**: ① 이번 주 목표 & 성공기준 ② 계획 대비 실적(Planned vs Done) ③ 핵심 인사이트 1~3개 ④ **도움 필요(Ask) 1~2개** ⑤ 다음 주 실행 계획(Next 3~5 To-Dos) ⑥ 회의 사진(증빙).
- **SSG HUB 아티클**: 매주 1회 이상, 주제 자유. 제목에 `[팀명]` 필수, 본문에 팀원 이름/주제 필수.
- **킥오프 보고서**: 팀원별 참여율(1인 최대 100%) 포함.

### 1.3 우리 팀 주간보고서의 실제 템플릿 (0~2차 공통)
1. 프로젝트 개요: 주제(DevSecOps), 팀명(컴공컴공컴공경영let'sgo), 팀원(김성주(PM), 김원준, 변정현, 차정훈), 제출 날짜
2. 일 단위 활동 내용 보고: 기간(예: 9/12(토)~9/18(금)), 날짜별 활동(문제풀이, 정기회의 결정사항)
3. 금주 팀원 별 수행 업무: 표(이름 | 수행 업무)
4. 계획 대비 실적(지난 주간): 표(행: 이번 주 목표 / 금주 수행 현황(완료, 75% 등) / 수행 완료 항목 / 편차 사유, 열: 팀원)
5. 회의 사진
6. 핵심 인사이트 → 이슈 사항 및 제한 사항
7. 차주 계획
8. 체크리스트(to-do 6개)

### 1.4 관찰된 문제점 (앱이 해결해야 할 것)
| # | 관찰 (실제 데이터) | 문제 |
|---|---|---|
| P1 | 매주 템플릿을 복제해서 팀명/팀원/주제를 반복 입력, "제출 날짜"는 0~2차 모두 공란 | 반복 타이핑, 누락 |
| P2 | 지난주 "차주 계획"을 이번 주 "이번 주 목표"로 손으로 옮겨 적음 | 계획과 실적이 데이터로 연결 안 됨 |
| P3 | 체크리스트 6개가 매주 전부 미체크 상태 | 자가 점검이 형식적. 검증 자동화 필요 |
| P4 | 동아리 필수 항목 **"도움 필요(Ask)"가 우리 팀 템플릿에 아예 없음** | 규칙 위반을 사람이 못 잡음 |
| P5 | 산출물 DB의 종류/단계 값이 전부 비어 있고, 상태·D-day도 0~1차만 입력 | 메타데이터를 손으로 유지 못 함 |
| P6 | 프로젝트 타임라인에 "주간 보고서 제출 (1)"이 9개 중복, 2025년 날짜가 남아 있음, 산출물 DB와 연결 없음 | 일정과 산출물이 따로 놂 |
| P7 | 1주차 아티클 끝에 AI 채팅 응답 문구("Notion에 바로 붙여넣을 수 있게 정리했어...")가 그대로 남음 | 팀원들이 이미 AI 결과를 복붙 중. 정제/구조화 기능이 없음 |
| P8 | 프로젝트 목록 DB의 인원/사람 필드 중복, 회의록·Formula 미사용 | 구조가 쓰이지 않고 방치됨 |
| P9 | NAS 제출용 파일은 노션 밖에서 따로 만듦(파일명 규칙 수동) | 제출물 생성이 수작업 |
| P10 | 팀 과제 자체가 Prowler 반복 점검, 기록, 재검사, 이슈 연결인데(1주차 아티클 "DevSecOps의 실증 요소") 기록 장소가 없음 | Prowler HTML/JSON 결과를 받아 추적할 곳이 필요 |

> 참고: 다른 팀 프로젝트 페이지(2025 우수 프로젝트 등)는 비어 있거나 권한상 내용이 보이지 않아 분석에서 제외했어요.

**결론**: 사람이 구조를 만들고 매주 같은 걸 다시 타이핑하는 대신, **운영 규칙 문서를 넣으면 AI가 시즌 구조를 만들고, 팀원이 자연어/HTML로 활동을 던지면 AI가 주간보고서, 산출물, 일정, 점검 결과를 알아서 채우는** 워크스페이스가 필요함.

---

## 2. 제품 비전

> **"매주 템플릿 복붙은 그만. 한 일을 말하면 보고서가 됩니다."**

- **Prompt-first**: 모든 조작의 1차 인터페이스는 자연어 프롬프트. 수동 편집은 보조.
- **Fluid schema**: 페이지, DB, 필드, 뷰, 관계가 고정되지 않고 프롬프트로 언제든 재구성.
- **Rule-aware**: 동아리 규칙(제출 일정, 최소 요구사항, 파일명, 아티클 규칙)을 "규칙 객체"로 저장하고 AI가 자동 검증.
- **HTML 1급 시민**: 보고서, AI 채팅 결과, Prowler 리포트를 HTML/Markdown으로 받아 안전하게 렌더하고 구조화.
- **AI 변경은 항상 미리보기 + 되돌리기**.
- **완전 무료 운영**: 동아리 예산 0원으로 한 학기 이상 운영 가능.

### 2.1 사용자와 역할
| 역할 | 예시 | 권한 |
|---|---|---|
| 운영진(Admin) | SSG 운영진 | 시즌/규칙/일정 생성, 전체 팀 제출 현황, 피드백 작성 |
| PM | 김성주 | 팀 구조 변경, 보고서 확정/제출물 export |
| 팀원(Member) | 김원준, 변정현, 차정훈 | 활동 입력, 아티클 작성, 보고서 초안 편집 |

### 2.2 비목표 (MVP)
- 실시간 동시 편집(CRDT). 저장 시 충돌 감지(optimistic lock)만.
- 노션 양방향 싱크(단방향 import만).
- NAS 직접 업로드(파일 export까지만. NAS는 외부망 접근 불확실).
- 모바일 네이티브 앱(반응형 웹만).

---

## 3. 핵심 시나리오 (SSG 실데이터 기준)

### S1. 운영 규칙 → 시즌 구조 자동 생성 (운영진)
"SSG 팀 프로젝트 안내" 본문을 붙여넣고: "이걸로 2026 2학기 시즌 만들어줘"
- 시즌: 2026-08-31 ~ 2027-01-03
- 마일스톤: 킥오프 보고서(9/6), 킥오프 수정본(9/13), 킥오프 중간발표(9/7~9/9), 1~9차 주간보고(매주 일 23:59, 시험기간 제외), 10차 최종자료(1/3), 최종발표(1/4~)
- 규칙 객체: 주간보고 최소 요구 6항목, 아티클 제목 `[팀명]` 규칙, 파일명 규칙, 참여율 합계 규칙, 제출자=PM
- 팀별 산출물 슬롯 자동 생성(각 차수 주간보고서 + 아티클), 캘린더 뷰와 산출물이 같은 데이터에서 파생(P6 해결)

### S2. 팀 프로젝트 셋업 (PM)
"DevSecOps CI/CD 파이프라인 통합 보안 스캐너 팀 만들어. 팀명 컴공컴공컴공경영let'sgo, PM 김성주, 팀원 김원준 변정현 차정훈. CloudGoat 문제풀이, Prowler 점검, CI/CD 통합 단계로 가자"
- 프로젝트, 팀원/역할, 단계(킥오프/1단계/2단계/최종), 태스크 DB, CloudGoat 시나리오 DB(난이도, 풀이자, 라이트업 링크, Root Cause/Attack Path/Preventive Control/Prowler Coverage/Detection Gap 필드), Prowler Findings DB 제안.

### S3. 활동을 말로 던지기 (팀원)
프롬프트 바에: "오늘 iam_privesc_by_rollback 풀었고 prowler로 rollback 문제 점검해봄. 컨테이너 개념도 좀 봄"
- CloudGoat DB 해당 항목 `완료` + 풀이자 연결, 태스크 진행률 갱신, 활동 로그(날짜별)에 기록.
- 이 기록이 주간보고서 "일 단위 활동", "팀원 별 수행 업무", "계획 대비 실적"의 원천 데이터가 됨.

### S4. 주간보고서 자동 초안 + 규칙 검증 (PM)
"2차 주간보고서 만들어줘"
- 기간 자동 계산(9/21~9/26), 개요(주제/팀명/팀원/제출 날짜) 자동 채움(P1)
- **이번 주 목표 = 1차 보고서의 차주 계획**에서 자동 이월(P2)
- 계획 대비 실적 표: 팀원별 목표, 수행률(%), 완료 항목을 활동 로그에서 산출. 편차 사유는 비워두고 해당 팀원에게 입력 요청
- **규칙 검증 패널**(P3, P4): 6개 최소 요구사항 충족 여부. 예: "도움 필요(Ask) 섹션 없음", "회의 사진 미첨부", "핵심 인사이트 0개"
- 산출물 DB 메타데이터 자동 설정: 종류=주간보고, 단계=1단계, D-day=9/27, 상태 전이(P5)
- **Export**: 단일 HTML과 PDF(브라우저 인쇄), 파일명 규칙 자동 적용(P9)

### S5. AI 채팅 결과/HTML 붙여넣기 → 아티클 (팀원)
ChatGPT/Claude에서 받은 정리글(HTML 또는 Markdown)을 붙여넣으면:
- 끝의 채팅 잡담("Notion에 바로 붙여넣을 수 있게...") 제거(P7), 제목에 `[컴공컴공컴공경영let'sgo]` 부착, 작성자/주제 메타 채움
- 아티클 규칙 검증, 해당 주차 아티클 산출물에 연결

### S6. Prowler 리포트 흡수 (DevSecOps 팀 특화, P10)
Prowler HTML 또는 JSON(OCSF) 결과를 업로드/API로 투입:
- 원본 HTML은 샌드박스 렌더로 보관
- Findings DB로 구조화: check ID, 서비스, 리소스, severity, status(PASS/FAIL), remediation
- 이전 스캔과 비교: 신규/해결/잔존 finding, 재검사 증빙("수정 후 재검사로 검증")
- 연결: finding → CloudGoat 시나리오(어떤 공격 경로를 탐지하는지) → 이슈/태스크

### S7. 질문/현황 (누구나)
- "이번 주 누가 뭐 했어?" → 팀원별 요약 + 근거 링크, 참여율
- (운영진) "이번 주 보고서 안 낸 팀?" → 전체 팀 제출 현황, 마감 임박 알림

### S8. 노션 가져오기
"2026 SSG 팀 프로젝트" 페이지 import → 프로젝트 목록, 산출물, 주간보고서를 가져오고 AI가 보고서 표(계획 대비 실적)를 구조화 데이터로 파싱. 개인 "Codex 작업 기록"도 선택적으로 가져와 개발 로그로 매핑.

---

## 4. 기능 요구사항

### 4.1 Prompt Bar
- `Ctrl/Cmd + K` 및 하단 고정 입력창. 현재 페이지/선택 항목/시즌 규칙/스키마 요약을 컨텍스트로 자동 첨부.
- 의도 분류: `build`(구조), `log`(활동 기록), `draft`(보고서/아티클 초안), `ingest`(HTML/리포트 흡수), `ask`(질의), `admin`(시즌/규칙).
- 결과는 **Plan 카드**: 변경 요약 + Operation diff + `적용 / 수정 요청 / 취소`. 후속 프롬프트로 Plan 수정.

### 4.2 Fluid Structure
- Node 기반: page, collection, item, report, view. 트리 + relation 그래프.
- 동적 스키마 필드 타입: text, number, select, multi_select, status, date/daterange, person, url, checkbox, relation, rollup, percent, file/image, json, html.
- 구조 변환: 페이지 ↔ 컬렉션, 컬렉션 병합/분할, 필드 타입 변경, 리스트/테이블/칸반/캘린더/타임라인 전환.
- 블록 에디터(노션 유사): heading, paragraph, list, todo, code, table, callout, image, html-embed.
- 뷰: document, table, board, calendar, timeline, dashboard, graph.

### 4.3 AI Operation Engine
- LLM은 **타입이 정해진 Operation 목록만 출력**(function calling + JSON Schema 검증). 서버가 검증 후 트랜잭션 적용.
- 예시:
  ```jsonc
  { "op": "create_node", "tempId": "t1", "type": "collection", "parent": "proj_devsecops", "title": "CloudGoat 시나리오" }
  { "op": "add_field", "collection": "t1", "field": { "name": "난이도", "type": "select", "options": ["Easy","Medium","Hard"] } }
  { "op": "upsert_item", "collection": "t1", "match": {"title": "iam_privesc_by_rollback"}, "values": {"상태": "완료", "풀이자": ["차정훈"]} }
  { "op": "create_rule", "scope": "season", "rule": { "kind": "report_required_sections", "sections": ["목표&성공기준","계획 대비 실적","핵심 인사이트","도움 필요(Ask)","차주 계획","회의 사진"] } }
  { "op": "convert_node", "node": "page_9", "to": "collection", "strategy": "headings_as_items" }
  { "op": "delete_node", "node": "x" }   // 파괴적 연산: 항상 확인
  ```
- 파이프라인: 의도 분류 → 컨텍스트 수집 → Plan 생성 → 검증(스키마/참조/권한/규칙) → diff 미리보기 → 적용 → OpLog(역연산 포함).
- 신뢰 레벨: `always-confirm`(기본) / `auto-apply-safe`(생성·추가·갱신 자동, 삭제·병합·타입변경은 확인). 역할별 제한(팀원은 팀 구조 변경 불가 등).
- Undo/Redo: 프롬프트 단위 되돌리기.
- **무료 LLM 한도 대응**: 요청 큐 + 지수 백오프, 429 발생 시 폴백 프로바이더로 전환, 의도 분류는 규칙 기반 우선(LLM 호출 절약), 스키마 요약 캐시.

### 4.4 규칙 엔진 (Rule-aware)
- 규칙 종류: 마감(차수별 D-day, 시험기간 제외), 필수 섹션, 제목 패턴(`[팀명]`), 파일명 패턴, 제출자 역할(PM), 참여율 합계 ≤ 100%/인.
- 규칙은 자연어 원문 + 구조화 JSON 둘 다 저장. 운영진이 안내 문서를 수정해 다시 넣으면 AI가 규칙 diff를 제안.
- 검증 결과는 보고서/아티클 편집 화면 우측 패널에 실시간 표시, 체크리스트는 자동 체크(P3).

### 4.5 주간보고서 & 산출물
- 보고서는 **구조화 JSON(섹션별) + 렌더된 문서** 이중 표현. 표(팀원별 수행 업무, 계획 대비 실적)는 실제 데이터 테이블.
- 원천 데이터: 활동 로그, 태스크/시나리오 상태 변경, 회의록, 이전 보고서의 차주 계획.
- 팀원별 입력 요청: 편차 사유, 인사이트 등 사람만 쓸 수 있는 칸은 담당자에게 할당 + 알림.
- 산출물 상태 자동 전이: 시작 전 → 진행 중(초안 생성) → 완료(PM 확정/export).
- Export: 자체 완결형 HTML(인라인 CSS, 이미지 base64), PDF(브라우저 인쇄 CSS), 파일명 규칙 자동.

### 4.6 HTML/리포트 입력
- 경로: 붙여넣기, `.html`/`.md`/`.json` 업로드, `POST /api/ingest`, 프롬프트에 URL.
- 보안 렌더: DOMPurify sanitize → `iframe sandbox`(스크립트 비허용) + 별도 origin 경로 + 엄격 CSP. 인터랙티브 모드는 명시적 허용 시 `allow-scripts`만(same-origin 금지, `connect-src 'none'`).
- AI 추출: 요약, 상태, 수치, 링크, 완료 항목, 이슈, 다음 할 일 → Operation Plan으로 연결.
- 정제: AI 채팅 잡담 제거, 비밀값 패턴(`AKIA`, `ghp_`, `hf_`, `sk-` 등) 마스킹 후 저장/LLM 전송(DevSecOps 팀 특성상 AWS 키 노출 위험 높음).
- Prowler 전용 파서: JSON(OCSF) 우선, HTML은 표 파싱 + AI 보조.

### 4.7 Ingest API & 알림
- `POST /api/ingest` (팀 단위 API 토큰): `{ project?, kind: "report"|"prowler"|"devlog"|"article", format, content, source? }`.
- GitHub Actions 예제: Prowler 스캔 워크플로 결과를 ingest로 POST(공개 레포는 Actions 무료).
- 알림: **Discord 웹훅**(팀이 이미 디스코드로 진행 공유 중). 마감 D-2/D-day, 입력 요청, ingest 결과. 이메일은 사용 안 함(§6 참고).

### 4.8 노션 Import
- 노션 Internal Integration 토큰(무료) → 페이지 트리/DB 선택 → Node/Block 변환 → 선택적 "AI 재구성" Plan.
- SSG 매핑: 프로젝트 목록 → Project, 산출물 DB → Deliverable, 주간보고서 페이지 → WeeklyReport(표 파싱), 프로젝트 타임라인 → Milestone(중복/과거 연도 항목 정리 제안).

---

## 5. 비기능 요구사항
- **비용 0원**: 모든 외부 서비스는 무료 티어, 신용카드 등록 불필요한 것 우선.
- **성능**: Plan 생성 p50 < 8s(무료 LLM 기준), 적용 < 500ms. 콜드스타트 시 로딩 화면 + 프롬프트 임시 저장.
- **데이터 용량**: DB 0.5GB 한도 내 운영. 이미지(회의 사진)는 업로드 시 클라이언트에서 WebP로 리사이즈/압축(목표 200KB 이하). 사용량 대시보드와 80% 경고.
- **안정성**: Operation 트랜잭션, 실패 시 롤백. 주 1회 DB 덤프를 GitHub Actions로 백업(무료 DB는 복구 기능이 제한적이라서).
- **보안**: 세션 쿠키(HttpOnly, SameSite), 비밀번호 해시(argon2/bcrypt), API 토큰 해시 저장, HTML 격리, 비밀값 마스킹, 역할 기반 권한.
- **이식성**: LLM 프로바이더 추상화. 나중에 유료 키(Anthropic 등)를 설정만으로 연결 가능.

---

## 6. 무료 인프라 구성 (기한 만료형 제외)

| 구성요소 | 선택 | 무료 조건 (확인 결과) | 판정 |
|---|---|---|---|
| 웹 서버 | **Render Free Web Service** | 15분 무요청 시 슬립, 재기동 약 1분, 워크스페이스당 월 750 인스턴스시간, 카드 불필요 | 시간 제한형 → 채택. 서비스는 1개만 운영(24시간 x 31일 = 744시간 < 750) |
| DB | **Neon Free Postgres** | 기한 없음, 프로젝트당 0.5GB, 월 100 CU-hours, 5분 유휴 시 scale-to-zero, 한도 초과 시 삭제 없이 일시정지 | 사용량 제한형 → 채택 |
| ~~DB 대안~~ | ~~Render Free Postgres~~ | 생성 30일 후 만료, 14일 유예 후 데이터 삭제, 백업 미지원 | **기한 만료형 → 제외** |
| DB 예비안 | Supabase Free | 기한 없음, 500MB, 7일 저활동 시 일시정지(1년 내 복구 가능), 무료 프로젝트 2개 | 예비안 |
| LLM (주) | **Google Gemini API 무료 티어** | 카드 불필요, function calling 지원, 분당/일당 요청 제한(RPM/RPD) | 사용량 제한형 → 채택 |
| LLM (폴백) | **Groq 무료 티어** | 카드 불필요, 크레딧 차감 없이 rate limit만 적용(약 30 RPM, 약 14,400 RPD, 모델별 토큰 제한), 오픈 모델 | 사용량 제한형 → 채택 |
| LLM (예비) | OpenRouter 무료 모델 | 무료 모델 라우터, 가용성 변동 | 예비안 |
| 스케줄러 | GitHub Actions `schedule` | 공개 레포 무료 | 마감 알림 트리거, DB 백업 |
| 알림 | Discord 웹훅 | 무료 | Render 무료 서비스는 SMTP 포트(25/465/587) 발신 불가라 이메일 대신 채택 |
| 파일 저장 | Neon DB 내 압축 이미지 | DB 용량 공유 | 한도 근접 시 GitHub 레포 저장 등 대안 검토 |
| 도메인 | `*.onrender.com` | 무료 | |

**주의사항**
- Gemini 무료 티어는 입력 데이터가 서비스 개선에 사용될 수 있다고 알려져 있어요. 팀 보고서 수준은 괜찮지만 AWS 키 같은 비밀값은 반드시 마스킹 후 전송(§4.6). 착수 시 최신 약관과 한도를 다시 확인.
- 무료 LLM 한도 때문에 "한 프롬프트 = LLM 호출 1~2회"를 설계 원칙으로 둠(다단계 에이전트 체인 금지).
- 이전 결정의 Anthropic은 유료라서 기본값에서 제외. 프로바이더 추상화로 나중에 키만 넣으면 전환 가능.

---

## 7. 아키텍처

```
┌──────────────────── Web (React + Vite + TS) ────────────────────┐
│ Prompt Bar │ Plan/Diff │ Block Editor │ Views │ Rule Panel       │
│ Report Viewer (sandboxed iframe) │ Admin Dashboard               │
└──────────────▲───────────────────────────────────────────────────┘
               │ REST/JSON + SSE
┌──────────────┴──────── API (Node + Hono + TS, Render Free) ──────┐
│ Auth/Roles │ Nodes/Schema │ Operation Engine │ Rule Engine        │
│ AI Orchestrator (Gemini → Groq fallback, queue/backoff)           │
│ Report Service (sanitize, extract, export) │ Prowler Parser       │
│ Ingest API │ Notion Importer │ Discord Notifier                   │
└──────┬───────────────────────────────────────────────┬───────────┘
       │                                               │
  Neon Postgres (JSONB, FTS)                 GitHub Actions (cron: 알림 트리거, 백업, Prowler 스캔 → ingest)
```

### 7.1 기술 스택
| 영역 | 선택 |
|---|---|
| 프론트 | React + Vite + TypeScript, TanStack Query, Tiptap(블록 에디터), dnd-kit |
| 백엔드 | Node.js + Hono + TypeScript, Zod |
| DB | Neon Postgres + Drizzle ORM(JSONB 동적 필드), 서버리스 드라이버 |
| AI | 프로바이더 추상화(Gemini/Groq/OpenRouter/유료 확장), Zod→JSON Schema function calling |
| 보안 | isomorphic-dompurify, iframe sandbox, CSP, argon2 |
| 배포 | Render Blueprint(`render.yaml`), 단일 서비스가 API + 정적 프론트 서빙 |
| 레포 | pnpm workspaces: `apps/web`, `apps/api`, `packages/core`(Operation/규칙 타입 공유) |

---

## 8. 데이터 모델 (초안)

```sql
user(id, name, email, password_hash, created_at)
season(id, name, start_date, end_date, rules jsonb, source_text text)      -- "2026 SSG 2학기"
team(id, season_id, project_node_id, name)                                 -- 컴공컴공컴공경영let'sgo
membership(team_id, user_id, role)                                         -- admin | pm | member

node(id, workspace_id, team_id null, parent_id null, type, title, icon, sort_key,
     props jsonb, content jsonb, created_by, created_at, updated_at, deleted_at, version int)
collection_schema(node_id pk, fields jsonb, version int)
edge(id, from_node, to_node, relation_field_id)
view(id, collection_id, type, name, config jsonb)

milestone(id, season_id, kind, round int null, title, due_at, window_start, window_end)  -- 1~10차, 발표 등
deliverable(id, team_id, milestone_id, node_id, kind, stage, status, submitted_at)       -- 산출물 DB의 정식화
activity_log(id, team_id, user_id, occurred_on date, text, structured jsonb, source)     -- 주간보고 원천
weekly_report(id, deliverable_id, period_start, period_end, sections jsonb, validation jsonb)
rule_check(id, target_node_id, rule_id, passed bool, detail, checked_at)

report(id, node_id, kind, source, format, raw text, sanitized_html text, extracted jsonb, created_at)
prowler_scan(id, team_id, report_id, scanned_at, account_alias, summary jsonb)
finding(id, scan_id, check_id, service, resource, severity, status, remediation, first_seen_scan, resolved_scan)

prompt(id, user_id, team_id, text, context jsonb, intent, status, plan jsonb, provider, model,
       tokens_in, tokens_out, latency_ms, created_at)
op_log(id, prompt_id, seq, op jsonb, inverse jsonb, applied_at, reverted_at)
api_token(id, team_id, name, token_hash, scopes, last_used_at)
attachment(id, node_id, mime, bytes bytea, width, height)   -- 압축 이미지
```

---

## 9. 화면 구성
1. **사이드바**: 시즌 → 팀 → 프로젝트 트리, 산출물, 캘린더, 인박스(ingest/입력 요청).
2. **팀 홈 대시보드**: 이번 차수 D-day, 보고서 진행률, 규칙 검증 상태, 팀원별 이번 주 활동, 최근 Prowler 결과.
3. **보고서 편집기**: 좌측 문서, 우측 규칙 검증 패널 + 원천 데이터(활동 로그) 패널.
4. **Prompt Bar + Plan 카드**.
5. **Report Viewer**: 원본 HTML(샌드박스) | 추출 데이터 | 제안 변경.
6. **운영진 대시보드**: 팀 x 차수 제출 매트릭스, 지각/누락, 피드백 작성.
7. **Activity**: 프롬프트/OpLog 타임라인, Undo.
8. **설정**: LLM 프로바이더 키, 신뢰 레벨, Discord 웹훅, API 토큰, 노션 Import, 사용량(DB/LLM).

---

## 10. 마일스톤

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **M0 Spec** | 이 문서 확정 | 사용자 승인 |
| **M1 Skeleton + 무료 인프라 검증** | 모노레포, Neon 연결, Drizzle 스키마, 로그인/역할, Node CRUD, 문서·테이블 뷰, **Render 무료 배포를 초기에 먼저** | 공개 URL에서 로그인 후 페이지/컬렉션 수동 편집. 콜드스타트 UX 확인 |
| **M2 AI Ops Engine** | Operation 타입, 검증/적용/역연산, Prompt Bar, Plan 카드, Undo, Gemini→Groq 폴백, 요청 큐 | S2 수행, 429 강제 시 폴백 동작 |
| **M3 SSG 도메인 + 뷰** | 시즌/규칙 엔진, 마일스톤/산출물, 캘린더·칸반·대시보드, 활동 로그(S3) | S1로 2026 2학기 시즌 생성, 캘린더와 산출물 연동 |
| **M4 보고서 & HTML** | 주간보고서 초안(S4), 규칙 검증, 아티클 정제(S5), HTML sanitize/샌드박스, HTML/PDF export + 파일명 규칙, Prowler 파서(S6) | G2~G5, G7 통과 |
| **M5 Ingest & Import & 알림** | `/api/ingest`, 토큰, GitHub Actions 예제(Prowler 스캔, 백업, 알림 cron), Discord 웹훅, 노션 Import(S8) | "2026 SSG 팀 프로젝트" import 성공, 마감 D-2 디스코드 알림 |
| **M6 운영 준비** | 운영진 대시보드, 사용량 모니터링, 보안 점검(G7), 문서화, 팀원 초대 | 팀원 4명이 실제로 3차(10/4) 보고서를 앱에서 작성 가능 |

---

## 11. 수용 테스트 (Golden Scenarios, SSG 실데이터 픽스처)
1. **G1 시즌 생성**: "SSG 팀 프로젝트 안내" 원문 → 마일스톤 15개 내외(킥오프 2, 1~9차, 10차, 발표), 시험기간 제외, 규칙 6종 생성.
2. **G2 보고서 이월**: 1차 보고서의 "차주 계획(cloud goat writeup 업로드, prowler 사용, 9/22 디스코드 공유)"이 2차 보고서 "이번 주 목표"로 자동 이월.
3. **G3 규칙 위반 탐지**: 현재 우리 팀 템플릿 기준 2차 보고서 → "도움 필요(Ask) 누락", "제출 날짜 공란" 탐지.
4. **G4 실적 표 생성**: 활동 로그로부터 2차 계획 대비 실적 표(김성주/차정훈/변정현/김원준 열, 목표·수행률·완료항목 행) 생성, 편차 사유는 담당자 입력 요청.
5. **G5 아티클 정제**: 1주차 아티클 원문 → 말미 채팅 문구 제거, `[컴공컴공컴공경영let'sgo]` 제목 규칙 적용.
6. **G6 노션 Import**: 산출물 5건 import 후 비어 있던 종류/단계 값 추론 제안(주간보고/1단계 등), 타임라인 중복 9건 정리 제안.
7. **G7 보안**: `<script>`, `onerror`, 외부 fetch 포함 HTML → 기본 모드 실행 안 됨. 인터랙티브 모드에서도 부모 origin/네트워크 접근 불가. `AKIA...` 키 마스킹.
8. **G8 무료 한도 복원력**: Gemini 429 시뮬레이션 → Groq 폴백으로 Plan 생성, 둘 다 실패 시 프롬프트 큐 보존 후 재시도 안내.
9. **G9 Prowler**: 동일 계정 2회 스캔 투입 → 신규/해결/잔존 finding 분류.

LLM 비결정성 대응: Operation 스키마 통과율과 기대 노드/필드 존재 여부로 채점하는 eval 스크립트를 M2부터 운영(무료 한도 고려해 소규모 픽스처).

---

## 12. 리스크와 대응
| 리스크 | 대응 |
|---|---|
| 무료 LLM rate limit / 품질 | 호출 최소화 설계, 큐+백오프, 폴백 체인, 스키마 강제 + 자동 재시도 1~2회 |
| 무료 LLM 약관(데이터 활용) | 비밀값 마스킹, 민감 문서 AI 처리 옵트아웃 토글 |
| Neon 0.5GB | 이미지 압축, 원본 HTML gzip 저장, 사용량 경고, 오래된 스캔 원본 아카이브 |
| Render 콜드스타트 약 1분 | 로딩 화면, 입력 임시 저장, 마감일 전 GitHub Actions로 워밍업 핑(750시간 한도 내) |
| AI가 구조를 망가뜨림 | always-confirm 기본, 파괴적 연산 확인, OpLog Undo, 주간 백업 |
| HTML XSS | sanitize + sandbox + 별도 경로 + CSP, G7 |
| 팀원 도입 저항 | 노션 import와 HTML/PDF export로 기존 제출 방식(NAS) 유지 |

---

## 13. 향후 확장
- 다른 SSG 팀 온보딩(시즌 단위 멀티팀은 데이터 모델에 이미 반영).
- 실시간 협업(Yjs), 노션 양방향 싱크.
- 스케줄 프롬프트("매주 금요일 보고서 초안 자동 생성").
- MCP 서버로 노출해서 Codex/Claude가 워크스페이스를 직접 기록.
- 발표자료(PPT) 초안 생성.

---

## 14. 결정 사항 로그
| 날짜 | 항목 | 결정 |
|---|---|---|
| 2026-09-26 | 레포 | 새 레포(가칭 `Puro-33/shapeshift`) |
| 2026-09-26 | 범위 | M1~M6 전체 |
| 2026-09-26 | 비용 | 전부 무료, 기한 만료형 무료 티어 금지 |
| 2026-09-26 | DB | Render Postgres(30일 만료) → **Neon Free**로 변경 |
| 2026-09-26 | LLM | Anthropic(유료) → **Gemini 무료 + Groq 폴백**으로 변경, 추상화 유지 |
| 2026-09-26 | 사용자 | 단일 사용자 → **팀/운영진 다중 사용자(역할 기반)**로 변경 |
| 2026-09-26 | 도메인 | 범용 PM 도구 → **SSG 동아리 팀 프로젝트 운영 방식 1순위** |

## 15. 착수 전 필요한 것
1. **GitHub 로그인**: 새 레포 생성/푸시 (공개 레포면 Actions 무료).
2. **Neon 가입**(무료, 카드 불필요) 후 연결 문자열.
3. **Gemini API 키**(Google AI Studio, 무료) + **Groq API 키**(무료).
4. **Discord 웹훅 URL**: 팀 채널 (M5).
5. **Notion Integration 토큰** + "2026 SSG 팀 프로젝트" 페이지에 integration 연결 권한 (M5, 팀 워크스페이스 권한 필요).
