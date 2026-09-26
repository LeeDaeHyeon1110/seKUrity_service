# seKUrity Service

Web, Discord Bot, Backend API, PostgreSQL을 Docker Compose로 함께 운영합니다.

## Architecture

```text
Discord
   |
   v
seKUrity Bot -- HTTP/Bearer --> Fastify Backend --> PostgreSQL

사용자 -- HTTPS --> Nginx -- / ----------> seKUrity Web
                          `-- /api/v1/ --> Fastify Backend
```

- Bot은 PostgreSQL에 직접 접근하지 않습니다.
- Backend만 DB 자격 증명을 가지며 스크럼과 길드 채널 설정을 관리합니다.
- Bot은 Compose 내부 DNS인 `http://backend:3000`으로 API를 호출합니다.
- Backend의 호스트 포트는 로컬 인터페이스에만 바인딩됩니다.
- Web은 외부 포트를 직접 노출하지 않고 Nginx를 통해서만 접근합니다.
- Nginx는 HTTP와 와일드카드 서브도메인을 `https://sekurity.kr`로 리다이렉트합니다.
- Nginx는 공개 `/api/v1/`만 Backend로 전달합니다. `/internal/`은 외부에
  노출하지 않으며 Bot만 Compose 내부 네트워크에서 호출합니다.
- 회원 사진은 Web 정적 파일이 아닌 Backend 전용 `backend-uploads` 볼륨에
  저장되고, 인증된 API를 통해서만 제공됩니다.
- 사진 파일 자체는 5 MiB까지 허용하며, Nginx는 multipart 메타데이터를
  포함할 수 있도록 공개 API 요청 본문을 6 MiB로 제한합니다.

## Start

루트 환경 파일을 준비합니다.

```bash
cp .env.example .env
```

`POSTGRES_PASSWORD`, `BACKEND_INTERNAL_TOKEN`, `DISCORD_TOKEN`,
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`,
`SESSION_TOKEN_PEPPER`를 반드시 설정한 뒤 실행합니다. 세션 비밀값 두 개는
서로 다른 값이어야 하며 각각 다음처럼 생성할 수 있습니다.

```bash
openssl rand -hex 32
```

```bash
docker compose up --build
```

기존 npm 스크립트를 사용해도 같은 구성이 실행됩니다.

```bash
npm run compose:up
```

서버에서 백그라운드로 갱신할 때는 다음 명령을 사용합니다.

```bash
docker compose up -d --build
```

Web은 아래 주소에서 확인할 수 있습니다.

```text
https://sekurity.kr
```

Discord Developer Portal의 OAuth2 Redirects에는 아래 주소를 오탈자, 후행
슬래시 또는 다른 호스트 없이 정확히 등록합니다.

```text
https://sekurity.kr/api/v1/auth/discord/callback
```

`DISCORD_REDIRECT_URI`와 `SITE_URL`도 각각 위 콜백 주소와
`https://sekurity.kr`로 유지합니다. Discord Client Secret, Bot Token,
세션 비밀값은 저장소나 브라우저 환경 변수에 넣지 않고 서버의 `.env`에서만
관리합니다.

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

## Web login and member access

웹 회원가입과 로그인은 Discord OAuth2로 처리합니다. Bot은 시작할 때
`WEB_AUTH_GUILD_ID` 길드의 비봇 회원을 Backend에 전체 동기화하고, 이후
가입·탈퇴, 닉네임·역할 및 Discord 프로필 변경을 계속 반영합니다. Discord
Developer Portal의 Bot 설정에서 **Server Members Intent**를 켜야 합니다.

기본 운영 식별자는 다음과 같습니다.

```dotenv
WEB_AUTH_GUILD_ID=1507335622719967292
WEB_ACTIVE_MEMBER_ROLE_ID=1507362589619912734
WEB_BOARD_MEMBER_ROLE_ID=1507362663339135047
```

- 길드에 없거나 활동 부원 역할이 없는 로그인 사용자는 게스트입니다.
- 활동 부원은 점수·출석·주간보고와 회원 소개 기능을 사용합니다.
- 회장단 역할 권한은 Backend가 동기화된 역할 ID로 판정합니다.
- 회장단 기능은 활동 부원 역할과 회장단 역할을 모두 가진 회원에게만
  허용됩니다.
- 역할이 회수되거나 길드에서 나가면 기존 기록은 보존되지만 회원 전용 접근과
  기존 로그인 세션은 회수됩니다.

활동 부원 대시보드는 본인의 누적 점수, 출석 횟수와 주간보고 미제출 이력을
보여줍니다. 회장단은 양수 점수만 사유와 함께 추가할 수 있고, 오입력은 감사
기록이 남는 무효 처리로 정정합니다. 출석부는 화요일 날짜만 만들 수 있으며
마감 시 미입력 부원을 결석으로 처리하고, 전체 휴회일은 개인 집계에서
제외합니다. 소개 카드는 활동 부원끼리만 조회하며 사진은 공개 정적 경로가
아닌 인증 API로 제공합니다.

닉네임과 역할 변경을 반영하려면 Bot을 항상 실행해야 합니다. 장시간 중단 후
재시작하더라도 시작 시 전체 동기화로 누락된 변경을 정리합니다.

## Development

### 로컬 Docker 웹 테스트

Mac에서 Certbot 인증서를 복사하지 않고 HTTP로 테스트할 수 있습니다.
로컬 Compose 프로젝트는 `sekurity-local`로 실행되며 데이터베이스와 사진
볼륨이 운영 프로젝트와 분리됩니다. Nginx는 `127.0.0.1:8080`에만 바인딩되고
443 포트와 `/etc/letsencrypt`를 사용하지 않습니다.

```bash
cp .env.local.example .env.local
```

`.env.local`의 `POSTGRES_PASSWORD`, `BACKEND_INTERNAL_TOKEN`,
`SESSION_SECRET`, `SESSION_TOKEN_PEPPER`를 로컬 테스트용 값으로 변경합니다.
세션 비밀값 두 개는 각각 `openssl rand -hex 32`로 생성할 수 있습니다.
PostgreSQL 볼륨을 만든 뒤 `POSTGRES_PASSWORD`를 변경하면 기존 DB 사용자
비밀번호도 별도로 변경해야 하므로, 비밀번호는 첫 기동 전에 정합니다.
화면만 확인할 때는 Discord 관련 예시 값을 그대로 둬도 되지만, 로그인까지
시험하려면 `DISCORD_CLIENT_ID`와 `DISCORD_CLIENT_SECRET`에 실제 Discord
애플리케이션 값을 넣고 Developer Portal의 OAuth2 Redirects에 아래 주소를
추가합니다.

```text
http://127.0.0.1:8080/api/v1/auth/discord/callback
```

기존 운영용 Redirect URI는 삭제할 필요가 없습니다. 브라우저에서는
`http://127.0.0.1:8080`을 사용합니다. `http://localhost:8080`으로 접속해도
Nginx가 쿠키를 발급하기 전에 `127.0.0.1:8080`으로 이동시킵니다.
두 호스트는 쿠키를 공유하지 않으므로, 시작 주소와 콜백 주소를 섞으면
`INVALID_OAUTH_STATE`가 발생합니다. 수정 전에 시작한 로그인이나 만료된
콜백 화면은 새로고침하지 말고 사이트의 로그인 버튼에서 다시 시작하세요.

`SITE_URL`과 `DISCORD_REDIRECT_URI`는 프로토콜·호스트·포트가 같아야 하며,
콜백 경로는 `/api/v1/auth/discord/callback`이어야 합니다. 불일치하면
Backend가 시작 시 설정 오류를 알려줍니다. 로컬 Compose는 이 두 주소를
위의 `127.0.0.1:8080` 기준으로 고정합니다.

```bash
npm run local:up
npm run local:logs
npm run local:down
```

로컬 설정에서는 Discord Bot을 시작하지 않습니다. 로그인한 회원의 길드
닉네임과 역할은 OAuth 과정에서 조회되지만, 다른 회원의 사전 동기화나 실시간
역할 변경 반영은 이루어지지 않습니다. 이 부분까지 테스트할 때는 별도의
테스트 Bot과 길드를 사용하세요.

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
