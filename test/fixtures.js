// Fixtures taken from the real "2026 SSG 팀 프로젝트" Notion pages (structure and wording).

export const SSG_GUIDE = `2학기 프로젝트 진행에 대해 안내 드립니다.
프로젝트 진행이 원활히 될 수 있도록 아래의 내용을 모두 정독 부탁 드립니다.
__프로젝트 기간 : 8월 31일(월) ~ 1월 3일(일)__
🟢 STEP 1: 주제 제안 및 팀 빌딩
- __8/31 ~__ : 킥오프 보고서 작성
- __9/7 ~ 9/9 중 하루__ : 킥오프 중간발표
- __9/14__ : 본 프로젝트 시작
- __1/3__ : 프로젝트 종료
- __1/4 ~ 1/10__ : 최종발표 예정
- 팀 빌딩 완료
🟣 STEP 2: 팀 소개
- 각 팀은 PM(Project Manager) 및 팀명 결정 후 킥오프 보고서에 포함하여 제출
📌 주간 보고서 제출 일정 및 발표 일정
📑 보고서 제출 일정
| 차수 | 제출 기한(23시 59분까지) | 비고 |
| 킥오프 | 9월 6일(일) | 킥오프 보고서 제출(양식 자유/단, 아래 예시 내용 반드시 포함) |
| 킥오프 | 9월 13일(일) | 킥오프 보고서 제출(수정 사항 및 피드백 반영) |
| 1차 | 9월 20일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 2차 | 9월 27일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 3차 | 10월 4일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 중간고사 기간 | 중간고사 | x |
| 4차 | 11월 1일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 5차 | 11월 8일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 6차 | 11월 15일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 7차 | 11월 22일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 8차 | 11월 29일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 기말고사 기간 | 기말고사 | x |
| 9차 | 12월 27일(일) | 주간 보고서 제출, SSG HUB articles 작성 |
| 10차 | 1월 3일(일) | 최종 발표 자료 제출(양식 자유/PPT, PDF 등) |
| 최종발표 | 1월 4일(월)~ | 최종발표 (날짜 미정) |
- 보고서 제출 안내
  - 제출 방법: NAS > /Study - 재학생/2026 프로젝트/보고서 제출
  - 제 출 자: 팀의 PM (Project Manager)
  - 기한 초과 시 페널티 적용 (우수 프로젝트 선정 시)
- 킥오프 보고서 예시(자율 양식이지만, 아래 예시 그림에 나온 내용은 반드시 포함할 것)
  - 보고서 참여율 입력 시 각 팀원별 참여율로 작성(1인 최대 참여율 100%)
  - 킥오프 보고서 파일명 : (킥오프)SSG_팀프로젝트_팀명
🎤 발표 일정
- __중간 발표__: 매달 할 예정  - __오프라인 진행__
- __최종 발표__: 1월 4일 ~ - __오프라인 진행__
※ 발표 후 당일까지 발표 자료 필수 제출
제출처 : 주간보고서와 동일(NAS), 발표 시 사용한 자료 원본 업로드
파일명 : (n월발표자료)SSG_팀프로젝트_팀명 / (최종발표자료)SSG_팀프로젝트_팀명
🔥 SSG HUB articles 작성
SSG HUB Articles는 매주 한 번, 자유롭게 작성하는 기술/보안 아티클입니다.
- 작성 방식
  - 제목에 __[팀명]__ 표기 필수
  - 본문에 __팀원 이름 / 주제__ 작성 필수
📑 주간보고서 최소 요구사항
1. __이번 주 목표 & 성공기준__
2. __계획 대비 실적 (Planned vs Done)__
3. __핵심 인사이트(기술적 발견/의사결정) 1~3개__
4. __도움 필요(Ask) 1~2개__
5. __다음 주 실행 계획(Next 3~5 To-Dos)__
6. __회의 사진(증빙)__
---
모두 잘 숙지해주시길 바랍니다.
감사합니다! 😊`;

// 1차 주간보고서 as written by the team (note: no 도움 필요(Ask) section, blank 제출 날짜)
export const REPORT_1_MD = `## 프로젝트 개요
프로젝트 주제 : DevSecOps
팀 이름 : 컴공컴공컴공경영let’sgo
팀 구성원 : 김성주(PM), 김원준, 변정현, 차정훈
주간 보고서 제출 날짜 :
## 일 단위 활동 내용 보고
9/12(토) ~ 9/18(금) 기준
### cloudgoat 문제풀이
- iam_enum_basics (Easy)
- data_secrets (Easy)
### 9/18(금) 오프라인 정기회의
- SSG 아티클은 문제 하나 선정해서 한문단 요약하자
- prowler 사용
## 핵심 인사이트
### 이슈 사항 및 제한 사항
- cloudgoat 풀이 시 비용은 개인부담(다 풀어도 몇천원 안됨)
## 차주 계획
- cloud goat writeup 작성하여 노션에 업로드
- prowler 사용
- 9/22(화) 22:00 온라인 디스코드로 진행사항 공유
## 체크리스트
- [ ] 이번 주 목표 & 성공기준이 작성 되었는가?
- [ ] 계획 대비 실적이 작성 되었는가?`;

// 1주차 아티클 tail had raw AI chat text pasted in
export const ARTICLE_HTML = `<h1>DevSecOps와 CSPM 개념 정리</h1>
<h2>1. DevSecOps란</h2>
<ul><li><strong>Development + Security + Operations</strong>의 합성어.</li><li>핵심 개념: Shift Left + Shift Right</li></ul>
<pre>Code → SAST → Build → SCA → Container Scan</pre>
<table><tr><th>검사</th><th>도구</th></tr><tr><td>SAST</td><td>Semgrep</td></tr><tr><td>CSPM</td><td>Prowler</td></tr></table>
<p>테스트 키 AKIAABCDEFGHIJKLMNOP 는 노출되면 안 된다.</p>
<script>alert(1)</script>
<hr>
<p>Notion에 바로 붙여넣을 수 있게 정리했어. 이대로 붙여도 되고, 원하면 .md 파일로도 만들어줄게.</p>`;

export const PROWLER_OCSF_1 = JSON.stringify([
  { status_code: 'FAIL', severity: 'High', metadata: { event_code: 'iam_user_mfa_enabled_console_access' }, finding_info: { title: 'Ensure MFA is enabled for all IAM users with console access' }, resources: [{ uid: 'arn:aws:iam::123456789012:user/bob', region: 'us-east-1', group: { name: 'iam' } }], cloud: { account: { uid: '123456789012' } }, remediation: { desc: 'Enable MFA for bob' } },
  { status_code: 'FAIL', severity: 'Critical', metadata: { event_code: 's3_bucket_public_access' }, finding_info: { title: 'S3 bucket is publicly accessible' }, resources: [{ uid: 'arn:aws:s3:::cg-data', region: 'us-east-1', group: { name: 's3' } }], cloud: { account: { uid: '123456789012' } }, remediation: { desc: 'Block public access' } },
  { status_code: 'PASS', severity: 'Low', metadata: { event_code: 'cloudtrail_enabled' }, finding_info: { title: 'CloudTrail enabled' }, resources: [{ uid: 'arn:aws:cloudtrail:::trail/main', region: 'us-east-1', group: { name: 'cloudtrail' } }], cloud: { account: { uid: '123456789012' } } },
]);

export const PROWLER_OCSF_2 = JSON.stringify([
  { status_code: 'FAIL', severity: 'High', metadata: { event_code: 'iam_user_mfa_enabled_console_access' }, finding_info: { title: 'Ensure MFA is enabled for all IAM users with console access' }, resources: [{ uid: 'arn:aws:iam::123456789012:user/bob', region: 'us-east-1', group: { name: 'iam' } }], cloud: { account: { uid: '123456789012' } } },
  { status_code: 'PASS', severity: 'Critical', metadata: { event_code: 's3_bucket_public_access' }, finding_info: { title: 'S3 bucket is publicly accessible' }, resources: [{ uid: 'arn:aws:s3:::cg-data', region: 'us-east-1', group: { name: 's3' } }], cloud: { account: { uid: '123456789012' } } },
  { status_code: 'FAIL', severity: 'Medium', metadata: { event_code: 'iam_policy_attached_only_to_group_or_roles' }, finding_info: { title: 'IAM policy attached directly to user' }, resources: [{ uid: 'arn:aws:iam::123456789012:user/raynor', region: 'us-east-1', group: { name: 'iam' } }], cloud: { account: { uid: '123456789012' } } },
]);
