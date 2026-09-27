# 에이전트(Codex 등) 작업 기록을 Shapeshift로 보내는 법

노션 "Codex 작업 기록"처럼 에이전트가 체크포인트를 남길 때, 노션 대신 이 엔드포인트로 보내면
원본은 그대로 보관되고, AI가 활동 로그, 태스크 진행, 이슈를 프로젝트 구조에 반영하는 **후속 제안**을 인박스에 올려요.

## 엔드포인트

```
POST {APP_URL}/api/ingest
Authorization: Bearer ss_...        # 팀 설정 > Ingest API 토큰
Content-Type: application/json

{
  "kind": "devlog",                 # devlog | report | article | prowler
  "format": "markdown",             # html | markdown | json (생략 시 자동 판별)
  "title": "Checkpoint 0016 | CI green and ARM64 runtime verified",
  "content": "...",                 # 최대 6MB. 비밀값(AKIA.., ghp_.., hf_.., sk-..)은 저장 전에 자동 마스킹
  "source": "codex"
}
```

응답: `{ ok, oplogId, result: { id }, followUps: [...] }`. `?wait=1`을 붙이면 후속 제안 생성까지 기다려요.

## 에이전트용 지침 (AGENTS.md에 붙여넣기)

```
작업 체크포인트마다 SHAPESHIFT_URL/api/ingest 로 POST 하세요.
- kind: "devlog", title: "Checkpoint NNNN | 한 줄 요약"
- content(Markdown): 무엇을 했는지, 커밋 SHA, CI run 링크, 테스트 수치(예: JVM 167/167),
  한계/남은 이슈(Limitations), 다음 할 일(Next)을 각각 제목(##)으로 구분
- 비밀값은 절대 포함하지 말 것 (서버가 마스킹하지만 1차 책임은 에이전트)
```

## 예시 (curl)

```bash
curl -X POST "$SHAPESHIFT_URL/api/ingest" \
  -H "Authorization: Bearer $SHAPESHIFT_TOKEN" -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"kind":"devlog","title":"Checkpoint 0019 | Lint 수정본 CI 검증 시작","content":"## Done\n- lint 오류 수정 (abd511f)\n## CI\n- Android CI: pass\n## Limitations\n- ARM64 추론 미검증\n## Next\n- Maestro 재실행"}
EOF
```
