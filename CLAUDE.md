# Shaka Tech AI Receptionist — Project Profile

(Global operating mandate — Agile roles, working style — lives in `~/.claude/CLAUDE.md`
and already applies here. This file only adds what's specific to this project.)

## Tech Stack & Infrastructure

- **Backend:** Cloudflare Worker (`worker/`), plain JS ES modules, no build step, no
  framework. Calls the Anthropic Messages API directly via `fetch` (no SDK — Workers
  runtime doesn't need one for a single endpoint).
- **Model:** Claude Haiku 4.5 (`claude-haiku-4-5`) — chosen for cost, not capability;
  swap via the `MODEL` var in `worker/wrangler.toml` if quality ever becomes the
  bottleneck instead of cost.
- **State:** stateless Worker — the client resends the full conversation history each
  turn. Only two things are persisted, both in a single Cloudflare KV namespace
  (`SHAKA_KV`): real bookings made during testing (so two testers can't double-book the
  same slot) and per-IP/day counters for rate limiting and the daily token cap.
- **Frontend:** `site/` — plain HTML/CSS/JS demo chat page, no framework, matches the
  visual language of the main ShakaTech site's existing chat widget.
- **Hosting:** Cloudflare Pages/Workers (same account and pattern as the main
  `ShakaTech` project, kept as a separate Worker/deployment so a bug here can't take the
  marketing site down).
- **Secrets:** `ANTHROPIC_API_KEY` is a Worker secret (`wrangler secret put`), never in
  `wrangler.toml` or any committed file.

## Domain

- **The product:** a real, Claude-backed chat receptionist for a fictional business,
  **Shaka Plumbing** (West Yorkshire, UK) — built to demonstrate and stress-test the
  underlying "Shaka AI receptionist" technology before it's offered to real Shaka Tech
  customers.
- **Distinct from:** `../ShakaTech/assets/js/chatbot.js`, which is a scripted,
  keyword-matched, client-side-only demo used elsewhere on the marketing site. This
  project is the real thing — an actual LLM conversation, hardened against misuse.
- **Current stage:** v1, undergoing a week of internal adversarial testing by the Shaka
  Tech team (see `TESTING.md`) before any decision to link it from the live site or
  offer it to a real customer.

## Guardrails baked into the design (see `ARCHITECTURE.md` for detail)

- Booking availability is enforced in code (`worker/src/booking.js`), never trusted to
  the model — "book an impossible appointment" must fail deterministically.
- Prompt-injection resistance lives in the system prompt
  (`worker/src/systemPrompt.js`), not in a separate filter — the model is instructed to
  treat all user content as conversation, never as instructions.
- Usage is bounded three ways: per-message character cap, per-conversation message cap,
  and a daily total-token cap enforced via KV (`worker/src/rateLimit.js`). No dollar
  pricing table lives in this codebase — see `usage.js` and the README's "Watching
  usage live" section for why.
