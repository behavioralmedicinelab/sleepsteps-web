# Sleep Intervention Website — Technical Specification

Status: Draft v1 (2026-11-05)
Owner: Joshua Wiley
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
├── LICENSE                    # Code: MIT
├── LICENSE-CONTENT.md         # Content: CC BY 4.0 (§22)
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
├── data/                      # Eleventy global data: each CSV becomes an array of row objects
│   ├── areas.csv              # The 10 problem areas (§7.2)
│   └── keywords.csv           # Search synonyms (§8.2)
├── media/
│   ├── audio/                 # MP3, ≤ 25 MiB each
│   ├── pdf/                   # Handouts
│   └── thumbs/                # Self-hosted video thumbnails (optional)
├── src/
│   ├── _includes/             # layouts/, partials/ (components in §7.5), notices/ (§15)
│   ├── img/                   # Logo and site images
│   ├── css/                   # tokens.css, site.css, pages/<page>.css (§7.5)
│   └── js/                    # menu.js, search.js, rating.js, feedback.js, events.js, players.js, api.js
├── scripts/
│   ├── build-data.js          # Builds search-index.json + pages.json, validates CSVs
│   ├── validate-content.js    # Front matter + media file checks
│   └── lib/csv.js             # Dependency-free RFC 4180 CSV parser (Excel CSV UTF-8 exports)
├── worker/
│   ├── index.js               # Router
│   ├── routes/                # rate.js, feedback.js, event.js, admin.js
│   ├── lib/                   # validation, turnstile, access-jwt, csv
│   └── generated/             # pages.json (build output, git-ignored)
├── migrations/                # D1 SQL migrations
├── docs/
│   └── design/                # Claude Design handoff: HANDOFF.md, tokens, logo, mockups (§7.5)
├── test/
│   ├── worker/                # Vitest project "worker": runs in workerd
│   └── node/                  # Vitest project "node": build scripts and built-site checks
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

Standard Eleventy pages with `title` and `summary`. They are included in the search index unless `search: false` is set. A page's `page_id` is its file name and it renders at `/<file name>/` (`content/pages/pages.11tydata.js`).

They use the information layout (`src/_includes/layouts/info.njk`, whose header comment is the full contract): a teal title band, the "Information pages" side menu and the content column. Front matter: `title` and `summary` (required; the summary is the lede under the H1 and the meta description), and optionally `eyebrow` (default "Information"), `heading` (H1 text when it differs from the title), `band: hero` (the About hero with the settling arc) and `styles` (extra stylesheets, e.g. `["pages/help.css"]`). Any page can list `styles`; only paths under `src/css/` are accepted.

Required pages: Getting more help (`/help/`), About (`/about/`), Contact (`/contact/`), Privacy and your data (`/privacy/`, §15), Getting urgent help (`/urgent-help/`, with the crisis contacts from `site.config.json`), and 404 (`content/404.njk`, output as `/404.html`, no `page_id`).

**Getting urgent help is deliberately minimal** (design handoff §6.5): it uses `layouts/urgent.njk`, which sets `header: minimal` (the logo and "Back to SleepSteps" only: no nav, search box or menu script) and `footer: false`. It is the one exception to the header search box (§8.1) and the footer "Send feedback" link (§13). Under the crisis cards (§11), smaller white cards come from the page's `other_contacts` front matter (`heading`, `description`, optional `value`): a card whose `value` is a confirmed number (not a `[placeholder]`) is a whole-card `tel:` link with the hover shadow. "Your treating team" has no number (it is on each person's care plan), so its card is information, not a link. The page carries no draft or developer notes (a test checks this); what the team still has to confirm is tracked in §21.

### 7.5 Visual design and components

Layouts, copy and components follow the design handoff in `docs/design/` (start with `HANDOFF.md`; the boards in `reference/boards/` give exact spacing and copy, but their design-tool runtime is not copied). Its colour, type-scale, spacing and radius tokens are CSS custom properties defined once in `src/css/tokens.css`, the only stylesheet allowed to contain colour values (a test enforces this); components never hard-code values. `src/css/site.css` holds the base styles, the shell components and the page layouts; a page adds its own CSS through `styles` front matter (§7.4).

Token rules:

- **Spacing:** the token scale (4–32px) plus layout steps `space-9` to `space-14` (40, 48, 56, 64, 72, 96px) for page padding and section gaps. Board values off the scale snap up to the next step (10→12, 14→16, 18→20, 22→24, 28→32, 36→40, 44→48).
- **Type:** the tokens.json styles, plus values the handoff gives outside it: interior H1 48px, problem H1 44px, phone H1 34px, the 19/30 lede and the problem statement at 22px. All running text is at least 17px; the boards' 15–16px running text is raised to 17px.
- **Colour pairs:** only pairs tokens.json lists as passing. So the footer's secondary text is `paper` (the board's `on-teal-muted` on `ink` is not listed) and the urgent-help notice text is `clay-deep` on `clay-wash`.
- **Focus ring:** 2px solid with a 2px offset, `deep-teal` on light grounds and `paper` on teal or ink (handoff §10), with two exceptions. On the urgent-help notice's `clay-wash` ground the ring is `clay-deep`, the only colour tokens.json lists on that ground. The header search input is joined to its `deep-teal` submit button, so its ring is drawn just inside the input's box (at the usual offset its right side would sit on the button and vanish).
- **Page width:** 1200px by default, 1280px (`page_width: medium`: Start here, Sleep problems) or 1360px (`page_width: wide`: problem pages), as on the boards.
- **Targets:** every link and control is at least 44×44px, so TopicNav's problem, chapter and info links are 44px tall (36–40px on the board). This includes links inside a sentence (stricter than WCAG 2.5.8): they are `inline-flex` with a 44px minimum height, as on the urgent-help notice, the search page's no-JavaScript link and `.link-standalone`.
- **Logo:** the stacked logo only (there is no horizontal lockup). If a header ever can't fit it, it drops the logo for a "SleepSteps" text link to the home page rather than shrinking or altering it.
- **Disclosures without JavaScript:** TopicNav areas and the phone Menu are native `<details>`/`<summary>`. `src/js/menu.js` upgrades the Menu to a `<button aria-expanded aria-controls>` with Escape-to-close; TopicNav ships no JavaScript.

Exceptions to the handoff, recorded in §22:

- **System fonts** instead of Figtree and Source Sans 3: no web fonts are loaded.
- **Ratings** follow §12, with no client ID.
- **Feedback** is only the footer dialog (§13); the mockups' per-video feedback forms and links are not built.

## 8. Search

### 8.1 Behaviour

- A search box in the header on every page except Getting urgent help (§7.4). Submitting goes to `/search/?q=<query>` (a plain GET form, so it works without JavaScript).
- The search page loads `search-index.json` and MiniSearch lazily, i.e. only on the search page or when the header box is focused.
- Results show title (linked), summary and content type. Show the top 10.
- With no results, show a message plus a link to the Sleep problems page.
- The query is kept in the URL so results are shareable and the Back button works.
- Log a `search` event with the query (truncated to 100 characters) and result count (§10).
- With JavaScript disabled, the search box still submits to `/search/`, whose static HTML says that results need JavaScript and links to the Sleep problems page.
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

- Log **one `video_play` / `audio_play` event per media item per page load**, carrying the furthest point reached: `0` (played, but under 25%), `25`, `50`, `75` or `100`. It is based on the furthest position reached, not on watch time. There are no separate progress events.
  - Send it immediately on reaching 100%. Otherwise send it when the page is hidden (`visibilitychange` to hidden, or `pagehide`) if the item was played at all.
  - If the page is hidden and shown again and the item later reaches a higher point, send one more event with the new value. Analysis takes the highest value per session, page and item.
  - A play is lost if the tab is killed without being hidden first, which is rare.
- Video: poll `getCurrentTime()` / `getDuration()` every 5 seconds while the state is PLAYING. Audio: use the `timeupdate` event.
- Log `pdf_download` when a handout link is clicked (whether the browser opens or downloads it).

## 10. Analytics events

### 10.1 Client (`src/js/events.js`)

- `session_id` is `crypto.randomUUID()` stored in `sessionStorage`. Wrap access in try/catch; if storage is unavailable, use an in-memory ID for the page.
- Send with `navigator.sendBeacon('/api/event', JSON.stringify(payload))`, falling back to `fetch(..., { keepalive: true })`.
- Never send: user agent, screen size, referrer query strings, or anything typed except search queries.
- Do nothing if `features.events` is false.

### 10.2 Event types (closed list; the Worker rejects anything else)

| type | page | detail (JSON) |
|---|---|---|
| `page_view` | page_id: **only** problem pages, `start` and `urgent-help` (a template sets `track_page_view: true`; no other page sends one) | `{}` |
| `search` | `search` | `{ "q": string ≤100, "results": int }` |
| `video_play` | page_id | `{ "media": video_id, "furthest": 0\|25\|50\|75\|100 }` (§9.4) |
| `audio_play` | page_id | `{ "media": filename, "furthest": 0\|25\|50\|75\|100 }` (§9.4) |
| `pdf_download` | page_id | `{ "media": filename }` |
| `transcript_open` | page_id | `{ "media": video_id }`: which video's transcript, since problem pages hold several videos |

## 11. Feature switches and failure handling

`site.config.json`:

```json
{
  "siteName": "SleepSteps",
  "siteUrl": "https://<DOMAIN>",
  "features": { "ratings": true, "feedback": true, "events": true },
  "turnstileSiteKey": "<PUBLIC_SITE_KEY>",
  "crisisRegion": "[Australia]",
  "crisisContacts": [
    { "label": "Emergency", "value": "000",
      "heading": "If you are in danger, or need emergency care", "description": "Police, ambulance or fire" },
    { "label": "Lifeline", "value": "13 11 14",
      "heading": "To talk to someone now", "description": "Lifeline · crisis support, 24 hours" }
  ]
}
```

The Getting urgent help page renders one card per `crisisContacts` entry, in order: `heading` (falls back to `label`), `description`, and `value` as a `tel:` link (digits and a leading `+` only). `crisisRegion` names the region the numbers apply to.

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

- A "Send feedback" link in the footer on every page except Getting urgent help (§7.4) opens a `<dialog>`. This is the only feedback entry point; there are no per-video feedback forms (§7.5).
- The link is an `<a href="/contact/">` in the HTML, rendered only when `features.feedback` is on. `feedback.js` replaces it with a `<button>` that opens the dialog; until then (M1a–M4), and whenever JavaScript is off or the script fails, it leads to the Contact page.
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

- `/admin` and `/admin/*` are protected by a Cloudflare Access application (dashboard configuration, §18.4). The application lists **both** paths, because `admin/*` alone does not cover `/admin`, and its policy allows named emails only, never a whole email domain.
- The Worker must run first for these paths (`run_worker_first`, §18.2). Otherwise a browser opening `/admin/` gets the static 404 page without the Worker running.
- As defence in depth, the Worker also verifies the `Cf-Access-Jwt-Assertion` header against the team's Access certificates (`https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/certs`) and the application's AUD tag (`env.ACCESS_AUD`, `env.ACCESS_TEAM_DOMAIN`). Return `403` if missing or invalid.
- The summary page shows, for a selectable date range (default: last 30 days):
  - page views and visits (distinct `session_id`) per tracked page: problem pages, Start here and Getting urgent help (§10.2). Visits that touch only other pages are not counted.
  - rating count and mean per video (and per page)
  - top 20 searches with zero results
  - the 20 most recent feedback items
  - media plays per item, and how far people got (the highest `furthest` per session, page and item, grouped as under 25%, 25%, 50%, 75% and 100%)
  - transcript opens and handout clicks per item
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
- **What we don't collect:** names, contact details (except as below), cookies, or stored IP addresses. A temporary random code held in the browser tab, and deleted when the tab closes, is used to count visits; it cannot identify you.
- **If you email or phone the team** (the Contact page, which is also where "Send feedback" leads until M5 and without JavaScript, §13): this is not anonymous. The team receives the email address or phone number with the message, uses it only to reply, and keeps it outside the site's data (never in D1) and unlinked to it, for <RETENTION PERIOD>. The Contact page says so too.
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
- **Links to other sites** load nothing, so the CSP doesn't cover them. They are kept deliberate instead: a build test allows `<a href>` only to hosts on its allowlist (`www.youtube.com` for "Watch on YouTube", §9.1; `policies.google.com` for Google's privacy policy, §15.2), over `https`, with `rel="noreferrer"` so the other site isn't told the visitor came from SleepSteps. Every other attribute that loads something (`src`, `srcset`, `poster`, `<link href>`, `action`, …) must be same-origin.
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 16.2 Third-party scripts allowed

Only the YouTube IFrame API (loaded on click) and Turnstile (loaded when the feedback dialog opens). No analytics, fonts or tag-manager scripts from third parties. The site uses system font stacks and loads no web fonts (§7.5).

### 16.3 Cloudflare dashboard settings (manual, see §18)

These apply to the custom domain only, never to `workers.dev` or preview URLs.

- DNS records proxied; Always Use HTTPS
- AI Crawler and Agent access policies: Search **Allow**; Training **Disallow** (not Block, which also catches crawlers used for both search and training) with "Bot Preference Sync" on, which writes the managed robots.txt; Agent and Personal Agents at team discretion (§21)
- Bot Fight Mode: **decision pending (§21).** It sets a `__cf_bm` cookie and injects a script into every page, which conflicts with §2, §15.2 and the CSP in §16.1 as currently written. On the Free plan it can't be skipped for `/api/*`. Leave it off until decided.
- Rate-limiting rule: URI path starts with `/api/`, 20 requests per 10 seconds per IP → block for 10 seconds. The Free plan allows one rule, can't match on method, and returns Cloudflare's default 429. It limits each IP, not the total.
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
CREATE INDEX idx_ratings_ts ON ratings(ts);
CREATE INDEX idx_feedback_ts ON feedback(ts);
CREATE INDEX idx_events_type_ts ON events(type, ts);
```

One secondary index per table: every insert writes 2 rows (the row plus one index entry). Admin queries filter events by `type IN (...)` and a `ts` window so they use `idx_events_type_ts`, and ratings and feedback by a `ts` window (§14.4).

Schema changes go through new migration files only (`wrangler d1 migrations create`, then `apply --local` before `apply --remote`). Never edit an applied migration.

Free plan limits (Nov 2026): 100,000 rows written/day and 5 million rows read/day **per account**, and a 500 MB database. Each secondary index adds a written row, so one insert costs 2 rows (§17 schema): the real ceiling is about 50,000 events a day. Once either daily limit is hit, **every** D1 query fails until 00:00 UTC (10:00 AEST): saving, the admin page and the export. Pages and media keep working, and there is never a bill. The 500 MB cap does not reset. The free plan's point-in-time recovery covers only 7 days, so monthly CSV exports are the real backup.

If limits become a problem, upgrade to Workers Paid (US$5/month): no daily cut-off, 10 GB per database and 30-day point-in-time recovery. The plan switch itself needs no code changes. Export paging, index-friendly admin queries and any retention job are needed on either plan (§14.4). Use a Cloudflare account dedicated to this project, since the limits are shared across the account.

## 18. Build, deploy and setup

### 18.1 npm scripts

| Script | Does |
|---|---|
| `npm run build` | `validate-content` → `build-data` → Eleventy → `dist/` |
| `npm run dev` | Eleventy watch + `wrangler dev` (local D1) |
| `npm test` | Vitest, two projects: `worker` (Worker routes and validation, in workerd via `@cloudflare/vitest-plugin`) and `node` (build scripts, CSV parsing, search queries, and checks on a fresh build of the site in a temporary directory) |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations |

### 18.2 `wrangler.jsonc` (skeleton)

```jsonc
{
  "name": "sleep-site",
  "main": "worker/index.js",
  "compatibility_date": "<DATE OF SETUP>",
  "assets": {
    "directory": "./dist", "binding": "ASSETS", "not_found_handling": "404-page",
    "run_worker_first": ["/api/*", "/admin", "/admin/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "sleep-site", "database_id": "<ID>", "migrations_dir": "migrations" }
  ],
  "vars": { "ACCESS_TEAM_DOMAIN": "<TEAM>.cloudflareaccess.com", "ACCESS_AUD": "<AUD_TAG>" }
  // Secrets (set with `wrangler secret put`, never committed): TURNSTILE_SECRET
}
```

- `compatibility_date` must be no later than the newest date the pinned Wrangler's bundled workerd supports; otherwise `wrangler dev` refuses to start. Raise it when upgrading Wrangler.
- **Routing.** With this compatibility date, a browser *navigation* to a path with no matching file gets the 404 page straight from static assets, without the Worker running. Other unmatched requests (fetch, beacons, crawlers' `robots.txt`) reach the Worker, and the `ASSETS` binding lets it hand non-`/api/`, non-`/admin/` ones back to static assets. `run_worker_first` sends `/api/*` and `/admin*` to the Worker first; `/admin/` page loads need it (M6).
- **Previews.** Worker Previews do not inherit bindings or vars. A `previews` block gives them their own `d1_databases` binding (the `sleep-site-preview` database) and vars. Preview migrations use a separate config file, and preview secrets are set with `wrangler preview base-config secret put`. The setup PR adds these before Workers Builds is connected (§18.3).
- **At launch**, `"workers_dev": false` stops production answering on `workers.dev` (switching it off in the dashboard is undone by the next deploy), and `preview_urls` stays on.

### 18.3 Deployment

Workers Builds is connected to the GitHub repo. Pushes to `main` build and deploy to production; other branches get preview URLs. **Previews use a separate `sleep-site-preview` database** (§18.2).

- **Build command:** `npm test && npm run build`, so a failing test stops the deploy. Deploy command `npx wrangler deploy`. Builds ignores `engines`, so the Node version is pinned in `.node-version` (Builds defaults to an older Node).
- **The setup PR merges first.** The real D1 IDs and the `previews` block must be on `main` before Builds is connected, or the first deploy fails.
- **Before launch the site is unlisted.** Production is public at `<worker>.<subdomain>.workers.dev` as soon as Builds deploys, and zone settings (§16.3) don't apply there. Until launch:
  - production on `workers.dev` sends `X-Robots-Tag: noindex` (preview URLs already do);
  - data collection (`features`) stays off in production until the privacy officer's go-ahead (§15).
- **At launch** the custom domain is added and `workers_dev` is turned off (§18.2).

### 18.4 Manual setup tasks (human only; Claude Code must not attempt dashboard changes)

1. Create a Cloudflare account dedicated to this project (institutional role mailbox, app-based 2FA) and add a second Super Administrator.
2. ~~Create a GitHub organisation and transfer the repo to it.~~ Done (`behavioralmedicinelab/sleepsteps-web`). Also: require 2FA, have two owners, and add a ruleset on `main` (pull request required, only named people can merge, since every merge deploys).
3. Register the domain. **Interim plan: a `.org` through Cloudflare Registrar** (multi-year term, auto-renew on an institutional card); a university domain is under discussion (§21). A `.au` licence runs at most 5 years and Cloudflare Registrar doesn't sell `.au`.
4. Run `wrangler login`, then create the production and preview D1 databases (`--location=oc`, without `--update-config`) and send Claude both IDs for the setup PR.
5. Create a Turnstile widget (Managed mode, **Pre-clearance off**, since it sets a cookie): hostnames are the `workers.dev` address until the domain exists, then the domain. Put the site key in `site.config.json`; set the secret with `wrangler secret put TURNSTILE_SECRET`, and the preview secret to Turnstile's always-pass test value with `wrangler preview base-config secret put TURNSTILE_SECRET`.
6. Create a Zero Trust team (Free plan), add the One-time PIN login method, and create an Access application for `<DOMAIN>/admin` **and** `<DOMAIN>/admin/*` with a policy listing named emails; send Claude the AUD tag.
7. Merge the setup PR, then connect Workers Builds (§18.3 settings) and turn on preview builds.
8. Apply the security settings in §16.3 once the domain is active on Cloudflare.
9. Add the custom domain to the Worker (Claude's launch PR sets `workers_dev: false`).
10. Verify the domain in Google Search Console (DNS TXT record).

Order matters: the D1 IDs must be on `main` before step 7; the domain must be active on Cloudflare before steps 8–9; the Access application and the Turnstile hostname must exist before step 9.

## 19. Operations

### 19.1 Monthly (~30 minutes)

- Export all three tables from `/admin/export` and store them in team storage (not the repo).
- Review the zero-result searches on `/admin/` and update `keywords.csv`.
- Read new feedback.
- Check the D1 dashboard: daily rows written and database size against the free limits (§17).

**Quarterly:** remove people who have left from Cloudflare, Access policies, GitHub, YouTube and Search Console, and check that the second admins can still sign in.

**Yearly:** recheck crisis and support numbers and external links; check the domain expiry and that the renewal card is valid; upgrade Wrangler and raise `compatibility_date` (§18.2). Sign in to the Google accounts that own YouTube and Search Console at least every 2 years, or Google may delete them as inactive.

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
| M3 | Database + events | Migration applied locally; `/api/event` validates and inserts; page views and media plays (with the furthest point reached) logged; origin check; feature switch off → 404 and no client calls |
| M4 | Ratings | Widget accessible by keyboard and screen reader; inserts rows; failure message shown when the API is stopped |
| M5 | Feedback | Dialog, Turnstile (using test keys locally), validation, notice text, failure handling |
| M6 | Admin | Summary page and CSV export; requests without a valid Access JWT get 403 |
| M7 | Hardening | Headers/CSP enforced without console errors; accessibility pass (axe, keyboard-only walkthrough); all features tested off and with API failure |
| M8 | Launch | Human setup tasks done (§18.4); production smoke test; privacy page approved; urgent-help numbers, cancer support line and region confirmed (§21) |

## 21. Open decisions

- [x] Information architecture and navigation: resolved by the design handoff (§7, §22)
- [ ] Data retention period for ratings, feedback and events
- [ ] Whether to add an optional weekly feedback-digest email (scheduled Worker; needs Email Routing)
- [ ] Whether the AI "Agent" crawler category is allowed
- [ ] Domain: interim plan is a `.org` through Cloudflare Registrar; a university domain is under discussion (the site name is SleepSteps)
- [ ] Bot Fight Mode and cookies: whether to allow Cloudflare's bot-protection cookie and injected script, disclosed on the privacy page, with the CSP change it needs (§16.3; research on GDPR/ePrivacy and disclosure practice in progress)
- [x] Content licence: CC BY 4.0, excluding the SleepSteps name and logo and third-party material (`LICENSE-CONTENT.md`, §22)
- [ ] Code licence: the owner asked about CC BY 4.0 for the code too; Creative Commons advises against CC licences for software, so the code stays MIT until confirmed
- [ ] Copyright holder: `Behavioural Medicine Lab` is used in both licence files; confirm with the university's IP policy who owns staff-created materials
- [ ] Whether to move to Workers Paid (US$5/month) at launch, for no daily cut-off and 30-day recovery (§17)
- [x] Whether ratings appear on non-video pages: no, ratings are per video (§12)
- [ ] Handout format: PDF, web page, or both
- [ ] The one-page GP summary on Getting more help: format, content and who writes it (until then the line is `[placeholder]` text; `gp_summary` in `content/pages/help.md` turns it into a link, §22)
- [ ] Whether audio-only versions are being made
- [ ] Urgent-help numbers and the region they apply to (the mockups assume Australia: 000, Lifeline 13 11 14) and the cancer support line
- [ ] Whether captions are on by default (`cc_load_policy`)
- [ ] Team review of each problem's area and time-of-day placement, related topics and keywords
- [x] Horizontal logo lockup: none; where the stacked logo doesn't fit, the header drops it for a text home link (§7.5)

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
| 2026-11-05 | `data/` is Eleventy's global data directory, read through a CSV data extension backed by a dependency-free parser in `scripts/lib/csv.js` | Editors keep using Excel; no CSV package to maintain; the Worker and build scripts can share the parser |
| 2026-11-05 | Vitest split into `worker` and `node` projects; node tests build the site into a temporary directory first (Eleventy CLI with `--output`) | The Workers pool can't run Node build scripts; checks never read a stale `dist/` or disturb `npm run dev` |
| 2026-11-05 | Getting urgent help keeps the handoff's minimal header and has no footer, so it has no header search box or "Send feedback" link (§7.4, §8.1, §13) | A crisis page should offer only the crisis contacts and a way back; feedback isn't monitored for urgent issues |
| 2026-11-05 | The footer "Send feedback" link points to `/contact/` until the dialog lands (M5), and stays as its no-JavaScript fallback | No dead links before M5; the Contact page covers feedback by email |
| 2026-11-05 | TopicNav areas and the phone Menu are native `<details>`/`<summary>`; `menu.js` upgrades the Menu to an `aria-expanded` button | Both work without JavaScript, with no layout shift; the handoff's `onClick` toggles don't |
| 2026-11-05 | Off-scale board spacing snaps up to the next step; layout steps `space-9`–`space-14` added; boards' 15–16px running text raised to 17px; TopicNav rows raised to 44px | One spacing scale defined once; the 17px and 44×44px rules (§7.5) |
| 2026-11-05 | Only colour pairs listed as passing in tokens.json: footer secondary text `paper` instead of `on-teal-muted`; urgent notice text `clay-deep` instead of `ink` | Every pair used has been checked against WCAG AA |
| 2026-11-05 | `crisisContacts` entries gain `heading` and `description`; `crisisRegion` added (§11) | The urgent-help cards come from config, not the template |
| 2026-11-05 | Urgent-help notice focus ring is `clay-deep`, not `deep-teal`; the header search input's ring is drawn inside its box (§7.5) | `clay-deep` is the only colour tokens.json lists on `clay-wash`; the input is joined to a `deep-teal` button that would hide the ring's right side |
| 2026-11-05 | Links inside a sentence also get 44px-tall targets (§7.5) | Keeps the project's 44×44px rule without exceptions, though WCAG 2.5.8 exempts them |
| 2026-11-05 | Privacy page and Contact page say that emailing or phoning the team is not anonymous (§15.2) | "Send feedback" leads to Contact until M5 and without JavaScript, so the privacy page must not claim contact details are never collected |
| 2026-11-05 | Outgoing links allowed to an allowlist of hosts, with `rel="noreferrer"`; Privacy links to Google's privacy policy as the board's "YouTube privacy policy" (§16.1) | §9.1 needs a "Watch on YouTube" link; a link loads nothing, and `noreferrer` keeps the visit private |
| 2026-11-05 | Getting urgent help: the smaller cards become `tel:` links once their number is confirmed; "Your treating team" stays text; no developer notes on the page (§7.4) | The board shows tappable cards, but the treating team's number is on each care plan; a person in crisis should see only the contacts |
| 2026-11-05 | The GP summary line on Getting more help stays `[placeholder]` text until `gp_summary` names a file in `media/pdf/` (§21) | No dead link; the tests fail if the named file is missing |
| 2026-11-05 | No horizontal logo lockup; where the stacked logo doesn't fit, the header uses a "SleepSteps" text home link instead (§7.5) | The designer supplied only the stacked logo, which must not be altered |
| 2026-11-05 | The repository stays public | Open by default; draft content in the repo is visible before approval, which the team accepts |
| 2026-11-05 | Interim domain: a `.org` through Cloudflare Registrar; a university domain is under discussion (§18.4) | `.au` licences run at most 5 years and Cloudflare Registrar doesn't sell `.au`; `.org` goes straight onto Cloudflare |
| 2026-11-05 | Worker Previews get their own D1 binding and vars through a `previews` block, with separate preview migrations and secrets (§18.2) | Previews don't inherit bindings; keeps test data out of the production database |
| 2026-11-05 | Workers Builds runs `npm test && npm run build`; Node is pinned in `.node-version` (§18.3) | Builds runs only the build command and ignores `engines`; a failing test must block the deploy |
| 2026-11-05 | Unlisted before launch: production on `workers.dev` sends `noindex`, and data collection stays off in production until the privacy officer's go-ahead (§18.3) | The repo is public anyway, so a login gate adds little; avoids indexing drafts and collecting data before approval |
| 2026-11-05 | `run_worker_first` for `/api/*`, `/admin` and `/admin/*`; Access covers both `/admin` and `/admin/*` with named emails (§14.4, §18.2) | Browser navigations to unmatched paths otherwise get the static 404 without the Worker running; `admin/*` alone doesn't cover `/admin` |
| 2026-11-05 | Lighter event load: drop `idx_events_page_ts` (no admin query uses it); one ratings index on `ts` instead of `(page, ts)` and `(video, ts)`; one progress event per media item per page load carrying the furthest milestone, instead of one per milestone (§9.4, §10.2, §17) | Roughly halves rows written and storage per visit (about 32.6 → 16 rows) and doubles how long the free plan lasts, losing only the time each milestone was reached |
| 2026-11-05 | Leaner events, superseding the progress part of the row above: `video_play`/`audio_play` carry the furthest point reached (0/25/50/75/100) and the progress events are dropped; `problem_click` dropped; `page_view` only on problem pages, Start here and Getting urgent help; `transcript_open` records which video (§9.4, §10.2, §14.4) | The team needs reach on the content pages, plays with depth, format use (transcript, handout, audio), searches, ratings and feedback, and nothing else. About 8.4 rows written per visit instead of 16, and less data held |
| 2026-11-05 | Content (page text, transcripts, data files, handouts, audio, thumbnails, and videos that state it) is licensed CC BY 4.0, excluding the SleepSteps name and logo and third-party material (`LICENSE-CONTENT.md`); the site footer states the licence from M1b | The team wants anyone to be able to reuse and adapt the materials with credit |
