# Atbash Playground

A standalone web app for interacting with an Atbash/Hermes agent during live events — a clean **contestant chat** plus a read-only **admin observer** for the stream. Separate from Telegram and the Atbash site.

## Architecture

```
Contestant browser ──HTTPS──▶ Next.js backend ──HTTP──▶ Hermes API (:8642)
Admin browser      ──HTTPS──▶   (relay + auth + store)   /v1/chat/completions
```

- The browser **never** talks to Hermes directly — the backend holds the key and relays. Swapping the Hermes host is a one-value change (`HERMES_API_URL`).
- All Hermes calls live in **one module**: [`src/lib/hermes.ts`](src/lib/hermes.ts).
- Contestant replies stream via **SSE**; the same tokens are written to an in-memory session store that fans out to admin observers live.

## Run it

```bash
npm install
cp .env.example .env.local   # already provided for local dev (mock mode on)
npm run dev                  # http://localhost:3000
```

Out of the box `HERMES_MOCK=1`, so it works **without a Hermes host** — the agent reply is a canned stream.

**One entry point — `/`** — a single code box. The server decides the role from
which set the code belongs to (the observer entrance is never advertised):

- contestant code (defaults `demo123`, `player-one`, `player-two`) → routed to `/chat`
- admin code (`ADMIN_CODES`, dev default `admin-7f3k9q2x`) → routed to `/admin` (live read-only observer)

Give each contestant a **unique** code — the code is their identity, so each
conversation is tracked per-user automatically (no database needed).

## Connecting the real Hermes

When Honore/Tsion provide the host + key, set in `.env.local` (or your host's secrets):

```
HERMES_API_URL=https://<hermes-host>:8642   # or http://127.0.0.1:8642 if co-located
HERMES_API_KEY=<API_SERVER_KEY>
HERMES_MOCK=0
```

Nothing else changes. The relay calls `POST {HERMES_API_URL}/v1/chat/completions` with the Bearer key and streams SSE back.

## Config (env)

| Var | Purpose |
|-----|---------|
| `HERMES_API_URL` | Hermes API server base URL |
| `HERMES_API_KEY` | Bearer token (`API_SERVER_KEY`) |
| `HERMES_MODEL` | model name (default `hermes-agent`) |
| `HERMES_MOCK` | `1` = canned reply, no host needed |
| `ACCESS_CODES` | comma-separated contestant codes (one per contestant) |
| `ADMIN_CODES` | comma-separated admin code(s) for the observer (use long/random) |
| `AUTH_SECRET` | cookie signing key (`openssl rand -hex 32`) |

## Notes / next steps

- Session store is **in-memory** (single process) — fine for an event on one `next start`. Move to Redis/DB if you scale out.
- Session lifecycle: start (code) → active → end (button) / 4h cookie expiry. Add idle-timeout if needed.
- Hardening before public internet: rate-limit the code/login endpoints, real admin auth (OAuth/OIDC), HTTPS termination.
