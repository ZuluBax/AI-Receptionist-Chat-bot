# AI Receptionist — v1

A real Claude-backed chat receptionist for a fictional plumbing business, built to
stress-test the "AI receptionist" concept before it's offered to real customers.
See `ARCHITECTURE.md` for how it's built and `TESTING.md` for the week-one test plan.

## Local development

`wrangler dev` runs the Worker entirely locally (Miniflare) — **no Cloudflare account,
login, or real KV namespace needed** for local-only testing. The placeholder KV id
already in `wrangler.toml` is fine; `wrangler dev` just uses it as a local storage key.
Login/KV-creation/secrets-push (below, under "Deploying") are only needed once you
actually want this reachable on the internet.

**1. Install dependencies** (one-time):
```bash
cd worker
npm install
```

**2. Put your Anthropic API key in a local-only file** (one-time, never commit it —
already covered by `.gitignore`):
```bash
echo ANTHROPIC_API_KEY=sk-ant-your-key-here > .dev.vars
```

**3. Run the Worker locally:**
```bash
npm run dev
```
This starts it on `http://127.0.0.1:8787` — matches the default `CHAT_ENDPOINT` in
`site/chat.js`. Leave it running in this terminal.

**4. Open the chat page:**
Open `site/index.html` directly in a browser (double-click it, or drag it into a
browser window — no server needed since it's a plain static file that just calls out to
`localhost:8787`). Start chatting with AI receptionist. Reload the page
to reset the conversation.

## Deploying

Deploying to the public internet needs a real Cloudflare account, since local mode's
placeholder KV namespace and `.dev.vars` file don't exist outside your machine:

```bash
cd worker
npx wrangler login                              # one-time
npx wrangler kv namespace create RECEPTIONIST_KV        # one-time — copy the id it prints
                                                  #   into wrangler.toml's [[kv_namespaces]]
npx wrangler secret put ANTHROPIC_API_KEY        # one-time — pushes the key to Cloudflare,
                                                  #   separate from your local .dev.vars
npm run deploy
```
Wrangler prints the deployed Worker URL — update `CHAT_ENDPOINT` in `site/chat.js` to
that URL, then deploy `site/` wherever it'll be reached from (a Cloudflare Pages
project, or a subpath of the main once testing is done).

## Watching usage live

```bash
cd worker
npm run tail
```
Every request logs a `[usage]` line with token counts (input/output/cache) and the
running daily token total. The chat page's own "Show usage debug" toggle shows a
running session token count too. This project deliberately doesn't estimate a dollar
cost anywhere in code — no pricing table to keep in sync — so for actual spend, check
the Anthropic Console's usage page (or whatever external cost-tracking system you're
running) directly.

## Setting up a new business

Two files, not env vars, since these are per-business identity rather than deployment
tuning:

- `worker/src/businessConfig.js` — opening hours, per day. Each day is `null` (closed)
  or `[openHour, closeHour]` in 24h time — days don't need to match each other.
- `worker/src/systemPrompt.js` — business name, area, services, pricing, persona. The
  hours line is pulled in automatically from `businessConfig.js`, so you only edit
  hours in one place.

## Config knobs (`worker/wrangler.toml` → `[vars]`)

| Var | Default | Purpose |
|---|---|---|
| `MODEL` | `claude-haiku-4-5` | Swap models here, not in code |
| `ALLOWED_ORIGIN` | `*` | Restrict once the frontend has a fixed domain |
| `RATE_LIMIT_WINDOW_MINUTES` / `RATE_LIMIT_MAX_REQUESTS` | 60 / 100 | Per-IP request cap |
| `DAILY_TOKEN_CAP` | 2,000,000 | Hard stop on total tokens processed per UTC day (a runaway-loop tripwire, not a $ budget) |
| `BOOKING_HORIZON_DAYS` | 30 | How far ahead customers can book — must be `30`, `60`, or `90`; anything else silently falls back to 30 |

## Known limitations (see ARCHITECTURE.md § "Before this serves real customers")

This is a v1 internal test build: conversation history lives client-side (a refresh
loses it), there's no lead-notification email/SMS, and CORS is wide open. None of that
blocks a week of manual testing by the team, but all of it needs addressing
before any real customer traffic touches this.
