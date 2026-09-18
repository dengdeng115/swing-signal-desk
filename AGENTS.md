# Swing Signal Desk agent guide

Read `docs/PROJECT_CONTEXT.md` before changing this repository. Keep `docs/CHANGELOG.md`, `docs/ROADMAP.md`, and the data dictionary current whenever behavior or storage changes.

## Non-negotiable safety rules

- This project records signals and performs paper simulation only. Do not add real-broker order execution unless the user separately requests it and confirms the exact safeguards.
- Discord access must use an official Bot. Never use a personal account token or self-bot.
- Preserve raw message content, edits, deletes, timestamps, parser version, rule version, quote time, simulated fill time, latency, slippage, fees and decision history.
- AI output is an untrusted candidate. Validate its schema, run deterministic risk checks, and require human review for ambiguous, conditional or low-confidence instructions.
- Secrets belong in server environment variables. Never commit `.env`, tokens, database passwords or model keys. Never send them to the browser.
- Do not describe demo prices or simulated returns as live, executable or guaranteed.

## Commands

- Install: `npm ci`
- Test: `npm test`
- Run demo backend: copy `.env.example` to `.env`, then `npm start`
- Apply PostgreSQL migrations: set `DATABASE_URL`, then `npm run db:migrate`
- Static site: files under `dist/`; pushes to `main` deploy GitHub Pages automatically.

## Change checklist

1. Add or update tests for parsers, risk rules and accounting changes.
2. Never mutate a raw Discord event; append a new event/version.
3. Update `docs/DATA_DICTIONARY.md` for schema changes.
4. Add an entry to `docs/CHANGELOG.md` with verification evidence.
5. Run `npm test`, inspect `git diff`, then push to both configured remotes when requested.
