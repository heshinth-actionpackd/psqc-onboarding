# PSQC onboarding

WhatsApp onboarding for a PSQC cohort. A student sends **Hi PSQC**, then the bot collects their name, email, and college (the phone number is the WhatsApp sender), asks them to pick **Fundamental** or **Advanced**, confirms a batch, saves the record, and sends the session details for that course and batch.

Messaging goes through the [Actionpackd Messaging API](https://dev.actionpackd.com/docs). Telegram is not wired up. The conversation steps do not import WhatsApp types, so a second adapter can call the same `runTurn` later.

This is a skeleton. Template names, the exact webhook JSON, and a few product choices are marked in the code and listed at the bottom.

## Flow

| Step               | Student sends                 | Bot sends                                |
| ------------------ | ----------------------------- | ---------------------------------------- |
| `new`              | `Hi PSQC`                     | Welcome, and asks for their name         |
| `awaiting_name`    | Their name                    | Asks for email                           |
| `awaiting_email`   | Email                         | Asks for college                         |
| `awaiting_college` | College                       | Course template with quick-reply buttons |
| `awaiting_course`  | `fundamental` or `advanced`   | Asks them to confirm the open batch      |
| `awaiting_batch`   | `YES`, or a batch name        | Saves the row and sends session details  |
| `completed`        | Anything, including `Hi PSQC` | Reminds them they are already enrolled   |

`Hi PSQC` mid-flow starts again and clears the answers. It does not clear a completed enrollment.

Plain text is used inside the 24-hour WhatsApp window. The course step sends an approved template, because that is what carries the buttons. Outside the window, Actionpackd returns `409 SESSION_WINDOW_CLOSED` for text.

## Layout

```
src/index.ts                     process entry: migrate, listen on 0.0.0.0:$PORT
src/app.ts                       Fastify app (health, webhook, raw-body parser)
src/config.ts                    env validation
src/conversation/machine.ts      step transitions
src/conversation/run-turn.ts     one inbound event, idempotent
src/channels/whatsapp/           signature, parser, Actionpackd client, route
src/channels/telegram/adapter.ts placeholder adapter
src/db/                          pg pool, SQL migration runner, queries
migrations/001_init.sql          students, course_batches, processed_events
```

Postgres access is `pg` plus numbered SQL files. There is no ORM. Applied files are recorded in `schema_migrations`.

## Prerequisites

- Node.js 22 LTS (the Docker image is `node:22-bookworm-slim`)
- Postgres 14 or newer (the compose file runs 16)

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run dev
```

`npm run dev` applies migrations and listens on port 3000. Check it:

```bash
curl -s localhost:3000/health
curl -s localhost:3000/ready
```

`/health` is process liveness and does not touch Postgres. `/ready` runs `SELECT 1`. Point Railway's healthcheck at `/health`.

Apply migrations without starting the server with `npm run migrate`.

## Environment

| Variable                     | Required | Purpose                                          |
| ---------------------------- | -------- | ------------------------------------------------ |
| `DATABASE_URL`               | yes      | Postgres connection string                       |
| `ACTIONPACKD_API_KEY`        | yes      | `apk_live_...` or `apk_test_...` bearer key      |
| `ACTIONPACKD_WEBHOOK_SECRET` | yes      | HMAC secret from `PUT /v1/webhook`               |
| `ACTIONPACKD_BASE_URL`       | no       | Defaults to `https://api.actionpackd.com/v1`     |
| `PORT`                       | no       | Defaults to `3000`. Railway sets this            |
| `NODE_ENV`                   | no       | `development` (default), `test`, or `production` |
| `LOG_LEVEL`                  | no       | Pino level, default `info`                       |

A Railway **public** database URL should keep `sslmode=require`. The pool turns that into TLS without verifying the proxy certificate. Use `sslmode=verify-full` if you want strict verification. `sslmode=disable` turns TLS off.

`apk_test_` keys are a sandbox: Actionpackd validates the send and can call your webhook, and nothing is delivered on WhatsApp. `apk_live_` sends on the connected number.

## Scripts

```bash
npm test          # unit tests, no Postgres and no calls to Actionpackd
npm run lint
npm run format:check
npm run typecheck
npm run build     # tsc to dist/
npm start         # node dist/index.js
```

## Docker and Railway

The image listens on `0.0.0.0` and `PORT`, runs as the `node` user, and exits on `SIGTERM`. Migrations run on startup, before the server listens.

```bash
docker build -t psqc-onboarding .
docker run --rm -p 3000:3000 --env-file .env psqc-onboarding
```

On Railway, set the env vars from the table above, and set the healthcheck path to `/health`.

## Point the Actionpackd webhook here

The route is `POST /webhooks/actionpackd`. Actionpackd only accepts an HTTPS URL, so a laptop needs a tunnel.

```bash
curl -X PUT "$ACTIONPACKD_BASE_URL/webhook" \
  -H "Authorization: Bearer $ACTIONPACKD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_DOMAIN/webhooks/actionpackd"}'
```

The first response includes `secret` once. Put that value in `ACTIONPACKD_WEBHOOK_SECRET` and restart. `POST /v1/webhook/test` sends a sample event; unknown event types are acknowledged with `200` after the signature checks out. A `message.inbound` event we cannot parse returns `400` so the failure is visible.

Signature check, from the [Actionpackd docs](https://dev.actionpackd.com/docs):

- Header `X-Actionpackd-Signature-V2` is HMAC-SHA256 of `` `${X-Actionpackd-Timestamp}.${rawBody}` ``
- `X-Actionpackd-Timestamp` is Unix seconds
- Timestamps more than 5 minutes off are rejected
- The signature is computed over the raw bytes, not re-serialized JSON

The header is expected to be hex. A `sha256=` prefix and base64 are also accepted. Confirm which encoding `POST /v1/webhook/test` actually sends if verification fails.

Each inbound event id is stored in `processed_events`. A retry does not advance the student a second time. If the reply send fails, the event stays `processing` and the next delivery sends the same replies with the same `Idempotency-Key` (`{eventId}:{index}`). After a successful send the row is `processed` and further deliveries are ignored. `message.status` events are stored and otherwise ignored.

## Send API

`src/channels/whatsapp/client.ts` posts to `{ACTIONPACKD_BASE_URL}/messages`:

```json
{ "to": "919876543210", "type": "text", "text": { "body": "..." } }
```

```json
{ "to": "919876543210", "type": "template", "template": { "name": "...", "language": "en" } }
```

Headers are `Authorization: Bearer <key>`, `Content-Type: application/json`, and `Idempotency-Key`. Documented success is HTTP `202`. The client also treats `200` as success. It does not call the live API from tests.

The course-choice template name is the placeholder `TODO_psqc_course_choice` in `src/conversation/templates.ts`. Quick-reply payloads on that template must be `fundamental` and `advanced`. Until the name is an approved template, that step's send fails and the event stays retryable.

The assumed inbound envelope is:

```json
{
  "id": "evt_123",
  "type": "message.inbound",
  "data": {
    "message": {
      "from": "919876543210",
      "id": "wamid.abc",
      "type": "text",
      "text": { "body": "Hi PSQC" }
    }
  }
}
```

`type: "message.status"` is accepted and not turned into a conversation turn. A Meta Cloud API `entry[].changes[].value.messages[]` wrapper is also accepted. The public docs do not publish this JSON; compare it with one real delivery before relying on it.

## What to decide next

- The approved template name (and its button payloads) for the course choice, and whether batch confirmation and session details should also be templates so they still send after 24 hours.
- The real webhook JSON, once you have one sample from `POST /v1/webhook/test` or a sandbox reply. Adjust `src/channels/whatsapp/parse.ts` if it does not match.
- Whether `Hi PSQC` from someone who already finished should restart onboarding instead of leaving the enrollment in place.
- Real rows in `course_batches` (name, whether it is active, and the session-details text). The migration seeds a placeholder `upcoming` batch for each course.
- Whether to keep an outbound message id from the `202` response and update it from `message.status`, or leave status events as ack-only.
