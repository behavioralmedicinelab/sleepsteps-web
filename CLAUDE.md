# CLAUDE.md

Website for a clinical trial of a stepped-care sleep intervention: static educational content (videos, audio-only versions and handouts) with optional anonymous ratings, feedback, search and usage logging. It is hosted as a single Cloudflare Worker with static assets and a D1 database.

**Read `SPEC.md` before starting any task.** It is the source of truth. If a request conflicts with the spec, point out the conflict and ask before proceeding.

## Working rules

- Work milestone by milestone (SPEC §20). Do not start the next milestone until the current one's acceptance criteria and tests pass.
- Before writing code for a task, state which spec sections it implements.
- If you change a decision, update `SPEC.md` (the relevant section plus the decision log, §22) in the same change.
- Keep dependencies to those in SPEC §5. Ask before adding any package.
- Browser JS: plain ES modules, no framework, no bundler. Every dynamic feature must fail gracefully (SPEC §11). The page must work with the API down or JavaScript disabled (one exception: the staff-only admin download page needs JavaScript for exports too large for one request, SPEC §11, §14.4).
- Never add cookies or persistent identifiers set by SleepSteps, third-party scripts beyond SPEC §16.2, or storage of IP addresses or user agents (SPEC §2, §14.1, §16.2). Any storage on a visitor's device, ours or a provider's, needs a SPEC §15.4 row, a mention in the privacy page's "Cookies and browser storage" section and a §22 entry.
- Don't over-use the name "SleepSteps" (one word) in user-facing copy: another organisation has trademarked a "Sleep Steps" program. Prefer "this program", "we", "us", "our" or "this website" (SPEC §7.5). The name is in the header logo and the footer heading, and may appear in a few places the team chooses, such as About. Technical names (repo, Worker, databases, storage keys, events, files) keep `sleepsteps`.
- Never log feedback text or search queries to the console or Workers Logs.
- D1: parameterised queries only; schema changes only through new migration files.
- Accessibility: WCAG 2.2 AA. Use semantic HTML, labelled form controls and keyboard support for every widget.
- Never commit secrets, `.dev.vars`, data exports, `dist/` or `worker/generated/`.

## Human-only tasks

Do not attempt these. Tell the user when one is needed, referring to SPEC §18.4:
Cloudflare dashboard settings, account or domain setup, creating Turnstile widgets or Access applications, setting production secrets, applying remote migrations (`--remote`), and deploying to production.

You may run local commands: `npm run build`, `npm run dev`, `npm run dev:collect`, `npm test`, `npm run test:features`, `npm run test:a11y`, `npm run a11y:serve`, `npm run db:migrate:local`, and `wrangler dev`.

## Commands

```
npm install
npm run build          # validate content → Eleventy (search-index.json, worker/generated/pages.json) → dist/
npm run dev            # local site + Worker + local D1; collection is off, so /api/* answers 404
npm run dev:collect    # the same with collection on, for this run only (run db:migrate:local first)
npm test               # Vitest
npm run test:features  # the suite against all eight feature-switch combinations
npm run test:a11y      # axe + keyboard + reflow checks in local Chrome (Mac only; not in Workers Builds)
npm run a11y:serve     # local site, API and admin pages (sample data) for manual and screen-reader checks
npm run db:migrate:local
```

Use Turnstile's published test keys in local development.

## Content editing (for reference)

Problems are `content/problems/<slug>.md`, videos are a shared library in `content/videos/<video_id>.md`, areas are in `data/areas.csv`, and search synonyms are in `data/keywords.csv` (SPEC §7, §8.2). The build fails on unknown references and on missing media files. Never rename a `page_id` or `video_id` without adding a redirect (for pages) and updating every reference and `keywords.csv`.

Visual design comes from the Claude Design handoff in `docs/design/` (read `HANDOFF.md` first; the boards give exact spacing and copy). SPEC §7.5 and §22 list where the build deliberately differs from the handoff; the spec wins.
