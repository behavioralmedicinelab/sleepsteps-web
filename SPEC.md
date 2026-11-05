# Sleep Intervention Website — Technical Specification

Status: Draft v1 (2026-11-05)
Owner: <TEAM / PI NAME>
Domain: `<DOMAIN>` (placeholder throughout)

This document is the source of truth for what the site does and how it is built. When a decision here changes, update this file in the same commit as the code change.

---

## 1. Purpose and context

An informational and educational website supporting a clinical trial of a stepped-care sleep intervention. Participants can watch short videos, read transcripts or PDF handouts, or listen to audio-only versions. They can find content by describing their problem or by searching.

The site must stay online and freely available after the grant ends, with close to zero cost and maintenance. That requirement drives most of the design decisions below.

**Site engagement is not a trial outcome.** Analytics, ratings and feedback are for improving and reporting on the resource only. They are anonymous and are never linked to participants.

## 2. Design principles (in priority order)

1. **Static first.** All content is pre-built HTML/CSS/JS. Dynamic features are optional enhancements.
2. **Graceful degradation.** If the API is down, disabled or blocked, every page still works fully as a content site. No feature may block page rendering.
3. **Low maintenance.** Minimal dependencies, no client-side framework, no server we administer, nothing that needs regular patching to stay secure.
4. **Privacy by default.** No cookies, no persistent identifiers, no IP addresses stored, and no third-party scripts beyond those listed in §16.
5. **Editable by non-developers.** Content and keyword changes need only GitHub's web editor or a CSV upload.
6. **Accessible.** WCAG 2.2 AA.

## 3. Non-goals

- User accounts, logins or personalisation
- Linking any data to trial participants or study IDs
- Server-side rendering or a CMS
- Displaying ratings or aggregate scores publicly
- Comments or any user-generated content shown on the site
- Real-time monitoring of feedback (the site must state that feedback is not monitored for urgent issues)

## 4. Architecture overview

```
                    GitHub repo (source of truth)
                              │  push to main
                              ▼
                    Cloudflare Workers Builds
                    (npm run build → wrangler deploy)
                              │
                              ▼
 Browser ──HTTPS──▶  Cloudflare edge (DNS, bot controls, rate limiting)
                              │
               ┌──────────────┴───────────────┐
               ▼                              ▼
     Static assets (dist/)            Worker (worker/index.js)
     HTML, CSS, JS, MP3, PDF,         /api/*   → D1 database
     search-index.json                /admin/* → behind Cloudflare Access
                                              │
                                              ▼
                                        D1 (SQLite)
                                        ratings, feedback, events

 External: YouTube (video embeds via youtube-nocookie.com)
           Cloudflare Turnstile (spam protection on feedback)
```

A single Worker serves both the static site and the API. Requests that match a static file are served directly (free, unlimited). Other requests reach the Worker code.

## 5. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Static site generator | Eleventy (11ty), latest stable 3.x | JS toolchain, same language as the Worker |
| Templates | Nunjucks | Eleventy default |
| Browser JS | Plain ES modules, no bundler, no framework | Copied via Eleventy passthrough |
| Search | MiniSearch | Client-side, fuzzy, field boosts |
| Hosting + API | Cloudflare Workers with Static Assets | Free plan |
| Database | Cloudflare D1 | Free plan; create with location hint `oc` |
| Spam protection | Cloudflare Turnstile | Feedback form only |
| Admin auth | Cloudflare Access (email one-time PIN) | Free up to 50 users |
| Video | YouTube embeds, IFrame Player API | Privacy-enhanced host |
| Tooling | Node (current LTS), npm, Wrangler ≥ 4 | Pin all versions in `package.json` |
| Tests | Vitest with `@cloudflare/vitest-plugin` | Worker + build scripts. Successor to the deprecated `@cloudflare/vitest-pool-workers` |

Do not add dependencies beyond these without recording the reason in §22 (Decision log).

## 6. Repository layout

```
.
├── CLAUDE.md                  # Instructions for Claude Code
├── SPEC.md                    # This file
├── README.md                  # Human quick start + content editing guide
├── package.json
├── wrangler.jsonc
├── eleventy.config.js
├── site.config.json           # Site settings + feature switches (§11)
├── content/
│   ├── problems/              # One Markdown file per sleep problem (§7.2)
│   ├── videos/                # Video library: one file per video, no page of its own (§7.1)
│   ├── pages/                 # Information pages: help, about, contact, privacy, urgent help (§7.4)
│   ├── start.md               # "Start here" intro videos (§7.3)
│   ├── problems.njk           # Sleep problems browser (§7.2)
│   └── index.njk              # Home page
├── data/
│   ├── areas.csv              # The 10 problem areas (§7.2)
│   └── keywords.csv           # Search synonyms (§8.2)
├── media/
│   ├── audio/                 # MP3, ≤ 25 MiB each
│   ├── pdf/                   # Handouts
│   └── thumbs/                # Self-hosted video thumbnails (optional)
├── src/
│   ├── _includes/             # Layouts and partials (components in §7.5)
│   ├── img/                   # Logo and site images
│   ├── css/
│   └── js/                    # search.js, rating.js, feedback.js, events.js, players.js, api.js
├── scripts/
│   ├── build-data.js          # Builds search-index.json + pages.json, validates CSVs
│   └── validate-content.js    # Front matter + media file checks
├── worker/
│   ├── index.js               # Router
│   ├── routes/                # rate.js, feedback.js, event.js, admin.js
│   ├── lib/                   # validation, turnstile, access-jwt, csv
│   └── generated/             # pages.json (build output, git-ignored)
├── migrations/                # D1 SQL migrations
├── docs/
│   └── design/                # Claude Design handoff: HANDOFF.md, tokens, logo, mockups (§7.5)
├── test/
└── dist/                      # Build output (git-ignored)
```

`.gitignore` must include `dist/`, `worker/generated/`, `node_modules/`, `.wrangler/`, `exports/` and `*.csv.export`. **Data exports must never be committed.**

## 7. Content model

The site is organised around **sleep problems** (design handoff, §22). People pick a problem; each problem page shows a video about the problem and the solution videos for it. Videos live in a shared library and can appear on more than one page.

**Identifiers.** Every page has a `page_id`: a problem's slug, a fixed ID for the main pages (`home`, `start`, `problems`, `search`), or an information page's file name. Every video has a `video_id` (its file name). Both are lowercase, hyphenated and stable. **Never rename a `page_id` or `video_id` without adding a redirect (for pages) and updating every reference and `keywords.csv`.** `validate-content.js` fails the build on any dangling reference.

### 7.1 Videos (`content/videos/<video_id>.md`)

Videos have no page of their own (`permalink: false`); problem pages and Start here embed them.

```yaml
---
title: "Setting up a wind-down hour"
youtube_id: "AbCdEfGhIjK"
duration: "6:40"
audio: "wind-down-hour.mp3"          # optional, file in media/audio/
handout: "wind-down-hour.pdf"        # optional, file in media/pdf/ (format still open, §21)
thumbnail: "wind-down-hour.jpg"      # optional, file in media/thumbs/
---
Transcript in Markdown goes here (the body). Optional.
```

Required fields: `title`, `youtube_id`, `duration`. The transcript, handout and audio are optional, and the page hides any format a video doesn't have. The build fails if a referenced media file does not exist.

### 7.2 Areas and problems

**Areas (`data/areas.csv`).** The 10 groups problems are shown in. Edited in Excel like `keywords.csv`.

```csv
area_id,name,description,source_name,order
core,Falling and staying asleep,"Trouble getting to sleep, staying asleep, or waking unrefreshed.",Core insomnia problems,10
```

**Problems (`content/problems/<slug>.md`).** One file per problem, rendered at `/problems/<slug>/`.

```yaml
---
title: "Tired but wired"                       # short title: menus and H1
statement: "I'm tired, but I can't fall asleep" # the first-person line
source_title: "I am struggling to fall asleep at night: 1) ..."  # the team's original wording, not shown
area: core                                      # area_id from areas.csv
time_of_day: bedtime                            # evening | bedtime | night | early-morning | day | any
order: 10                                       # order within the area
new: false                                      # shows a "New" pill
problem_video: tired-but-wired                  # video_id
is_this_you:
  summary: "One or two plain sentences."
  bullets: ["...", "..."]                       # 2–4 items
solutions:                                      # 1–3 main, 0–3 extra, in display order
  - { tier: main, video: wind-down-hour, blurb: "Try this if ..." }
  - { tier: extra, video: worry-time, blurb: "Try this if ..." }
related: [not-sleepy-at-bedtime, stress-and-worries]   # 2–3 hand-picked problem slugs
---
```

The build fails on an unknown `area`, `time_of_day`, `video` or `related` slug, or on solution counts outside 1–3 main / 0–3 extra. It warns, without failing, when `related` has fewer than 2 entries or `is_this_you` is empty, so placeholder content can still build.

The **Sleep problems** page (`/problems/`) lists every problem in two views: by area (an accordion, the default) and "When it happens" (time-of-night lanes). Area anchors such as `/problems/#core` open that area. Without JavaScript, every area renders open.

### 7.3 Start here (`content/start.md`)

Lists the intro videos in order, each with a `video` (video_id) and a one-line `description`. Rendered at `/start/`.

### 7.4 Information pages (`content/pages/*.md`)

Standard Eleventy pages with `title` and `summary`. They are included in the search index unless `search: false` is set.

Required pages: Getting more help (`/help/`), About (`/about/`), Contact (`/contact/`), Privacy and your data (`/privacy/`, §15), Getting urgent help (`/urgent-help/`, with the crisis contacts from `site.config.json`), and 404.

### 7.5 Visual design and components

Layouts, copy and components follow the design handoff in `docs/design/` (start with `HANDOFF.md`; the boards in `reference/boards/` give exact spacing and copy, but their design-tool runtime is not copied). Its colour, type-scale, spacing and radius tokens are CSS custom properties in `src/css/`; components never hard-code values. Exceptions to the handoff, recorded in §22:

- **System fonts** instead of Figtree and Source Sans 3: no web fonts are loaded.
- **Ratings** follow §12, with no client ID.
- **Feedback** is only the footer dialog (§13); the mockups' per-video feedback forms and links are not built.

## 8. Search

### 8.1 Behaviour

- A search box in the header on every page. Submitting goes to `/search/?q=<query>`.
- The search page loads `search-index.json` and MiniSearch lazily, i.e. only on the search page or when the header box is focused.
- Results show title (linked), summary and content type. Show the top 10.
- With no results, show a message plus a link to the Sleep problems page.
- The query is kept in the URL so results are shareable and the Back button works.
- Log a `search` event with the query (truncated to 100 characters) and result count (§10).
- With JavaScript disabled, the search box links to the Sleep problems page.
- **Problems page filter** (separate from the site search): a live filter on `/problems/` matching each problem's short title, statement, area name and keywords. It filters both views as you type, hides areas with no matches and opens areas with matches, and announces the count ("4 topics match 'night'") in an `aria-live="polite"` region. It does not log events.

### 8.2 Keywords (`data/keywords.csv`)

```csv
page_id,keywords
hot-flushes-and-night-sweats,"hot flushes; hot flashes; menopause; tamoxifen; sweating; night sweats"
```

- One row per page. Keywords are separated by `;`.
- Include common misspellings and Australian/US spelling variants.
- The build fails if `page_id` is unknown. It warns, without failing, for pages that have no keywords row.
- Maintained by the clinical team in Excel (save as CSV UTF-8).

### 8.3 Index build (`scripts/build-data.js`)

The script outputs `dist/search-index.json`, an array of:

```json
{ "id": "hot-flushes-and-night-sweats", "url": "/problems/hot-flushes-and-night-sweats/", "title": "...",
  "summary": "...", "keywords": "hot flushes hot flashes ...", "transcript": "plain text", "type": "problem" }
```

There is one entry per page (`type` is `problem`, `start` or `page`). A problem's `summary` is its statement, and its `transcript` field joins the titles, blurbs and transcripts of every video on the page, so a match in a solution video's transcript leads to the problem page. Transcript Markdown is stripped to plain text.

The same script writes `worker/generated/pages.json` (`{ page_id: { url, title, videos: [video_id, ...] } }`), which the Worker uses to validate `page_id` and `video_id`.

### 8.4 MiniSearch configuration (starting point; tune against real queries)

```js
new MiniSearch({
  fields: ['title', 'keywords', 'summary', 'transcript'],
  storeFields: ['title', 'url', 'summary', 'type'],
  processTerm: (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
});
// search options
{ boost: { keywords: 4, title: 3, summary: 2, transcript: 1 },
  fuzzy: 0.2, prefix: true, combineWith: 'OR' }
```

Add a test file `test/search-queries.test.js` with real example queries and their expected top results, e.g. `"hot flashes"` → `hot-flushes-and-night-sweats` in the top 3. Rerun it after every keyword change.

## 9. Media

### 9.1 Video (YouTube)

- Use a click-to-load facade: a 16:9 frame (the video's self-hosted thumbnail if it has one, otherwise a plain `night-teal` frame), the video title, a duration badge and a play button. Load the YouTube player only after the user clicks, so YouTube isn't contacted until someone chooses to play. Never autoplay before that click.
- Then create the player via the IFrame Player API with `host: 'https://www.youtube-nocookie.com'` and `playerVars: { rel: 0, playsinline: 1 }` (plus `cc_load_policy: 1` if captions should be on by default, §21). The iframe's `title` names the video.
- Captions are uploaded to YouTube from the transcripts (team task). Don't rely on auto-captions.
- A link to watch on YouTube is shown as a fallback.
- Ratings and formats sit outside the player.

### 9.2 Audio

- Optional per video; the "Audio only" option is hidden when a video has none.
- `<audio controls preload="none">` with an MP3 in `media/audio/`.
- Each file must be ≤ 25 MiB (the static asset limit). Mono 64 kbps gives about 50 minutes per file. `validate-content.js` enforces the size limit.

### 9.3 Handout and transcript

- The handout is optional per video; its format (PDF, web page or both) is still open (§21). For now it is a download link to a PDF in `media/pdf/`. The team supplies handouts; they are not generated.
- The transcript is rendered as HTML under the video, in a `<details>` element labelled "Read transcript", with a "Print transcript" link. Opening it logs a `transcript_open` event.

### 9.4 Media tracking (`src/js/players.js`)

- Log `video_play` / `audio_play` on the first play per page load.
- Log `video_progress` / `audio_progress` at milestones 25/50/75/100%, each once per page load. These are based on the furthest position reached, not on watch time.
- Video: poll `getCurrentTime()` / `getDuration()` every 5 seconds while the state is PLAYING. Audio: use the `timeupdate` event.
- Log `pdf_download` on a handout click.

## 10. Analytics events

### 10.1 Client (`src/js/events.js`)

- `session_id` is `crypto.randomUUID()` stored in `sessionStorage`. Wrap access in try/catch; if storage is unavailable, use an in-memory ID for the page.
- Send with `navigator.sendBeacon('/api/event', JSON.stringify(payload))`, falling back to `fetch(..., { keepalive: true })`.
- Never send: user agent, screen size, referrer query strings, or anything typed except search queries.
- Do nothing if `features.events` is false.

### 10.2 Event types (closed list; the Worker rejects anything else)

| type | page | detail (JSON) |
|---|---|---|
| `page_view` | page_id or path | `{}` |
| `search` | `search` | `{ "q": string ≤100, "results": int }` |
| `problem_click` | `problems` | `{ "problem_id": slug }` |
| `video_play` | page_id | `{ "media": video_id }` |
| `video_progress` | page_id | `{ "media": video_id, "milestone": 25\|50\|75\|100 }` |
| `audio_play` | page_id | `{ "media": filename }` |
| `audio_progress` | page_id | `{ "media": filename, "milestone": 25\|50\|75\|100 }` |
| `pdf_download` | page_id | `{ "media": filename }` |
| `transcript_open` | page_id | `{}` |

## 11. Feature switches and failure handling

`site.config.json`:

```json
{
  "siteName": "<SITE_NAME>",
  "siteUrl": "https://<DOMAIN>",
  "features": { "ratings": true, "feedback": true, "events": true },
  "turnstileSiteKey": "<PUBLIC_SITE_KEY>",
  "crisisContacts": [
    { "label": "Emergency", "value": "000" },
    { "label": "Lifeline", "value": "13 11 14" }
  ]
}
```

- **Build time:** templates render a widget only if its feature is on. Its JS is loaded only if needed.
- **Worker:** imports the same file. A disabled feature's route returns `404`. Turning features off is therefore one config edit plus a push.
- **Runtime failure:** `src/js/api.js` wraps `fetch` with a 5-second timeout and no automatic retries. On failure, the widget shows a short inline message ("Couldn't send right now — please try again later") and the rest of the page is unaffected. Event logging fails silently.
- No widget may cause layout shift or block rendering while waiting for the API.

## 12. Ratings widget (`src/js/rating.js`)

- Shown under every video: the problem video and each solution on problem pages, and each intro video on Start here. Ratings are per video.
- Markup: a `<fieldset>` with legend "Was this helpful?" and five native radio inputs styled as stars (so arrow keys move between them), labelled "1 star" to "5 stars". Each star is at least a 44×44px target. Unfilled stars have a `slate-grey` outline; filled stars a `warm-clay` fill with a `clay-deep` outline.
- Selecting a star submits immediately: `POST /api/rate { page_id, video_id, stars }`.
- A status line under the stars reads "Ratings are anonymous." before rating and "Thanks. You rated this 4 of 5." after. The user may change the rating, and each change is a new row; duplicates are acceptable. No ID is stored, so a returning visitor's earlier rating is not shown.
- Short notice under the widget (§15.1).
- No aggregate score is displayed.

## 13. Feedback widget (`src/js/feedback.js`)

- A "Send feedback" link in the footer on every page opens a `<dialog>`. This is the only feedback entry point; there are no per-video feedback forms (§7.5).
- The dialog contains: the notice (§15.1), a `<textarea maxlength="2000">` with a label, a Turnstile widget, a Submit button and a Cancel button.
- Submit: `POST /api/feedback { page_id, message, turnstile_token }`. `page_id` comes from a `data-page-id` attribute on `<body>`; for pages without one, use the path.
- On success, show "Thanks — your feedback has been sent", then close the dialog.
- Load the Turnstile script only when the dialog opens.
- Focus is managed correctly and Escape closes the dialog.

## 14. Worker API

### 14.1 General rules (all `/api/*` routes)

- Only `POST` with `Content-Type: application/json` or `text/plain` (the latter for sendBeacon).
- Reject a body larger than 4 KB with `413`.
- Require the `Origin` header to match `siteUrl` or a configured preview origin; otherwise return `403`. No CORS headers are needed (same origin).
- Timestamps are generated server-side as ISO 8601 UTC. Client timestamps are never trusted.
- Validate `page_id` against `worker/generated/pages.json` (plus the fixed IDs `home` and `search`). Store titles from `pages.json`, never from the client.
- **Never store or log** IP addresses, user agents, `CF-Connecting-IP`, or feedback/search text in `console.log` (Workers Logs).
- Responses: `204` success, `400` validation error (`{ "error": "<code>" }`), `403` origin or Turnstile failure, `404` feature disabled, `413` too large, `429` (from the Cloudflare rate-limiting rule), `500` unexpected error (generic message).
- Use parameterised D1 queries only (`prepare().bind()`).

### 14.2 Routes

| Method & path | Body | Validation | Action |
|---|---|---|---|
| `POST /api/rate` | `{ page_id, video_id, stars }` | known page_id; video_id appears on that page; stars is an integer 1–5 | insert into `ratings` |
| `POST /api/feedback` | `{ page_id, message, turnstile_token }` | known page_id; message trimmed, 1–2000 characters; Turnstile verified | insert into `feedback` |
| `POST /api/event` | `{ type, page, session_id, detail }` | type in §10.2; session_id is a UUID; detail matches its type's shape; search q ≤ 100 characters | insert into `events` |
| `GET /admin/` | — | valid Access JWT | HTML summary (§14.4) |
| `GET /admin/export?table=ratings\|feedback\|events&from=YYYY-MM-DD&to=YYYY-MM-DD` | — | valid Access JWT; allowed table | CSV download |

### 14.3 Turnstile verification

`POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with form fields `secret` (from `env.TURNSTILE_SECRET`), `response`, and `remoteip` (from `CF-Connecting-IP`; used for verification only, never stored). Reject unless `success === true`.

### 14.4 Admin

- `/admin/*` is protected by a Cloudflare Access application (dashboard configuration, §18).
- As defence in depth, the Worker also verifies the `Cf-Access-Jwt-Assertion` header against the team's Access certificates (`https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/certs`) and the application's AUD tag (`env.ACCESS_AUD`, `env.ACCESS_TEAM_DOMAIN`). Return `403` if missing or invalid.
- The summary page shows, for a selectable date range (default: last 30 days):
  - page views and visits (distinct `session_id`) per page
  - rating count and mean per video (and per page)
  - top 20 searches with zero results
  - the 20 most recent feedback items
  - media plays and 100% completions per item
- CSV export is UTF-8 with a header row, and fields are escaped properly.

## 15. Privacy, notices and data

All notice wording is draft until approved by the HREC/privacy officer. Keep the text in one partial (`src/_includes/notices/`) so it's easy to update.

### 15.1 Inline notices

Under the ratings:
> Ratings are anonymous. We use them to improve these resources. [About the information we collect](/privacy/)

In the feedback dialog:
> Your feedback is anonymous. We receive your message and the page you were viewing. Please don't include your name, contact details or anything that could identify you. This box is not monitored for urgent issues. If you need help now, contact your treating team, call Lifeline on 13 11 14, or call 000 in an emergency.

### 15.2 Privacy and data page (`/privacy/`) must cover

- **What we collect:** star ratings, feedback text, search terms, and anonymous usage events (pages viewed, media played, downloads), each with the page and time.
- **What we don't collect:** names, contact details, cookies, or stored IP addresses. A temporary random code held in the browser tab, and deleted when the tab closes, is used to count visits; it cannot identify you.
- **Who processes data:** Cloudflare (hosting, database, spam protection); YouTube/Google when you choose to play a video (Google's privacy policy applies). Some processing may occur outside Australia.
- **Use:** improving these resources. This is separate from the trial's research data.
- **Retention:** <RETENTION PERIOD>. Collection stops when the funded project ends (§19).
- **Contact** and **HREC approval number:** <PLACEHOLDERS>.

### 15.3 Data inventory

| Table | Fields | Personal info? |
|---|---|---|
| ratings | ts, page, video, stars | No |
| feedback | ts, page, page_title, message | Free text may contain health or identifying info despite the notice; treat as sensitive |
| events | ts, session_id (per-tab random), page, type, detail | Search queries may contain health terms; anonymous |

## 16. Security, headers and bots

### 16.1 HTTP headers (`_headers` file for static assets; the Worker sets them on its own responses)

- `Content-Security-Policy`: start from the policy below. Deploy as `Content-Security-Policy-Report-Only` first, fix any violations shown in the browser console, then enforce.
  ```
  default-src 'self';
  script-src 'self' https://www.youtube.com https://challenges.cloudflare.com;
  frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com;
  img-src 'self' data:;
  connect-src 'self';
  style-src 'self';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  ```
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 16.2 Third-party scripts allowed

Only the YouTube IFrame API (loaded on click) and Turnstile (loaded when the feedback dialog opens). No analytics, fonts or tag-manager scripts from third parties. The site uses system font stacks and loads no web fonts (§7.5).

### 16.3 Cloudflare dashboard settings (manual, see §18)

- DNS records proxied; Always Use HTTPS
- AI crawler controls: Search allowed, Training blocked, Agent at team discretion; managed robots.txt on
- Bot Fight Mode on, then test that the forms still submit
- Rate-limiting rule: `/api/*`, e.g. 20 requests per 10 seconds per IP → block
- Search engines allowed. Verify crawling in Google Search Console after launch.

## 17. Database

Created with `wrangler d1 create sleep-site --location=oc`. The location hint affects placement only and is not a data-residency guarantee.

`migrations/0001_init.sql`:

```sql
CREATE TABLE ratings (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  page TEXT NOT NULL,
  video TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5)
);
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  page TEXT NOT NULL,
  page_title TEXT,
  message TEXT NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  session_id TEXT,
  page TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_ratings_page_ts ON ratings(page, ts);
CREATE INDEX idx_ratings_video_ts ON ratings(video, ts);
CREATE INDEX idx_feedback_ts ON feedback(ts);
CREATE INDEX idx_events_type_ts ON events(type, ts);
CREATE INDEX idx_events_page_ts ON events(page, ts);
```

Schema changes go through new migration files only (`wrangler d1 migrations create`, then `apply --local` before `apply --remote`). Never edit an applied migration.

Free plan limits (Nov 2026): 100,000 row writes/day and 5 million row reads/day; queries fail for the rest of the UTC day once a limit is exceeded. The free plan's point-in-time recovery covers only 7 days, so monthly CSV exports are the real backup. If limits become a problem, upgrade to Workers Paid (US$5/month); no code changes are needed.

## 18. Build, deploy and setup

### 18.1 npm scripts

| Script | Does |
|---|---|
| `npm run build` | `validate-content` → `build-data` → Eleventy → `dist/` |
| `npm run dev` | Eleventy watch + `wrangler dev` (local D1) |
| `npm test` | Vitest (Worker routes, validation, search queries, CSV parsing) |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations |

### 18.2 `wrangler.jsonc` (skeleton)

```jsonc
{
  "name": "sleep-site",
  "main": "worker/index.js",
  "compatibility_date": "<DATE OF SETUP>",
  "assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "404-page" },
  "d1_databases": [
    { "binding": "DB", "database_name": "sleep-site", "database_id": "<ID>", "migrations_dir": "migrations" }
  ],
  "vars": { "ACCESS_TEAM_DOMAIN": "<TEAM>.cloudflareaccess.com", "ACCESS_AUD": "<AUD_TAG>" }
  // Secrets (set with `wrangler secret put`, never committed): TURNSTILE_SECRET
}
```

- `compatibility_date` must be no later than the newest date the pinned Wrangler's bundled workerd supports; otherwise `wrangler dev` refuses to start. Raise it when upgrading Wrangler.
- The `ASSETS` binding lets the Worker hand non-`/api/`, non-`/admin/` requests back to static assets. When a Worker script is present, unmatched requests reach the Worker, so without this fallthrough unknown paths would not get the 404 page.

### 18.3 Deployment

Workers Builds is connected to the GitHub repo. Pushes to `main` build and deploy to production; other branches get preview URLs. Preview deployments share the production D1 binding unless a separate preview database is configured. **Decision: use a separate `sleep-site-preview` database for previews.**

### 18.4 Manual setup tasks (human only; Claude Code must not attempt dashboard changes)

1. Create the Cloudflare account (institutional email) and add a second admin.
2. Create a GitHub organisation and transfer the repo to it.
3. Buy the domain (10 years) and set nameservers to Cloudflare.
4. Run `wrangler login`, then create the production and preview D1 databases; put the IDs in `wrangler.jsonc`.
5. Create a Turnstile widget for the domain: put the site key in `site.config.json` and set the secret with `wrangler secret put TURNSTILE_SECRET`.
6. Create a Zero Trust team, an Access application for `<DOMAIN>/admin/*`, and a policy allowing team emails via one-time PIN; copy the AUD tag into `wrangler.jsonc`.
7. Connect Workers Builds to the repo.
8. Apply the security settings in §16.3.
9. Add the custom domain to the Worker.
10. Verify the domain in Google Search Console.

## 19. Operations

### 19.1 Monthly (~30 minutes)

- Export all three tables from `/admin/export` and store them in team storage (not the repo).
- Review the zero-result searches on `/admin/` and update `keywords.csv`.
- Read new feedback.

### 19.2 Adding a video

1. Upload to YouTube (unlisted or public) with captions.
2. Add any MP3, handout and thumbnail to `media/`.
3. Create `content/videos/<video_id>.md` with the front matter and transcript.
4. Reference the `video_id` from a problem's `problem_video` or `solutions`, or from `content/start.md`.
5. For a new problem, also create `content/problems/<slug>.md` and add a row to `keywords.csv`.
6. Commit; the build validates everything and deploys.

### 19.3 End of grant

1. Do a final export of all tables.
2. Set all `features` to `false` in `site.config.json` and push.
3. Delete or retain the D1 data per ethics approval, and update the privacy page accordingly.
4. Archive the videos, audio, PDFs and transcripts in Zenodo or the institutional repository.
5. Record account owners and the domain expiry date in `README.md`.

## 20. Implementation milestones

Each milestone is a separate PR with tests passing and acceptance criteria met.

| # | Milestone | Acceptance criteria |
|---|---|---|
| M0 | Scaffold | Eleventy builds to `dist/`; Worker serves it locally with `wrangler dev`; `npm test` runs |
| M1a | Design system + site shell | Tokens as CSS custom properties; system fonts; logo; header, mobile header and menu, footer and topic menu match the handoff and work without JS; the information pages and 404 render; keyboard and 320px-width checks pass |
| M1b | Content model + page templates | Areas, the 36 problems (placeholder text) and sample videos load; build fails on missing fields, unknown references, bad solution counts or missing media; Sleep problems page (both views, live filter, no-JS fallback); problem page with expanding solution cards for 1–3 main and 0–3 extras; video facade; Start here; Home |
| M2 | Search | Index built from content + keywords; search page works with fuzzy matching; query tests pass; no-JS fallback |
| M3 | Database + events | Migration applied locally; `/api/event` validates and inserts; page views and media milestones logged; origin check; feature switch off → 404 and no client calls |
| M4 | Ratings | Widget accessible by keyboard and screen reader; inserts rows; failure message shown when the API is stopped |
| M5 | Feedback | Dialog, Turnstile (using test keys locally), validation, notice text, failure handling |
| M6 | Admin | Summary page and CSV export; requests without a valid Access JWT get 403 |
| M7 | Hardening | Headers/CSP enforced without console errors; accessibility pass (axe, keyboard-only walkthrough); all features tested off and with API failure |
| M8 | Launch | Human setup tasks done (§18.4); production smoke test; privacy page approved |

## 21. Open decisions

- [x] Information architecture and navigation: resolved by the design handoff (§7, §22)
- [ ] Data retention period for ratings, feedback and events
- [ ] Whether to add an optional weekly feedback-digest email (scheduled Worker; needs Email Routing)
- [ ] Whether the AI "Agent" crawler category is allowed
- [ ] Domain (the site name is SleepSteps; the visual design comes from the handoff)
- [x] Whether ratings appear on non-video pages: no, ratings are per video (§12)
- [ ] Handout format: PDF, web page, or both
- [ ] Whether audio-only versions are being made
- [ ] Urgent-help numbers and the region they apply to (the mockups assume Australia: 000, Lifeline 13 11 14) and the cancer support line
- [ ] Whether captions are on by default (`cc_load_policy`)
- [ ] Team review of each problem's area and time-of-day placement, related topics and keywords
- [ ] Whether a horizontal logo lockup exists (the stacked logo's wordmark is small at header size)

## 22. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-05 | Static site + single Cloudflare Worker + D1 | Low cost and maintenance; no server to administer |
| 2026-11-05 | MiniSearch over Fuse.js | Word-level fuzzy matching handles multi-word queries and long transcripts |
| 2026-11-05 | Own D1 event logging over Cloudflare Web Analytics or GoatCounter | Unsampled, custom events, unlimited retention, one system |
| 2026-11-05 | Host on Cloudflare instead of GitHub Pages | Enables bot controls, same-origin API, single deployment |
| 2026-11-05 | No cookies or persistent IDs; per-tab session ID only | Anonymity commitment; engagement is not a trial outcome |
| 2026-11-05 | Click-to-load YouTube facade | No contact with YouTube until the user chooses to play |
| 2026-11-05 | `@cloudflare/vitest-plugin` instead of `@cloudflare/vitest-pool-workers` | The old package is deprecated and renamed; its last release pins an old Wrangler/miniflare with high-severity audit findings |
| 2026-11-05 | Pin exact dependency versions released at least two weeks earlier, unless a newer release fixes a security advisory | Lowers supply-chain risk for a site meant to run untended. Wrangler and the Vitest plugin are kept on matching versions so only one Wrangler is installed |
| 2026-11-05 | Adopt the Claude Design handoff: site organised around 36 problem pages in 10 areas, with a shared video library, Start here and information pages | Settles the information architecture; matches how participants look for help. Replaces one page per video and `problems.csv` |
| 2026-11-05 | Ratings per video with no client ID (declined the handoff's localStorage `clientId`) | Keeps the no-persistent-identifier commitment; changed ratings are extra rows |
| 2026-11-05 | Feedback only through the footer dialog with Turnstile (declined the handoff's per-video inline forms and honeypot-only protection) | One place to manage the notice and spam protection |
| 2026-11-05 | System font stacks instead of the handoff's Figtree and Source Sans 3 from Google Fonts | No third-party requests and no font files to maintain |
| 2026-11-05 | Transcript, handout and audio are optional per video and hidden when absent | The handout format and audio versions are not decided yet |
