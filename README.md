# seKUrity Service

Web, Discord Bot, Backend API, PostgreSQL을 Docker Compose로 함께 운영합니다.

## Architecture

```text
Discord
   |
   v
seKUrity Bot -- HTTP/Bearer --> Fastify Backend --> PostgreSQL

사용자 -- HTTP --> seKUrity Web
```

- Bot은 PostgreSQL에 직접 접근하지 않습니다.
- Backend만 DB 자격 증명을 가지며 스크럼과 길드 채널 설정을 관리합니다.
- Bot은 Compose 내부 DNS인 `http://backend:3000`으로 API를 호출합니다.
- Backend의 호스트 포트는 로컬 인터페이스에만 바인딩됩니다.
- Web은 외부 포트를 직접 노출하지 않고 Nginx를 통해서만 접근합니다.
- Nginx는 HTTP 요청을 `https://sekurity.kr`로 리다이렉트하고 HTTPS 요청을 Web으로 전달합니다.

## Start

루트 환경 파일을 준비합니다.

```bash
cp .env.example .env
```

`POSTGRES_PASSWORD`, `BACKEND_INTERNAL_TOKEN`, `DISCORD_TOKEN`을 반드시
설정한 뒤 실행합니다.

```bash
docker compose up --build
```

Web은 아래 주소에서 확인할 수 있습니다.

```text
https://sekurity.kr
```

Nginx는 호스트의 `/etc/letsencrypt`를 읽기 전용으로 연결하며 아래 인증서를 사용합니다.

```text
/etc/letsencrypt/live/sekurity.kr/fullchain.pem
/etc/letsencrypt/live/sekurity.kr/privkey.pem
```

인증서를 갱신한 뒤에는 설정을 검사하고 Nginx를 다시 불러옵니다.

```bash
npm run nginx:reload
```

Slash command 구조를 변경한 뒤에는 Bot 환경 변수로 명령을 다시
등록해야 합니다.

개발 서버의 Guild command를 갱신합니다.

```bash
npm --prefix seKUrity_bot run deploy:commands:guild
```

공개 전환 시에는 Global command를 먼저 등록하고 작동을 확인한 뒤 기존
Guild command를 삭제합니다.

```bash
npm --prefix seKUrity_bot run deploy:commands:global
npm --prefix seKUrity_bot run delete:commands:guild
```

`delete:commands:guild`는 `DISCORD_GUILD_ID`에 등록된 모든 Guild command를
삭제하므로 Global command 확인 후 실행해야 합니다.

삭제된 사용자별 주간보고 게시물은 `서버 관리` 권한으로 `/syncweekly`를
실행해 다시 생성할 수 있습니다. 주차 마감 전에는 기존 이번 주 보고서도 새 게시물에
다시 연결됩니다.

Backend는 시작할 때 `drizzle/`의 PostgreSQL 마이그레이션을 자동으로
적용합니다. 상태 확인은 로컬에서 아래 주소로 할 수 있습니다.

```bash
curl http://127.0.0.1:3000/health
```

OpenAPI 문서는 정적 UI 없이 인증된 JSON으로 제공합니다.

```bash
curl \
  -H "Authorization: Bearer $BACKEND_INTERNAL_TOKEN" \
  http://127.0.0.1:3000/openapi.json
```

## Development

각 서비스를 호스트에서 실행하려면 PostgreSQL과 Backend를 먼저 실행하고
Bot에 `BACKEND_API_URL=http://localhost:3000`을 설정합니다.

```bash
npm --prefix seKUrity_backend install
npm --prefix seKUrity_backend run dev

npm --prefix seKUrity_bot install
npm --prefix seKUrity_bot run dev
```

전체 타입 검사와 빌드는 루트에서 실행할 수 있습니다.

```bash
npm run check
npm run build
```

## Weekly Report Test Date

평일에 주간보고 전체 흐름을 테스트할 때는 운영 Compose와 분리된 테스트
프로젝트를 사용합니다. `WEEKLY_TEST_DATE`에는 실행하는 현재 요일과 관계없이
가상 현재 날짜를 지정할 수 있습니다. 모든 요일에 현재 주차의 스크럼과
주간보고를 작성할 수 있으며, 가상 날짜를 월요일로 넘기면 이전 주차의
수정·삭제 거부 동작을 검사할 수 있습니다.

```bash
cp .env.weekly-test.example .env.weekly-test
```

`.env.weekly-test`에 아래 값을 설정합니다.

```dotenv
WEEKLY_TEST_DATE=2026-08-02
WEEKLY_TEST_DISCORD_TOKEN=테스트-봇-토큰
WEEKLY_TEST_DISCORD_CLIENT_ID=테스트-봇-애플리케이션-ID
WEEKLY_TEST_DISCORD_GUILD_ID=테스트-서버-ID
BACKEND_PORT=39002
```

운영 봇과 이벤트가 중복 처리되지 않도록 별도 Discord 테스트 봇을 사용해야
합니다. 테스트 스택을 실행하면 `deploy-commands` 일회성 컨테이너가 테스트
길드의 Slash command를 먼저 등록합니다. 등록에 성공한 뒤에만 Bot이
시작됩니다.

```bash
npm run weekly-test:up
```

`sekurity-weekly-test`라는 별도 Compose 프로젝트로 실행되므로 PostgreSQL
볼륨도 운영 데이터와 분리됩니다. 테스트 서버에서는 최초 한 번 아래 설정을
실행해야 합니다.

```text
/setchannel type: weekly channel: #주간보고-포럼 role: @주간보고-대상
```

이후 `/weekly` 또는 사용자별 주간보고 게시물의 버튼으로 전체 흐름을
테스트합니다. 이 환경에서 `/newscrum`으로 생성하고 승인한 스크럼의 첫
작성 주차는 `WEEKLY_TEST_DATE`와 KST 화요일 19:00 전환 기준으로 지정됩니다.
일요일부터 화요일 18:59까지는 직전 일요일, 화요일 19:00부터 토요일까지는
다가오는 일요일이 내부 주차 키로 지정되며, Discord에는 해당 주차의 화요일
19:00 마감으로 표시됩니다. 따라서 승인 직후 같은 주차를 기준으로
`/scrum` 작성과 주간보고 집계까지 이어서 확인할 수 있습니다.
스크럼을 제출하면 해당 주간보고가 자동 생성 또는 갱신되며, 스크럼을
삭제하면 연결된 작업도 보고서에서 제거됩니다.

마감 후 이전 주차 수정·삭제 거부는 같은 테스트 DB를 유지하며 날짜만 넘겨 검사합니다.

1. `WEEKLY_TEST_DATE=2026-08-02`처럼 마감 전 날짜로 스택을 실행하고 주간보고를 만듭니다.
2. `weekly-test:down`을 실행하지 않은 상태에서 날짜를 마감 이후인
   `2026-08-05`로 변경합니다. 날짜 전용 테스트 값은 해당 날짜 정오로 처리되므로,
   화요일 19:00 이후 상태는 수요일 날짜로 검사합니다.
3. `npm run weekly-test:up`을 다시 실행해 Bot과 Backend를 가상 수요일로
   재기동합니다.
4. 이전 주차 보고서의 `추가로 한 작업 작성`, `주간보고 삭제` 버튼과 이전
   스크럼의 삭제가 마감 안내와 함께 거부되는지 확인합니다. `/weekly`는
   새 주차 보고서를 작성하며, 관리자 `/weeklyadmin delete`는 마감 후에도 사용할
   수 있습니다.

테스트가 끝나면 컨테이너와 테스트 DB 볼륨을 함께 제거합니다.

```bash
npm run weekly-test:down
```

`WEEKLY_TEST_DATE`는 Bot과 Backend 모두 `NODE_ENV=test`일 때만 허용됩니다.
운영 서비스 환경에 변수가 실수로 전달되면 서비스가 시작되지 않으며,
잘못된 날짜 형식은 시작 단계에서 거부됩니다.

## Weekly Report Management

`/setchannel type: weekly`에서 지정한 역할의 사용자마다 주간보고 포럼
게시물이 생성됩니다. 어느 날이든 스크럼을 제출하면 해당 사용자의 이번 주
보고서가 자동 생성되고 이후 스크럼 승인·포기·제출·삭제 내용에 맞춰 계속
갱신됩니다. 완료한 작업과 추가 완료 작업이 모두 없어지면 해당 날짜의
주간보고는 자동 삭제됩니다. 보고서
작성자는 보고서 아래의 `추가로 한 작업 작성`, `주간보고 삭제` 버튼을 사용할
수 있으며, 수동 추가 작업은 완료 목록에서 `[추가]`로 표시됩니다. 작성자
삭제와 추가 작업 수정은 해당 주차의 마감인 화요일 19:00 전까지만 허용됩니다.

관리자는 `/weeklyadmin status user: @사용자`로 특정 사용자의 누락 횟수를,
`/weeklyadmin status-all`로 전체 주간보고 대상자의 누락 횟수를 확인할 수
있습니다. 주간보고 게시물 안에서 `/weeklyadmin delete`를 실행하면 작성자가
직접 추가한 작업 하나를 선택해 삭제할 수 있습니다. 삭제 사유는 필수이며
작성자에게 DM 임베드로 전달됩니다. 삭제 후 완료한 작업이 하나도 남지 않으면
해당 주차의 주간보고도 함께 삭제됩니다. 화요일 19:00 마감이 지난 주차의 보고서가 없으면
사용자별 누락 횟수가 한 번만 증가합니다.

`/setchannel`로 지정한 채널이 삭제되면 실행 중에는 Discord 채널 삭제
이벤트로, Bot이 꺼져 있던 동안 삭제됐다면 다음 시작 시점의 점검으로 해당
설정을 PostgreSQL에서 제거합니다.

## Scrum Data Reset

모든 스크럼 승인 요청, 스크럼, 참여자, 작업 및 작성 기록을 초기화하려면
루트에서 아래 명령을 실행합니다.

```bash
npm run db:reset:scrums -- --confirm-reset-scrums
```

확인 인자가 없으면 스크립트는 실행을 거부합니다. 길드 채널 설정과 승인
역할은 보존되며, Discord에 이미 생성된 포럼 게시물은 삭제하지 않습니다.

## Weekly Miss Count Reset

특정 날짜 이후에 발생한 누락만 다시 집계하려면 먼저 변경 내용을 미리
확인합니다.

```bash
npm run db:reset:weekly-misses -- --after 2026-09-01
```

출력이 올바르면 `--apply`를 추가해 길드별 집계 기준일과 누락 횟수를
저장합니다. 특정 서버만 대상으로 삼으려면 `--guild-id`도 지정할 수 있습니다.

```bash
npm run db:reset:weekly-misses -- --after 2026-09-01 --guild-id DISCORD_GUILD_ID --apply
```

## Data Migration

기존 `data/scrums.sqlite`와 `data/guild-settings.json`은 읽거나 복사하지
않습니다. 요청대로 기존 데이터는 보존하지 않으며, 첫 실행 후 Discord에서
아래 설정을 다시 실행해야 합니다.

```text
/setchannel type: logs
/setchannel type: scrums channel: #스크럼-포럼
/setchannel type: approve channel: #승인-포럼
/setapprover role: @승인자
```

`Administrator` 권한 보유자는 별도 승인 역할 없이도 승인·반려할 수
있습니다.
