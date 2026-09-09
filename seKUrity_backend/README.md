# seKUrity Backend

Fastify와 PostgreSQL로 구현된 내부 API입니다.

## Responsibilities

- 길드별 로그·스크럼 채널 설정
- 길드별 승인 포럼과 복수 승인 역할 설정
- 스크럼 생성 요청의 승인·반려 상태 및 반려 사유 저장
- 스크럼 생성과 참여자 관리
- 스크럼 구분과 제출 파일 메타데이터 저장
- 프로젝트 기획서 PDF·PROJECT:SCORE Markdown 및 개인 스터디 기획서 PDF 검증
- 스크럼 완료 처리와 활성 상태 검증
- 현재 진행할 작업과 스크럼 기록 저장
- 다음 스크럼 날짜 및 중복 제출 검증
- 각 작업의 증빙 파일·링크 또는 메모 필수 검증 및 메타데이터 저장
- 사용자별 주간보고 게시물, 자동 스크럼 집계 및 수동 추가 작업 저장
- 마감 후 주간보고 누락 이력과 사용자별 누락 횟수 저장

Bot 전용 API는 `/internal/v1` 아래에 있으며
`Authorization: Bearer <INTERNAL_API_TOKEN>` 인증이 필요합니다.

## Database

Drizzle 스키마는 `src/db/schema.ts`, SQL 마이그레이션은 `drizzle/`에
저장됩니다.

```bash
npm run db:generate
npm run db:migrate
```

운영 서버는 시작 전에 마이그레이션을 자동 적용합니다. PostgreSQL 접근은
repository 모듈에만 두었으므로 향후 웹 라우트는 같은 도메인 계층을
재사용할 수 있습니다.

## API Areas

```text
GET|PUT|DELETE /internal/v1/guilds/:guildId/channels/:type
GET              /internal/v1/guilds/:guildId/approver-roles
PUT|DELETE       /internal/v1/guilds/:guildId/approver-roles/:roleId
POST             /internal/v1/scrum-requests
GET              /internal/v1/scrum-requests/by-approval-thread/:threadId
POST             /internal/v1/scrum-requests/by-approval-thread/:threadId/approve
POST             /internal/v1/scrum-requests/by-approval-thread/:threadId/reject
POST             /internal/v1/scrums
GET              /internal/v1/scrums/by-thread/:threadId
POST             /internal/v1/scrums/by-thread/:threadId/complete
PATCH            /internal/v1/scrums/by-thread/:threadId/completion-results
GET              /internal/v1/guilds/:guildId/scrums/active
GET              /internal/v1/guilds/:guildId/scrums/:scrumId/active
GET              /internal/v1/scrums/:scrumId/entries/:scrumDate/exists
POST             /internal/v1/scrums/:scrumId/entries
PATCH            /internal/v1/scrum-entries/:entryId/results
GET|PUT           /internal/v1/guilds/:guildId/weekly-threads/:userId
GET               /internal/v1/guilds/:guildId/weekly-reports/preview
POST              /internal/v1/guilds/:guildId/weekly-reports
POST              /internal/v1/guilds/:guildId/weekly-reports/sync
POST              /internal/v1/guilds/:guildId/weekly-reports/process-misses
GET               /internal/v1/guilds/:guildId/weekly-reports/by-user/:userId/:weekEnd
GET|PATCH|DELETE  /internal/v1/weekly-reports/:reportId
```

승인 API는 요청 행을 잠근 트랜잭션 안에서 실제 스크럼을 생성하므로, 두
승인자가 동시에 버튼을 눌러도 하나의 요청만 승인됩니다. 승인되기 전에는
`scrums` 행이 생성되지 않으며 반려 요청은 사유와 처리자를 보존합니다.

현재 `/internal/v1`은 Bot 서비스 토큰용입니다. 웹사이트를 추가할 때는
이 경로를 브라우저에 노출하지 않고 `/api/v1`에 사용자 세션과 길드 권한
검사를 적용해야 합니다.

`WEEKLY_TEST_DATE`는 평일 주간보고 테스트용 가상 현재 날짜입니다.
`NODE_ENV=test`에서만 허용하며, 운영 환경에서 설정하면 Backend가 시작을
거부합니다. 모든 요일에 해당 날짜가 속한 주차의 작성 흐름을 확인할 수 있고,
가상 날짜를 월요일로 넘기면 이전 주차의 수정·작성자 삭제 거부를 검증할 수
있습니다. Bot과 동일한 값을 사용해야 하므로 루트의
주간보고 테스트 Compose 설정을 통해 실행합니다.

`weekly-reports/sync`는 해당 주의 스크럼 데이터를 다시 집계하면서 사용자가
직접 추가한 작업과 Discord 메시지 ID를 보존합니다. `process-misses`는 이미
마감된 일요일만 처리하며 `(guild_id, user_id, week_end)` 고유 이력으로
재시작이나 중복 호출에서도 누락 횟수가 한 번만 증가합니다.

누락 횟수의 집계 기준일을 변경할 때는 먼저 미리보기로 결과를 확인하고
`--apply`를 추가해 반영합니다. 빌드된 Backend 또는 Backend 컨테이너에서
실행할 수 있습니다.

```bash
npm run db:reset:weekly-misses -- --after 2026-09-01
npm run db:reset:weekly-misses -- --after 2026-09-01 --apply
```
