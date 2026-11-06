# Sleep Intervention Website — Technical Specification

Status: Draft v1 (2026-11-05)
Owner: Joshua Wiley
Domain: `<DOMAIN>` (placeholder throughout)

This document is the source of truth for what the site does and how it is built. When a decision here changes, update this file in the same commit as the code change.

---

## 1. Purpose and context

An informational and educational website supporting a clinical trial of a stepped-care sleep intervention. Participants can watch short videos, listen to audio-only versions, print or keep a handout for each video, or read transcripts. They can find content by describing their problem or by searching.

The site must stay online and freely available after the grant ends, with close to zero cost and maintenance. That requirement drives most of the design decisions below.

**Site engagement is not a trial outcome.** Analytics, ratings and feedback are for improving and reporting on the resource only. They are anonymous and are never linked to participants.

## 2. Design principles (in priority order)

1. **Static first.** All content is pre-built HTML/CSS/JS. Dynamic features are optional enhancements.
2. **Graceful degradation.** If the API is down, disabled or blocked, every page still works fully as a content site. No feature may block page rendering.
3. **Low maintenance.** Minimal dependencies, no client-side framework, no server we administer, nothing that needs regular patching to stay secure.
4. **Privacy by default: no tracking, and everything disclosed.** SleepSteps sets no cookies and no persistent identifiers, stores no IP addresses, and loads no third-party scripts beyond §16.2. Any storage on a visitor's device, whether ours or a provider's (YouTube after play, Turnstile, Cloudflare security checks), is listed in §15.4 and on the privacy page.
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
| Search | MiniSearch (7.2.0) | Client-side, fuzzy, field boosts. Its browser ES module, source map and MIT licence are copied as published from `node_modules` to `/js/vendor/minisearch/` (no bundler) |
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
├── site.config.json           # Site settings, footer text + feature switches (§11)
├── content/
│   ├── problems/              # One Markdown file per sleep problem (§7.2)
│   ├── videos/                # Video library: one file per video, no page of its own (§7.1); videos.11tydata.js (no permalink, transcripts as plain Markdown)
│   ├── pages/                 # Information pages: help, about, contact, privacy, urgent help (§7.4)
│   ├── start.md               # "Start here" intro videos (§7.3)
│   ├── problems.njk           # Sleep problems browser (§7.2)
│   ├── search.njk             # Search results page (§8.1)
│   ├── search-index.11ty.js   # /search-index.json, built with scripts/build-data.js (§8.3)
│   └── index.njk              # Home page
├── data/                      # Eleventy global data: each CSV becomes an array of row objects
│   ├── areas.csv              # The 10 problem areas (§7.2)
│   └── keywords.csv           # Search synonyms (§8.2)
├── media/
│   ├── audio/                 # Audio-only versions: each video's soundtrack as MP3, ≤ 25 MiB each (§9.2; placeholder-audio.mp3: 2 s of silence, §7)
│   ├── pdf/                   # Handouts, one per video; PDF until the format is decided (§9.3; placeholder-handout.pdf, §7)
│   └── thumbs/                # Self-hosted video thumbnails (optional)
├── src/
│   ├── _includes/             # layouts/, partials/ (components in §7.5), problem/ (solution cards), notices/ (§15)
│   ├── img/                   # Logo and site images
│   ├── css/                   # tokens.css, site.css, components.css, pages/<page>.css (§7.5)
│   └── js/                    # menu.js (also warms the site search), players.js, solutions.js (solution cards), problems.js (Sleep problems filter and accordion), search.js + search-config.js (§8), rating.js, feedback.js, events.js, api.js
├── scripts/
│   ├── build-data.js          # Search index entries (§8.3); pages.json from M3
│   ├── validate-content.js    # Front matter, media file and CSV checks (areas, keywords)
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
│   └── node/                  # Vitest project "node": build scripts, built-site checks, browser modules in a small test DOM (mini-dom.js)
└── dist/                      # Build output (git-ignored)
```

`.gitignore` must include `dist/`, `worker/generated/`, `node_modules/`, `.wrangler/`, `exports/` and `*.csv.export`. **Data exports must never be committed.**

## 7. Content model

The site is organised around **sleep problems** (design handoff, §22). People pick a problem; each problem page shows a video about the problem and the solution videos for it. Videos live in a shared library and can appear on more than one page.

**Placeholder content.** Until the team supplies the real content, placeholders build and are easy to find. Placeholder text is in `[square brackets]`. A placeholder video has `placeholder: true` and `youtube_id: "PLACEHOLDER"`, and its duration may be `"[mm:ss]"`: its frame shows "[Video coming soon]" with no link or button, so it never contacts YouTube, and the §15.1 notice still shows under it so pages read as they will at launch. The build lists placeholder videos as a warning (without also warning that they have no handout, audio or transcript, §7.1); at launch there must be none (M8). A placeholder may keep a stand-in transcript in brackets, but a real video may not (the build fails, as it does for a bracketed duration). The sample content is one placeholder video per problem (`<slug>-about`), seven shared placeholder solution videos and the three intro videos. Every problem has bracketed "Is this you?" text and one main solution, except four samples that exercise the layouts: `tired-but-wired` (3 main, 3 extra), `cant-get-back-to-sleep` (2, 1), `pain` (1, 0) and `hot-flushes-and-night-sweats` (2, 2), which also have placeholder related topics. Small placeholder files in `media/` (a one-page PDF and two seconds of silent MP3) let the handout and audio controls be seen.

**Identifiers.** Every page has a `page_id`: a problem's slug, a fixed ID for the main pages (`home`, `start`, `problems`, `search`), or an information page's file name. Every video has a `video_id` (its file name). Both are lowercase, hyphenated and stable. **Never rename a `page_id` or `video_id` without adding a redirect (for pages) and updating every reference and `keywords.csv`.** `validate-content.js` fails the build on any dangling reference.

### 7.1 Videos (`content/videos/<video_id>.md`)

Videos have no page of their own (`permalink: false`); problem pages and Start here embed them.

```yaml
---
title: "Setting up a wind-down hour"
youtube_id: "AbCdEfGhIjK"
duration: "6:40"
audio: "wind-down-hour.mp3"          # file in media/audio/: the video's soundtrack (§9.2); every video, by launch
handout: "wind-down-hour.pdf"        # file in media/pdf/; every video, by launch (format still open, §9.3)
thumbnail: "wind-down-hour.jpg"      # optional, file in media/thumbs/
placeholder: true                    # optional: not on YouTube yet (§7)
---
Transcript in Markdown goes here (the body); every video, by launch (§9.3).
```

Required fields: `title`, `youtube_id` (the 11-character ID, in quotes) and `duration` (`"m:ss"` or `"h:mm:ss"`, in quotes). **Every video is to have a handout, an audio-only version and a transcript** (§9.2, §9.3). The page hides any format a video doesn't have, so placeholder videos, which may have none, still build. The build warns about a video that is not a placeholder and has no `handout`, no `audio` or no transcript (a body that is empty or only whitespace), and the launch check (`node scripts/validate-content.js --no-placeholders`, M8) fails on any video without all three. The transcript is plain Markdown: no headings, which would break the page's heading outline, no HTML (tags or comments; a comment-only body would show an empty transcript), no images, and no links except to pages on this site (paths starting with `/`): an image would load from elsewhere, and a link out would skip the §16.1 allowlist and `noreferrer`. Media fields are bare file names with the right extension (`.mp3`, `.pdf`, or `.jpg`, `.jpeg`, `.png`, `.webp`). The build fails if a referenced media file does not exist, if audio is over 25 MiB (§9.2), or on an unknown field (usually a typo). It warns about a video used on no page.

Templates read a video through the `videoById` filter (`eleventy.config.js` documents the shape it returns). A page that shows transcripts declares `eleventyImport: { collections: ['videos'] }` so the video files render first.

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

The build fails on an unknown `area`, `time_of_day`, `video` or `related` slug, or on solution counts outside 1–3 main / 0–3 extra. It also fails on a missing `title`, `statement`, `order` or `problem_video`, a solution without a `blurb`, the same video twice on one page (the problem video and its solutions: their ids and ratings would clash), a problem listed in its own `related`, more than 3 `related` or more than 4 bullets. It warns, without failing, when `related` has fewer than 2 entries, `is_this_you` is empty or has fewer than 2 bullets, or a field isn't one the templates read, so placeholder content can still build.

The **Sleep problems** page (`/problems/`) lists every problem in two views: by area (an accordion, the default) and "When it happens" (time-of-night lanes). Area anchors such as `/problems/#core` open that area. Without JavaScript, every area renders open under a plain heading, and the filter, the view toggle, "Open all areas" and the "When it happens" lanes are not shown (they need JavaScript; the areas already list every problem), nor is the band's sentence about them. `src/js/problems.js` turns each area heading into a `<button aria-expanded aria-controls>`, opens only the first area (or the one in the URL), and shows the toolbar and the lanes view.

### 7.3 Start here (`content/start.md`)

Lists the intro videos in order, in `chapters`: each has a `video` (video_id) and a one-line `description`. The title, duration and formats come from the video file. Rendered at `/start/`, with chapters `#v1`, `#v2`, ... The build fails on an empty list, an unknown or repeated video, a missing description or an unknown field.

### 7.4 Information pages (`content/pages/*.md`)

Standard Eleventy pages with `title` and `summary`. They are included in the search index unless `search: false` is set. A page's `page_id` is its file name and it renders at `/<file name>/` (`content/pages/pages.11tydata.js`).

They use the information layout (`src/_includes/layouts/info.njk`, whose header comment is the full contract): a teal title band, the "Information pages" side menu and the content column. Front matter: `title` and `summary` (required; the summary is the lede under the H1 and the meta description), and optionally `eyebrow` (default "Information"), `heading` (H1 text when it differs from the title), `band: hero` (the About hero with the settling arc) and `styles` (extra stylesheets, e.g. `["pages/help.css"]`). Any page can list `styles`; only paths under `src/css/` are accepted. Likewise `scripts` (e.g. `["players.js"]`) loads extra ES modules from `src/js/` (file names only). A layout can list `styles` and `scripts` in its own front matter too (`layouts/problem.njk` does); Eleventy merges them with the page's. `track_page_view: true` marks the pages that send a `page_view` (§10.2): problem pages, Start here and Getting urgent help.

Required pages: Getting more help (`/help/`, whose "Other support" cards start with Cancer Council: 13 11 20 and a link to its website, §16.1), About us (`/about/`; the main nav keeps "About", §7.5), Contact (`/contact/`, with the project email, psych.sleepsteps@monash.edu), Privacy and your data (`/privacy/`, §15), Getting urgent help (`/urgent-help/`, with the crisis contacts from `site.config.json`), and 404 (`content/404.njk`, output as `/404.html`, no `page_id`).

**Getting urgent help is deliberately minimal** (design handoff §6.5): it uses `layouts/urgent.njk`, which sets `header: minimal` (the logo and "Back to home" only: no nav, search box or menu script) and `footer: false`. It is the one exception to the header search box (§8.1) and the footer "Send feedback" link (§13). Under the crisis cards (§11), smaller white cards come from the page's `other_contacts` front matter (`heading`, `description`, optional `value`, and an optional website in `url` with its `link_text`): a card whose `value` is a confirmed number (not a `[placeholder]`) is a whole-card `tel:` link with the hover shadow, unless it also has a website, when only the number is a `tel:` link, since one link can't hold another. "Your treating team" has no number (it is on each person's care plan), so its card is information, not a link. The cancer support line is Cancer Council, 13 11 20 (Australia): a free, confidential information and support line, open 9am to 5pm, Monday to Friday (longer in some states), and not a crisis service. Its card gives the number as a `tel:` link, the hours and a link to its website, `https://www.cancer.org.au/` (§16.1). Getting more help's `services` cards take the same optional `url` and `link_text`. The page carries no draft or developer notes (a test checks this); what the team still has to confirm is tracked in §21.

### 7.5 Visual design and components

Layouts, copy and components follow the design handoff in `docs/design/` (start with `HANDOFF.md`; the boards in `reference/boards/` give exact spacing and copy, but their design-tool runtime is not copied). Its colour, type-scale, spacing and radius tokens are CSS custom properties defined once in `src/css/tokens.css`, the only stylesheet allowed to contain colour values (a test enforces this); components never hard-code values. `src/css/site.css` holds the base styles, the shell components and the page layouts; `src/css/components.css` holds the components shared by several pages (the video facade, format buttons and transcripts, step chips, buttons, section headings and topic cards); a page adds its own CSS through `styles` front matter (§7.4).

Token rules:

- **Spacing:** the token scale (4–32px) plus layout steps `space-9` to `space-14` (40, 48, 56, 64, 72, 96px) for page padding and section gaps. Board values off the scale snap up to the next step (10→12, 14→16, 18→20, 22→24, 28→32, 36→40, 44→48).
- **Type:** the tokens.json styles, plus values the handoff gives outside it: interior H1 48px, problem H1 44px, phone H1 34px (Home's display line too, where Landing-Phone has 38px), the 19/30 lede and the problem statement at 22px. All running text is at least 17px; the boards' 15–16px running text is raised to 17px. Other off-scale headings snap to the nearest token style: the phone boards' 26px section headings use the 24px title size.
- **Colour pairs:** only pairs tokens.json lists as passing. So the footer's secondary text is `paper` (the board's `on-teal-muted` on `ink` is not listed), the urgent-help notice text is `clay-deep` on `clay-wash`, and links on a `panel` ground (the Sleep problems nudge, a transcript's links and its "Print transcript" button) are `ink`.
- **Focus ring:** 2px solid with a 2px offset, `deep-teal` on light grounds and `paper` on teal or ink (handoff §10), with two exceptions. On the urgent-help notice's `clay-wash` ground the ring is `clay-deep`, the only colour tokens.json lists on that ground. The header search input is joined to its `deep-teal` submit button, so its ring is drawn just inside the input's box (at the usual offset its right side would sit on the button and vanish).
- **Page width:** 1200px by default, 1280px (`page_width: medium`: Start here, Sleep problems) or 1360px (`page_width: wide`: problem pages), as on the boards. On Sleep problems the band's contents, the accordion and the nudge sit in a 1000px column, as on Problems-A.
- **Targets:** every link and control is at least 44×44px, so TopicNav's problem, chapter and info links are 44px tall (36–40px on the board). This includes links inside a sentence (stricter than WCAG 2.5.8): they are `inline-flex` with a 44px minimum height, as on the urgent-help notice, the search page's no-JavaScript link, `.link-standalone`, links in information-page paragraphs, links in the §15.1 notices (`.notice-text`) and links in transcripts.
- **Logo:** the stacked logo only (there is no horizontal lockup). If a header ever can't fit it, it drops the logo for a "SleepSteps" text link to the home page rather than shrinking or altering it.
- **Disclosures without JavaScript:** TopicNav areas and the phone Menu are native `<details>`/`<summary>`. `src/js/menu.js` upgrades the Menu to a `<button aria-expanded aria-controls>` with Escape-to-close; TopicNav ships no JavaScript. A video's "Read transcript" and "Audio only" are native `<details>` too, and are not upgraded. Solution cards are native `<details name="solution">` (one open at a time where browsers support `name`); `src/js/solutions.js` turns each closed card into an `<h3>` holding a `<button aria-expanded aria-controls>`, its panel into a region labelled by the card's heading, and keeps one card open at a time across both sections, pausing the media of the one it closes. The Sleep problems areas are headings that `problems.js` upgrades (§7.2).

Exceptions to the handoff, recorded in §22:

- **System fonts** instead of Figtree and Source Sans 3: no web fonts are loaded.
- **Ratings** follow §12, with no client ID.
- **Feedback** is only the footer dialog (§13); the mockups' per-video feedback forms and links are not built.
- **Solution cards start closed** (the boards open the first main one), so the first screen holds one video facade and notice, not two. Adding `open` to a card's `<details>` in `src/_includes/problem/solutions.njk` reverses this; `solutions.js` keeps a card that starts open. Opening a card moves focus to its heading (HANDOFF §6.4) except on phones, where the open card's header isn't shown and focus stays on the card's button, which stays on screen above the panel.
- **Phones keep what the phone boards drop**, so nothing is lost at 320px or 400% zoom (WCAG 1.4.10): "Is this you?" in full, each Related topic's first-person line, and on Home each area's description, the step links and the format tiles (one per row). Home's steps are the board's rows (number disc beside the text, no coloured rule). The "On this page" chips wrap instead of scrolling sideways; the first is filled, as on the board.
- **Formats one per line on phones** (Problem-Phone has a 3-button grid): "Audio only" and "Read transcript" are native `<details>`, whose panels need the full width to open under their button.
- **The Sleep problems filter is labelled "Find a sleep problem on this page"**, not the board's "Search sleep problems", which is the header search's name; the two fields do different things (§8.1).
- **Home has four format tiles**: the board's "Watch, read or print" panel becomes "Watch, listen, read or print" and adds "Audio" ("Listen without watching") between the board's Video and Transcript, so the tiles follow the heading (watch, listen, read, print), since every video has an audio-only version (§9.2). As on the board, a tile shows only if some video has that format. The tiles are one per row on phones, two per row from 600px, and all in one row once their list is 636px wide (four of the board's 150px tiles and three 12px gaps), so three never sit above one.
- **Home's copy names listening** (every video has an audio-only version, a transcript and a handout, §7.1): the hero line (also the meta description) ends "Watch, listen, read or print, whichever suits you."; step 3 reads "Watch a video, listen to it, read its transcript or print its handout." (the board: "Watch the video, read the transcript or print a handout."); and the line beside the tiles reads "Video comes first, but every video also has an audio-only version, a transcript and a handout with the same ideas." (the board: "…every video also has a transcript and a printable handout…").
- **About's trial facts add "Who can take part"** after "What it tests" (the Info-About board lists what it tests, who runs it, funding, ethics and registration), and "Why we made this program" has four paragraphs where the board has three placeholders: the third, "what we did differently", became two, one on stepped care and one on the steps. The text is drafted from the concept note for the team to confirm (§21, §22).
- **No GP summary on Getting more help**: the Info-Help board's "Print a one-page summary for your GP" line is left out, and the "What to bring" step doesn't mention a SleepSteps sleep diary. There is no GP summary or sleep diary for now (§21).
- **The site doesn't lean on the name "SleepSteps"** (one word; project lead, 2026-11-06), although the boards use it in many places: another organisation has trademarked a "Sleep Steps" program. A soft rule, not a ban: the copy says "this program", "we", "us", "our" or "this website" by default; the name is in the header logo (image and alt text "SleepSteps home") and the footer heading, and the team may name it in a few places, such as About ("SleepSteps is a research trial of …"). There is no test for it. Technical names (repo, Worker, databases, storage keys, event and file names) keep `sleepsteps`. The changes so far:
  - Home: the hero line (also the meta description) starts "Short videos and practical ideas…", the trial text says "We're testing this program in a research trial…", and the disclaimer says "These videos and ideas don't replace care from your treating team…".
  - Browser tab titles are the page title alone, with no " | SleepSteps"; Home's is "Sleep during and after cancer" (its H1 and headings don't change). Every page has a `title`; only a page without one would fall back to `siteName`.
  - About is titled "About us" (its eyebrow and the information side menu's label too; the main nav keeps "About"), and its "Why we made SleepSteps" heading reads "Why we made this program". That section names the program once: "SleepSteps is a research trial of a stepped care program for sleep in people with cancer." (§22).
  - The urgent page's back link reads "Back to home" (§7.4).
  - The footer tagline ends "This program does not replace care from your treating team.", and its licence line ends "except our name and logo and third-party material." (§22). Both are in `site.config.json` (§11). The privacy page says "You don't need an account to use this program." and "Advertising or tracking cookies from us" (§15.2).
  - A printed transcript's source line reads `From “<page title>”: <url>` (§9.3).
  - The intro video `how-to-use-sleepsteps` is now `how-to-use-this-program`, "[How to use this program]". Videos have no URL, so no redirect was needed.
  - Technical names keep `sleepsteps` and must not change: the repo, the Worker, the D1 databases, the `workers.dev` address, the Wrangler files, the package name, the storage keys `sleepsteps-visit` and `sleepsteps-stats-off` (§15.4), the `sleepsteps:event` DOM event, CSS, JS and logo file names, and data attributes. So does the project email, psych.sleepsteps@monash.edu.

## 8. Search

### 8.1 Behaviour

- A search box in the header on every page except Getting urgent help (§7.4). Submitting goes to `/search/?q=<query>` (a plain GET form, so it works without JavaScript). The search page has its own form too (the header's is in the phone Menu), labelled "Search this website" (§7.5).
- The search page loads `search-index.json` and MiniSearch lazily, i.e. only on the search page or when the header box is focused: `src/js/search.js` loads them on `/search/` (their addresses are `data-` attributes on the page), and the first focus on a header search box adds `<link rel="prefetch">` for the same two files (`menu.js`), so the results page finds them in the browser's cache. If either fails to load within 15 seconds, the page says "Search isn't working right now." and links to the Sleep problems page.
- Results show title (linked, an H2), content type ("Sleep problem", "Introduction" or "Information") and summary, built with `textContent` only. Show the top 10. The count goes in a `role="status"` line ("3 results for “night sweats”", or "The top 10 of 24 results for …").
- With no results, show a message plus a link to the Sleep problems page.
- Under the form, on every search and also without JavaScript: "If you feel unsafe or need help right now, go to Getting urgent help." (the urgent notice style). Someone in distress may type it into the search box, and ranking alone doesn't always put Getting urgent help first for every way of saying it ("I can't go on", "not coping"); crisis words such as "suicidal" do (§8.4).
- The query is kept in the URL so results are shareable and the Back button works.
- Log a `search` event with the query (truncated to 100 characters) and result count (§10). Until M3, `search.js` only dispatches it as a `sleepsteps:event` DOM event, as `players.js` does. The query is never logged to the console or kept in browser storage; from M3 it is stored only as that event (§10.1, §15.3).
- **The query never travels on in a referrer.** The search page sets `<meta name="referrer" content="strict-origin">` (front matter `referrer`, read by `base.njk`), so a page reached from it (a result, the nav) sees only the site's address in `document.referrer`. Otherwise the full `/search/?q=…` address would be the next page's referrer, and YouTube's player script copies `document.referrer` into the embed when someone presses play there (§9.1). The site-wide `strict-origin-when-cross-origin` (§16.1) still sends the full address to same-origin pages, so it isn't enough here.
- With JavaScript disabled, the search box still submits to `/search/`, whose static HTML says that results need JavaScript and links to the Sleep problems page.
- **Problems page filter** (separate from the site search, and labelled differently, §7.5): a live filter on `/problems/` matching each problem's short title, statement, area name and keywords. Words in the query must all match; commas or semicolons separate alternatives ("night sweats, 3am"). It filters both views as you type, hides areas with no matches and opens areas with matches, and announces the count ("4 topics match “night”") in an `aria-live="polite"` region once typing pauses. When nothing matches, both views show every topic and the result line says so. It does not log events, and the query is never stored, sent or put in the URL. It needs JavaScript and is not shown without it (§7.2).

### 8.2 Keywords (`data/keywords.csv`)

```csv
page_id,keywords
hot-flushes-and-night-sweats,"hot flushes; hot flashes; menopause; tamoxifen; sweating; night sweats"
```

- One row per page. Keywords are separated by `;`.
- Include common misspellings and Australian/US spelling variants.
- Searchable pages are every problem, `start` and every information page without `search: false` (§8.3). The content check (`validate-content.js`) fails on a `page_id` that isn't one of them, an empty `page_id`, a second row for the same page, or columns other than `page_id,keywords`. It warns, without failing, for pages that have no keywords row (or only separators).
- The starting set (2026-11-06) was drafted by Claude from the team's planning sheet (module titles, brief ideas, formulations, target strategies) and draft video scripts, then reviewed for plain language, clinical sensitivity and search quality. It is a starter to hand-edit once titles, areas and videos settle; the crisis words on `urgent-help` especially need clinical review. No wording or names from the drafts are copied, only search terms.
- Maintained by the clinical team in Excel (save as CSV UTF-8).

### 8.3 Index build (`scripts/build-data.js`)

Every Eleventy build (so `npm run build`, `npm run dev` and the tests' build) writes `dist/search-index.json`: `content/search-index.11ty.js` passes the collections to `searchIndex()` in `scripts/build-data.js`. The file is an array of:

```json
{ "id": "hot-flushes-and-night-sweats", "url": "/problems/hot-flushes-and-night-sweats/", "title": "...",
  "summary": "...", "keywords": "hot flushes hot flashes ...", "transcript": "plain text", "type": "problem" }
```

There is one entry per searchable page: every problem (`type` `problem`), Start here (`start`), and every information page in `content/pages/` (`page`) unless its front matter has `search: false`. Home, the Sleep problems page and the search page are not entries. A problem's `summary` is its statement, and its `transcript` field joins its "Is this you?" summary and bullets with the titles, blurbs and transcripts of every video on the page, so a match in a solution video's transcript leads to the problem page. Start here's joins its intro videos' titles, descriptions and transcripts. An information page's is the text of its rendered body (taken from `collections.all`, which holds every page whatever order Eleventy renders them in; a config-API collection could be computed before a page that imports a collection has joined it). Transcript Markdown and page HTML are reduced to plain text.

`worker/generated/pages.json` (`{ page_id: { url, title, videos: [video_id, ...] } }`), which the Worker uses to validate `page_id` and `video_id`, is built in M3, the first milestone that uses it.

### 8.4 MiniSearch configuration (starting point; tune against real queries)

```js
// src/js/search-config.js, shared by search.js and the query tests
new MiniSearch({
  fields: ['title', 'keywords', 'summary', 'transcript'],
  storeFields: ['title', 'url', 'summary', 'type'],
  processTerm: (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
});
// search options
{ boost: { keywords: 4, title: 3, summary: 2, transcript: 1 },
  fuzzy: 0.2, prefix: true, combineWith: 'OR' }
```

`test/node/search-queries.test.js` runs real example queries against the built index with these settings and checks their expected top results, e.g. `"hot flashes"` → `hot-flushes-and-night-sweats` in the top 3. It also checks a list of crisis words (suicide, suicidal, self harm, hurt myself, crisis, emergency, unsafe, lifeline, 000, 13 11 14): each must rank `urgent-help` first. Keyword or setting changes must keep both passing. It runs with `npm test`, so it reruns after every keyword change.

## 9. Media

### 9.1 Video (YouTube)

- Use a click-to-load facade: a 16:9 frame (the video's self-hosted thumbnail if it has one, otherwise a plain `night-teal` frame), the video title, a duration badge and a play button. The title is a visible plate on the frame where no nearby heading names the video (a problem's own video); elsewhere it is the play control's accessible name. Load the YouTube player only after the user clicks, so YouTube isn't contacted until someone chooses to play. Never autoplay before that click.
- Then create the player via the IFrame Player API with `host: 'https://www.youtube-nocookie.com'` and `playerVars: { rel: 0, playsinline: 1, autoplay: 1, cc_load_policy: 1, cc_lang_pref: 'en' }`. The player exists only after the click, so `autoplay` starts the video the visitor chose. The iframe's `title` names the video, and focus moves to it, unless the visitor has moved focus elsewhere while the player loaded. No `hl` (the player follows the viewer's language) and no `origin` (the API adds it). The `host` option works (the API builds the iframe from it) but isn't in the IFrame API reference (checked 2026-11-06).
- **Captions are on by default** (§21). `cc_load_policy: 1` shows them when the player loads, even if the viewer has turned captions off on YouTube; they can still turn them off in the player (the CC button or the c key). `cc_lang_pref: 'en'` asks for the English track. The team uploads each video's captions as a plain "English" track, not a regional one such as "English (Australia)" that `en` may not match, made from the script or transcript (Studio's Auto-sync, or a timed `.vtt`/`.srt`), and a person checks them before the video goes public (§19.2). Don't rely on auto-captions: YouTube doesn't document whether `cc_load_policy` shows an auto-generated track when there is no uploaded one (third-party reports say it often doesn't), and their accuracy varies.
- A link to watch on YouTube is shown as a fallback: without JavaScript the facade is that link, and if the player can't load (the API script fails or takes over 15 seconds, or the player reports an error) the frame says "The video couldn't load here." with the link. The link has no caption parameter: the watch page has no documented one, so there the viewer's own caption setting applies.
- YouTube blocks embedded playback when the request has no `Referer` ("error 153"), so the `Referrer-Policy` in §16.1 must never be tightened to `no-referrer`.
- A placeholder video (§7) shows "[Video coming soon]" instead of a play button, with no link.
- Ratings and formats sit outside the player.
- **Under each facade, before the click**, show the video notice (§15.1) naming YouTube/Google and what may happen, with a link to the privacy page. The play control names the notice's sentences in `aria-describedby`, so screen readers hear it with "Play video" although it follows in the page. Loading the IFrame Player API sets YouTube cookies on `.youtube.com` once someone presses play, even with the youtube-nocookie host (observed November 2026). This is disclosed (§15.4), and the notice makes pressing play an informed choice. No YouTube request happens before the click.

### 9.2 Audio

- **Every video has an audio-only version: the video's own soundtrack**, exported from the final video file as an MP3 (§21). The "Audio only" option is hidden when a video has none (placeholders); the build warns about a real video without one, and the launch check fails (§7.1).
- `<audio controls preload="none">` with an MP3 in `media/audio/`.
- **Encoding** (the commands are in `README.md`, "Exporting the audio-only version"): mono (a stereo master is downmixed), 44.1 kHz, 96 kbps constant bitrate. Loudness is normalised in two passes with ffmpeg's `loudnorm` as one linear gain, to an integrated −16 LUFS with `dual_mono` (a mono file at about −19 LUFS sounds as loud as −16 LUFS stereo, Apple's and Google's podcast targets). `loudnorm`'s true-peak ceiling is −1.5 dBTP, which leaves room for the MP3 encoder's overshoot so the finished file measures at or below −1 dBTP (Apple's podcast limit); a file that still measures higher is exported again with a −2 dBTP ceiling. The source file's metadata is removed, and ID3v2.3 tags give the title, "Behavioural Medicine Lab" as artist (with no album tag, so no tag names the program, §7.5), the year, the language (`eng`) and the CC BY 4.0 notice. 96 kbps rather than 64 because the soundtrack may carry music, which 64 kbps handles less well; it costs about 1.2 MB more per 5 minutes (about 3.6 MB per 5-minute file).
- Each file must be ≤ 25 MiB (the static asset limit). At 96 kbps that is about 36 minutes per file. `validate-content.js` enforces the size limit.
- Because the audio is the video's soundtrack, the narration must say everything that matters on screen (on-screen text, numbers and demonstrations; no "as you can see"), so the audio stands on its own. That also gives the video its audio description (WCAG 2.2 SC 1.2.5, integrated description). The transcript is the audio's text alternative (SC 1.2.1, Level A), which is one reason every video has one (§9.3).
- Workers static assets ignore `Range` requests and send the whole file with a 200 (Cloudflare documented this in November 2026). One report says Safari still plays and seeks MP3s served that way. Check play and seek in Safari on an iPhone and in Chrome once real audio is on a preview (M8). Only if that fails, add a Worker route for `/media/audio/*` that answers with 206 (a §9.2 and §18.2 change; each play then costs Worker requests).

### 9.3 Handout and transcript

- **Every video has a handout.** Its format is still open (§21): PDF, Word or a web page. Until it is decided, `handout` names a PDF in `media/pdf/` and the page links to it as "Handout (PDF)". The team supplies handouts; they are not generated. What each format would change:
  - **PDF** (today): no site work. Accessible only if exported from Word as a tagged PDF ("Best for electronic distribution and accessibility" on a Mac, document structure tags on Windows; never "Print to PDF"), checked with PAC or axesCheck, and cleaned with Word's Document Inspector. Prints as a fixed A4 page; poor on phones (no reflow) and the hardest to adapt under CC BY.
  - **Word (`.docx`)**: the easiest to adapt. The validator would accept `.docx` and the folder and labels would become format-neutral. Layout shifts with fonts and paper size, many Android phones need an app to open it, and there are no W3C techniques for checking it; Document Inspector before publishing.
  - **Web page**: the most accessible and the best on phones; readers can still print it or save it as PDF. The most site work: a `content/handouts/<video_id>.md` collection with its own URLs, print CSS for one A4 page, a "Print handout" button like "Print transcript", validator rules and tests. The team would supply text (Word is fine) rather than finished files.
- Clicking a handout link logs `handout_open` with the video's `video_id` (§9.4, §10.2), so neither the event nor its detail depends on the format: a web-page handout would have no file name.
- **Every video has a transcript** (§21): word for word, naming the speakers and noting sounds and pauses that matter. It is the text alternative for the audio-only version (WCAG 2.2 SC 1.2.1, Level A) and the source of the captions (§9.1). "Read transcript" is hidden when a video has none (placeholders); the build warns about a real video without one, and the launch check fails (§7.1).
- The transcript is rendered as HTML under the video, in a `<details>` element labelled "Read transcript", with a "Print transcript" button that prints just that transcript, under a source line naming the page and its address (`From “<page title>”: <url>`, §7.5). Printing needs JavaScript, so the button appears only with it. Opening the transcript logs a `transcript_open` event.

### 9.4 Media tracking (`src/js/players.js`)

- Log **one `video_play` / `audio_play` event per media item per page load**, carrying the furthest point reached: `0` (played, but under 25%), `25`, `50`, `75` or `100`. It is based on the furthest position reached, not on watch time. There are no separate progress events.
  - Send it immediately on reaching 100%. Otherwise send it when the page is hidden (`visibilitychange` to hidden, or `pagehide`) if the item was played at all.
  - If the page is hidden and shown again and the item later reaches a higher point, send one more event with the new value. Analysis takes the highest value per session, page and item.
  - A play is lost if the tab is killed without being hidden first, which is rare.
- Video: poll `getCurrentTime()` / `getDuration()` every 5 seconds while the state is PLAYING. Audio: use the `timeupdate` event.
- Log `handout_open` when a handout link (marked `data-handout`, holding the video's `video_id`) is clicked, whether the browser opens or downloads it.
- Until M3 nothing is sent: `players.js` keeps these values and only dispatches a `sleepsteps:event` DOM event (`{ type, detail }` in the §10.2 shapes), which M3's `events.js` listens for and sends.

## 10. Analytics events

### 10.1 Client (`src/js/events.js`)

- `session_id` is `crypto.randomUUID()` stored in `sessionStorage` under the key `sleepsteps-visit`. Wrap access in try/catch; if storage is unavailable, use an in-memory ID for the page.
- **Usage statistics can be turned off.** The privacy page has a "Turn off usage statistics" button. It sets `sleepsteps-stats-off` in `localStorage` and deletes `sleepsteps-visit`, and a "Turn on" button removes it again. While it is set (read inside try/catch), `events.js` sends nothing, creates no ID, and removes any `sleepsteps-visit` left in that tab, so tabs that were already open drop their code on their next page. Ratings and feedback are unaffected. If `localStorage` is unavailable, the choice can't be remembered and the page says so.
- **Search events carry no `session_id`**, and the Worker stores their `ts` rounded down to the hour (§14.1), so search text isn't stored with the rest of a visit and is hard to re-link by time.
- Send with `navigator.sendBeacon('/api/event', JSON.stringify(payload))`, falling back to `fetch(..., { keepalive: true })`.
- Never send: user agent, screen size, referrer query strings, or anything typed except search queries.
- Do nothing if `features.events` is false.

### 10.2 Event types (closed list; the Worker rejects anything else)

| type | page | detail (JSON) |
|---|---|---|
| `page_view` | page_id: **only** problem pages, `start` and `urgent-help` (a template sets `track_page_view: true`; no other page sends one) | `{}` |
| `search` | `search` | `{ "q": string ≤100, "results": int }`. Sent **without** `session_id` (§10.1) |
| `video_play` | page_id | `{ "media": video_id, "furthest": 0\|25\|50\|75\|100 }` (§9.4) |
| `audio_play` | page_id | `{ "media": filename, "furthest": 0\|25\|50\|75\|100 }` (§9.4) |
| `handout_open` | page_id | `{ "media": video_id }`: which video's handout, whatever its format (§9.3) |
| `transcript_open` | page_id | `{ "media": video_id }`: which video's transcript, since problem pages hold several videos |

## 11. Feature switches and failure handling

`site.config.json`:

```json
{
  "siteName": "SleepSteps",
  "siteUrl": "https://<DOMAIN>",
  "features": { "ratings": true, "feedback": true, "events": true },
  "turnstileSiteKey": "<PUBLIC_SITE_KEY>",
  "footer": {
    "tagline": "Short videos and practical ideas for sleep during and after cancer. This program does not replace care from your treating team.",
    "acknowledgement": "We acknowledge and pay respects to the Elders and Traditional Owners of the land on which we work.",
    "trialRegistration": "[Trial registration number]",
    "ethicsApproval": "[Ethics approval number]",
    "licenceExceptions": "except our name and logo and third-party material"
  },
  "crisisRegion": "[Australia]",
  "crisisContacts": [
    { "label": "Emergency", "value": "000",
      "heading": "If you are in danger, or need emergency care", "description": "Police, ambulance or fire" },
    { "label": "Lifeline", "value": "13 11 14",
      "heading": "To talk to someone now", "description": "Lifeline · crisis support, 24 hours" }
  ]
}
```

`footer` holds the footer's wording, so editors change it here rather than in the template (`src/_includes/partials/site-footer.njk`): `tagline` (under the `siteName` heading), `acknowledgement` (the Acknowledgement of Country, §22), `trialRegistration` and `ethicsApproval` (one line, joined by a dot), and `licenceExceptions`, the end of the licence sentence after "Content is licensed under CC BY 4.0," without a full stop (the template adds it). An empty `acknowledgement`, `trialRegistration` or `ethicsApproval` is left out. "Content is licensed under CC BY 4.0" and its link (`rel="noreferrer"`, §16.1) stay in the template, so the line always states the licence; `licenceExceptions` names what `LICENSE-CONTENT.md` leaves out (a test checks for the name and logo and third-party material). Every value is plain text (escaped, no HTML).

The Getting urgent help page renders one card per `crisisContacts` entry, in order: `heading` (falls back to `label`), `description`, and `value` as a `tel:` link (digits and a leading `+` only). `crisisRegion` names the region the numbers apply to.

`siteName` stays "SleepSteps", but the pages show it only as the footer heading, and as the tab title of a page with no `title` of its own (every page has one; §7.5).

- **Build time:** templates render a widget only if its feature is on. Its JS is loaded only if needed.
- **Worker:** imports the same file. A disabled feature's route returns `404`. Turning features off is therefore one config edit plus a push.
- **Environment:** the API also stores nothing unless the environment allows data collection: the Worker var `DATA_COLLECTION` in `wrangler.jsonc` must be exactly `"on"`; missing or any other value means off. While it is off, every `/api/*` route returns `404`, as for a disabled feature (a Worker test guards this and must be kept when the routes arrive). It is `"off"` in production until the privacy officer's go-ahead (§18.3), and `"off"` in previews until they are behind Cloudflare Access (§21): preview URLs are public, Workers Builds posts them on pull requests in this public repo, and preview writes count against the account's D1 limits that production shares (§17). The build has no reliable way to know whether it is building production or a preview: Workers Builds documents only the branch name (`WORKERS_CI_BRANCH`), and its API keeps separate production and preview build variables (whether the dashboard does is unverified). So production pages still show any widget whose feature is on, and M3 decides whether production builds should leave them out before the go-ahead. Locally, `wrangler dev` and the tests read the top level of `wrangler.jsonc`, so collection is off there too; turn it on for a local run with `npm run dev -- --var DATA_COLLECTION:on`. Never put `DATA_COLLECTION` in `.dev.vars`, which the Worker tests also read.
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
- Require the `Origin` header to match `siteUrl` or a configured preview origin; otherwise return `403`. No CORS headers are needed (same origin). The preview origin is configured only in `previews.vars`, never for production: production's version URLs (§18.2) have the same host shape as preview URLs but run on the production database.
- Timestamps are generated server-side as ISO 8601 UTC. Client timestamps are never trusted. For `search` events the Worker rounds `ts` down to the hour (§10.1).
- Validate `page_id` against `worker/generated/pages.json` (plus the fixed IDs `home` and `search`). Store titles from `pages.json`, never from the client.
- **Never store or log** IP addresses, user agents, `CF-Connecting-IP`, or feedback/search text in `console.log` (Workers Logs).
- Responses: `204` success, `400` validation error (`{ "error": "<code>" }`), `403` origin or Turnstile failure, `404` feature disabled, `413` too large, `429` (from the Cloudflare rate-limiting rule), `500` unexpected error (generic message).
- Use parameterised D1 queries only (`prepare().bind()`).

### 14.2 Routes

| Method & path | Body | Validation | Action |
|---|---|---|---|
| `POST /api/rate` | `{ page_id, video_id, stars }` | known page_id; video_id appears on that page; stars is an integer 1–5 | insert into `ratings` |
| `POST /api/feedback` | `{ page_id, message, turnstile_token }` | known page_id; message trimmed, 1–2000 characters; Turnstile verified | insert into `feedback` |
| `POST /api/event` | `{ type, page, session_id, detail }` | type in §10.2; session_id is a UUID for every type except `search`, where it must be absent; detail matches its type's shape; search q ≤ 100 characters | insert into `events` |
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
>
> A Cloudflare check on this form stops automated spam. Cloudflare uses technical details such as your IP address and browser for this check, and to improve its spam protection. We don't store them.

Under each video, before it is played (§9.1):
> Pressing play loads this video from YouTube (Google). YouTube may then store cookies in your browser and collect information about what you watch. [More about this](/privacy/#cookies-and-browser-storage) · [Read the transcript instead] *(the transcript link only when the video has one)*

### 15.2 Privacy and data page (`/privacy/`) must cover

- **What we collect:** star ratings, feedback text, search terms (stored without the visit code, time rounded to the hour), and anonymous usage events (views of the tracked pages, media played and how far, transcripts opened, handouts), each with the page and time.
- **What we don't collect:** names, contact details (except as below), advertising or tracking cookies from us, or stored IP addresses. A temporary random code held in the browser tab, and deleted when the tab closes, is used to count visits; on its own it cannot identify you.
- **Cookies and browser storage:** a section with a table of every §15.4 item a visitor can receive (name, set by, purpose, lifetime; reserve-only rows are left out until switched on, and staff-only Access cookies are noted below the table), the "Turn off usage statistics" switch (§10.1), how to block storage in the browser, and the YouTube API Services statement required by YouTube's developer policies (that the site uses YouTube API Services, that YouTube may store data on the device, and links to Google's privacy policy and YouTube's Terms of Service).
- **If you email or phone the team** (the Contact page, which is also where "Send feedback" leads until M5 and without JavaScript, §13): this is not anonymous. The team receives the email address or phone number with the message, uses it only to reply, and keeps it outside the site's data (never in D1) and unlinked to it, for <RETENTION PERIOD>. The Contact page says so too.
- **Who processes data:** Cloudflare (hosting, database, spam protection); YouTube/Google when you choose to play a video (Google's privacy policy applies). Some processing may occur outside Australia.
- **Use:** improving these resources. This is separate from the trial's research data.
- **Retention:** <RETENTION PERIOD>. Collection stops when the funded project ends (§19).
- **Contact:** the project email, psych.sleepsteps@monash.edu ("Contact the team at psych.sleepsteps@monash.edu"), as on the Contact page. **HREC approval number** and the ethics complaints contact: <PLACEHOLDERS>.

### 15.3 Data inventory

| Table | Fields | Personal info? |
|---|---|---|
| ratings | ts, page, video, stars | No |
| feedback | ts, page, page_title, message | Free text may contain health or identifying info despite the notice; treat as sensitive |
| events | ts, session_id (per-tab random; absent on search events), page, type, detail | Search queries may contain health terms, so they are stored without `session_id`; anonymous |

### 15.4 Device storage inventory

Everything that may be stored on a visitor's device. **Rule:** any new cookie or storage item needs a row here, a mention in the privacy page's "Cookies and browser storage" section (in its table if visitors can receive it), and a §22 entry. SleepSteps' own keys start with `sleepsteps-`. A build test checks that every storage key used in `src/js/` (passed to a storage call, or any quoted `sleepsteps-…` string) is named on the privacy page.

| Item | Kind | Set by | When | Purpose | Lifetime |
|---|---|---|---|---|---|
| `sleepsteps-visit` | sessionStorage | SleepSteps (`events.js`) | Page load, when `features.events` is on and statistics aren't turned off | Count visits; group one visit's events | Until the tab closes |
| `sleepsteps-stats-off` | localStorage | SleepSteps (privacy page) | Only when the visitor turns usage statistics off | Remember that choice | Until turned back on or browser data is cleared |
| `cf_clearance` | Cookie | Cloudflare | Only if Cloudflare challenges the browser (always-on botnet protection, Browser Integrity Check) | Remember that the check was passed | 30 minutes (Challenge Passage, §16.3) |
| `cf.turnstile.u` | localStorage, inside the `challenges.cloudflare.com` frame | Cloudflare Turnstile | When the feedback dialog loads Turnstile | Undocumented by Cloudflare | Undocumented |
| YouTube cookies (e.g. `YSC`, `__Secure-YNID`, `__Secure-ROLLOUT_TOKEN`, `VISITOR_INFO1_LIVE`, `VISITOR_PRIVACY_METADATA`) and YouTube localStorage/IndexedDB | Cookies and storage on YouTube's domains | YouTube (Google) | Only after the visitor presses play | Playback, security, measurement; Google lists advertising among purposes | Browser session to 13 months (Google) |
| Cloudflare Access cookies (e.g. `CF_Authorization`) | Cookie | Cloudflare Access | Only for research staff signing in to `/admin` | Admin sign-in | The Access application's session duration, set in the dashboard (§18.4 step 6) |
| `__cf_bm` *(reserve only)* | Cookie | Cloudflare Bot Fight Mode | **Not set:** Bot Fight Mode is off (§16.3). Add to the privacy page before turning it on | Bot scoring | 30 minutes after the last request |

Names and lifetimes for YouTube and Turnstile come from vendor documentation and a November 2026 browser test; recheck them in browser devtools on the live domain before launch (M8).

## 16. Security, headers and bots

### 16.1 HTTP headers (`_headers` file for static assets; the Worker sets them on its own responses)

- **The `_headers` file** is `src/_headers`, copied to `dist/_headers` by the build. Wrangler reads it as configuration and never serves it, but doesn't parse it on deploy, so a bad line may be dropped without warning. `test/node/deploy-config.test.js` therefore parses it as Cloudflare does (a port of the parser Wrangler bundles) and fails on any line that would be dropped: more than 100 rules, lines over 2,000 characters, URLs that aren't relative or `https`, ports, more than one `*`, malformed headers. Its rules apply to static-asset responses, including the 404 page (seen in local `wrangler dev`; the docs don't say), but not to responses the Worker builds itself. Until M7 adds the headers below, it holds only `X-Robots-Tag: noindex`, for `https://:version.:subdomain.workers.dev/*` (production on `workers.dev` before launch, and always the preview and version URLs there, so it stays after launch; it can't match the custom domain, §18.3) and for `/404` (the 404 page is also served at that path, with a 200). The test also fails on any other rule that would mark pages noindex on every host.
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
- **Links to other sites** load nothing, so the CSP doesn't cover them. They are kept deliberate instead: a build test allows `<a href>` only to hosts on its allowlist (`www.youtube.com` for "Watch on YouTube", §9.1, and YouTube's Terms of Service on /privacy/, §15.2; `policies.google.com` for Google's privacy policy, §15.2; `creativecommons.org` for the content licence in the footer, §22; `www.cancer.org.au` for Cancer Council on Getting urgent help and Getting more help, §7.4), over `https`, with `rel="noreferrer"` so the other site isn't told the visitor came from SleepSteps. Every other attribute that loads something (`src`, `srcset`, `poster`, `<link href>`, `action`, …) must be same-origin.
- `Referrer-Policy: strict-origin-when-cross-origin` (YouTube's recommended value; embedded videos don't play without a `Referer`, §9.1). The search page alone tightens it to `strict-origin` with a meta tag (§8.1).
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 16.2 Third-party scripts allowed

Only the YouTube IFrame API (loaded on click) and Turnstile (loaded when the feedback dialog opens). No analytics, fonts or tag-manager scripts from third parties. The site uses system font stacks and loads no web fonts (§7.5).

### 16.3 Cloudflare dashboard settings (manual, see §18)

These apply to the custom domain only, never to `workers.dev` or preview URLs.

- DNS records proxied; Always Use HTTPS
- AI Crawler and Agent access policies: Search **Allow**; Training **Disallow** (not Block, which also catches crawlers used for both search and training) with "Bot Preference Sync" on, which writes the managed robots.txt; Agent and Personal Agents at team discretion (§21)
- Bot Fight Mode: **Off** at launch, held in reserve. It barely protects the real risk (`/api/*` using up the D1 budget), can silently drop real beacons it challenges, and on the Free plan can't be skipped for `/api/*`. Its injected script needs a per-response CSP nonce, which would put the Worker in front of every page. **Triggers** for revisiting: bot traffic visible in `/admin`, D1 nearing its daily limit, or feedback spam getting past Turnstile. **Fallbacks, in order:** the Workers Rate Limiting binding on `/api/event` (if available on Free); Bot Fight Mode with `Cache-Control: no-transform` on HTML (no injected script; HTML loses compression); Bot Fight Mode with a Worker-set nonce, only on Workers Paid. Before turning it on, add `__cf_bm` to the privacy page (§15.4; the privacy officer should pre-approve the wording).
- Web Analytics (RUM): **Off.** It is on by default for Free zones and injects a third-party analytics script (§16.2). Once off, Cloudflare says it won't re-enable it.
- Email Address Obfuscation (Scrape Shield): **Off.** It is on by default, injects a script and rewrites email addresses, breaking the CSP and the no-JavaScript rule.
- Challenge Passage: **30 minutes**, matching the privacy page's `cf_clearance` row.
- At launch, check the live HTML in a real browser for `cloudflareinsights`, `email-decode` and `challenge-platform` (none should appear), and check stored items in browser devtools against §15.4.
- Rate-limiting rule: URI path starts with `/api/`, 20 requests per 10 seconds per IP → block for 10 seconds. The Free plan allows one rule, can't match on method, and returns Cloudflare's default 429. It limits each IP, not the total.
- Search engines allowed. Verify crawling in Google Search Console after launch.

## 17. Database

Production uses `sleepsteps` (`7da77651-1695-4331-8708-114382f04757`) and Worker Previews use `sleepsteps-preview` (`38b5ff0a-4518-4aa0-b884-c93546b9ee56`) (§18.2), both created on 2026-11-06 with `wrangler d1 create <name> --location=oc`. A test pins both IDs, so they can't be swapped. The location hint affects placement only and is not a data-residency guarantee. All previews share `sleepsteps-preview`, which holds test data only: it is never exported or analysed, and is emptied when no longer needed. Its writes count against the same account limits as production's (below).

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

Schema changes go through new migration files only (`wrangler d1 migrations create`, then `apply --local` before `apply --remote`). Never edit an applied migration. Each migration is applied to both remote databases, both human-only tasks (§18.4): `npm run db:migrate:preview` before a preview needs it, and `npm run db:migrate:remote` just before the merge to `main`. The Worker tests start from an empty D1 of their own and apply the migrations in their setup (M3). Workers Builds doesn't apply migrations (its API token has no D1 permission). `wrangler d1` commands read only the top-level `d1_databases`, so the preview database is reached through `wrangler.preview-migrations.jsonc`, which declares just that database. D1's `--preview` flag belongs to an older feature (`preview_database_id`) and is not used.

Free plan limits (Nov 2026): 100,000 rows written/day and 5 million rows read/day **per account**, and a 500 MB database. Each secondary index adds a written row, so one insert costs 2 rows (§17 schema): the real ceiling is about 50,000 events a day. Once either daily limit is hit, **every** D1 query fails until 00:00 UTC (10:00 AEST): saving, the admin page and the export. Pages and media keep working, and there is never a bill. The 500 MB cap does not reset. The free plan's point-in-time recovery covers only 7 days, so monthly CSV exports are the real backup.

If limits become a problem, upgrade to Workers Paid (US$5/month): no daily cut-off, 10 GB per database and 30-day point-in-time recovery. The plan switch itself needs no code changes. Export paging, index-friendly admin queries and any retention job are needed on either plan (§14.4). Use a Cloudflare account dedicated to this project, since the limits are shared across the account.

## 18. Build, deploy and setup

### 18.1 npm scripts

| Script | Does |
|---|---|
| `npm run build` | `validate-content` → Eleventy → `dist/`, including `search-index.json` (§8.3). Eleventy also runs the content check before every build, so `npm run dev` rebuilds and the tests' build fail on invalid content too. `node scripts/validate-content.js --no-placeholders` (the launch check) also fails on placeholder videos and on any video without a handout, audio or a transcript (§7.1, M8) |
| `npm run dev` | Eleventy watch + `wrangler dev` (local D1) |
| `npm test` | Vitest, two projects: `worker` (Worker routes and validation, in workerd via `@cloudflare/vitest-plugin`) and `node` (build scripts, CSV parsing, search queries, checks on a fresh build of the site in a temporary directory, and the browser modules run on that build in a small test DOM) |
| `npm run db:migrate:local` | Apply migrations to the local database that `wrangler dev` uses (the tests apply them to their own, §17) |
| `npm run db:migrate:remote` / `db:migrate:preview` | Apply migrations to the production database / the preview database, through `wrangler.preview-migrations.jsonc` (§17). Human-only (§18.4) |

### 18.2 `wrangler.jsonc` (skeleton)

```jsonc
{
  "name": "sleepsteps",
  "main": "worker/index.js",
  "compatibility_date": "<DATE OF SETUP>",
  "assets": {
    "directory": "./dist", "binding": "ASSETS", "not_found_handling": "404-page",
    "run_worker_first": ["/api/*", "/admin", "/admin/*"]   // added in M6
  },
  "workers_dev": true,      // false from launch
  "preview_urls": true,
  "d1_databases": [
    { "binding": "DB", "database_name": "sleepsteps", "database_id": "<ID>", "migrations_dir": "migrations" }
  ],
  "vars": { "ACCESS_TEAM_DOMAIN": "<TEAM>.cloudflareaccess.com", "ACCESS_AUD": "<AUD_TAG>", "DATA_COLLECTION": "off" },
  // Secrets (set with `wrangler secret put`, never committed): TURNSTILE_SECRET
  "previews": {
    "d1_databases": [ { "binding": "DB", "database_name": "sleepsteps-preview", "database_id": "<PREVIEW ID>" } ],
    "vars": { "ACCESS_TEAM_DOMAIN": "<TEAM>.cloudflareaccess.com", "ACCESS_AUD": "<AUD_TAG>", "DATA_COLLECTION": "on" }
  }
}
```

- `compatibility_date` must be no later than the newest date the pinned Wrangler's bundled workerd supports; otherwise `wrangler dev` refuses to start. Raise it when upgrading Wrangler.
- **Routing.** With this compatibility date, a browser *navigation* to a path with no matching file gets the 404 page straight from static assets, without the Worker running. Other unmatched requests (fetch, beacons, crawlers' `robots.txt`) reach the Worker, and the `ASSETS` binding lets it hand non-`/api/`, non-`/admin/` ones back to static assets. `run_worker_first` sends `/api/*` and `/admin*` to the Worker first; `/admin/` page loads need it (M6).
- **Previews.** Worker Previews (every branch but `main`, §18.3) inherit no vars or bindings from the top level, so the `previews` block repeats them: its own `DB` binding to `sleepsteps-preview` and every var (`DATA_COLLECTION` is off there too until previews are behind Access, §11). `assets`, `main` and `compatibility_date` come from the top level. `wrangler preview` refuses to run without a `previews` block. Preview secrets are set with `wrangler preview base-config secret put` and reach only previews created afterwards. Preview migrations use `wrangler.preview-migrations.jsonc` (§17). A test checks that the previews block has every production var and its own database.
- **Locally**, `wrangler dev` and the tests use only the top level, never the `previews` block, so they act like production: `wrangler dev` uses a local copy of the `sleepsteps` database, and the tests an empty one of their own. No binding may be marked `"remote": true`, which would point them at the real database.
- **No `account_id`.** Workers Builds supplies the account, and a mismatched `account_id` fails the build. Run Wrangler's remote commands logged in to the SleepSteps account.
- **At launch**, `"workers_dev": false` stops production answering on `workers.dev` (switching it off in the dashboard is undone by the next deploy), and `preview_urls` stays on. It is already set explicitly, because when it is missing a new Worker copies `workers_dev`. It also turns on version URLs (`<version>-sleepsteps.<subdomain>.workers.dev`), one for every production deploy, which stay public after launch and run that version's code on production's database, outside the custom domain's rate limit (§16.3). The `_headers` noindex rule covers them (§16.1), and the API must not accept writes through them: M3 makes the production API answer only on production's own host (§20 M3). Wrangler has a single setting for preview and version URLs, so they can't be turned off separately.

### 18.3 Deployment

Workers Builds is connected to the GitHub repo. Pushes to `main` build and deploy to production (`npx wrangler deploy`). Other branches build **Worker Previews** with `npx wrangler preview`, the default Preview command for a new Worker, each at `<branch>-sleepsteps.<subdomain>.workers.dev`. **Previews use the separate `sleepsteps-preview` database** and their own vars from the `previews` block (§18.2). (`npx wrangler versions upload`, the older preview model, would run branches on production's database; don't use it.)

- **The Worker must be named exactly `sleepsteps`**, the `name` in `wrangler.jsonc`. Otherwise the build fails (Cloudflare's docs), or with Wrangler 4.153.0 deploys under the dashboard's name while Builds tries to open a pull request renaming the config.
- **Build command:** `npm test && npm run build`, so a failing test stops the deploy. It runs for preview builds too (Free plan: 3,000 build minutes a month, one build at a time, 20-minute timeout). Deploy command `npx wrangler deploy`; Preview command `npx wrangler preview`.
- **Pinned versions.** Builds ignores `engines`, so Node is pinned exactly in `.node-version` (24.22.1, the Builds image's default and preinstalled version in November 2026) and npm in package.json's `packageManager` (`npm@11.18.0`; Builds otherwise uses npm 10.9.2, which ignores `allowScripts`). Local development may use a newer Node within `engines`. Raise the pins deliberately, after `npm ci && npm test && npm run build` passes on the new versions.
- **The setup PR merges first.** The real D1 IDs and the `previews` block must be on `main` before Builds is connected, or the first deploy fails.
- **Before launch the site is unlisted.** Production is public at `sleepsteps.<subdomain>.workers.dev` as soon as Builds deploys, and zone settings (§16.3) don't apply there. Until launch:
  - every `workers.dev` address sends `X-Robots-Tag: noindex`, from `_headers` (§16.1). Cloudflare's docs describe the automatic header only for preview URLs, so production on `workers.dev` relies on this rule; §18.4 step 7 checks it after the first deploy;
  - data collection stays off in production until the privacy officer's go-ahead, and in previews until they are behind Access: `DATA_COLLECTION` is `"off"` in both (§11). Turning it on is a reviewed one-line change to `wrangler.jsonc`.
- **At launch** the custom domain is added and `workers_dev` is turned off (§18.2).

### 18.4 Manual setup tasks (human only; Claude Code must not attempt dashboard changes)

1. Create a Cloudflare account dedicated to this project (institutional role mailbox, app-based 2FA) and add a second Super Administrator.
2. ~~Create a GitHub organisation and transfer the repo to it.~~ Done (`behavioralmedicinelab/sleepsteps-web`). Also: require 2FA, have two owners, and add a ruleset on `main` (pull request required, only named people can merge, since every merge deploys).
3. Register the domain. **Interim plan: a `.org` through Cloudflare Registrar** (multi-year term, auto-renew on an institutional card); a university domain is under discussion (§21). A `.au` licence runs at most 5 years and Cloudflare Registrar doesn't sell `.au`.
4. ~~Run `wrangler login`, then create the production and preview D1 databases (`--location=oc`, without `--update-config`) and send Claude both IDs for the setup PR.~~ Done 2026-11-06: `sleepsteps` and `sleepsteps-preview`.
5. Create a Turnstile widget (Managed mode, **Pre-clearance off**, since it sets a cookie): hostnames are the `workers.dev` address until the domain exists, then the domain. Put the site key in `site.config.json`; set the secret with `wrangler secret put TURNSTILE_SECRET`, and the preview secret to Turnstile's always-pass test value with `wrangler preview base-config secret put TURNSTILE_SECRET`.
6. Create a Zero Trust team (Free plan), add the One-time PIN login method, and create an Access application for `<DOMAIN>/admin` **and** `<DOMAIN>/admin/*` with a policy listing named emails and a session duration of 24 hours or less; send Claude the AUD tag.
7. Merge the setup PR, then connect Workers Builds: create the Worker from the GitHub repo with the name `sleepsteps`, production branch `main`, and the §18.3 commands. Then turn on preview builds (Settings → Build → Branch control → Enable Preview Builds). After the first deploy, check that `curl -sI https://sleepsteps.<subdomain>.workers.dev/` shows `x-robots-tag: noindex`.
8. Apply the security settings in §16.3 once the domain is active on Cloudflare, including Web Analytics and Email Address Obfuscation **off** and Challenge Passage at 30 minutes.
9. Add the custom domain to the Worker (Claude's launch PR sets `workers_dev: false`).
10. Verify the domain in Google Search Console (DNS TXT record).

Order matters: the D1 IDs must be on `main` before step 7; the domain must be active on Cloudflare before steps 8–9; the Access application and the Turnstile hostname must exist before step 9.

Also human-only, for every migration from M3 on (§17): `npm run db:migrate:preview` when its pull request opens, and `npm run db:migrate:remote` just before it merges. Both need `wrangler login` to the SleepSteps account.

## 19. Operations

### 19.1 Monthly (~30 minutes)

- Export all three tables from `/admin/export` and store them in team storage (not the repo).
- Review the zero-result searches on `/admin/` and update `keywords.csv`.
- Read new feedback.
- Check the D1 dashboard: daily rows written and database size against the free limits (§17).

**Quarterly:** remove people who have left from Cloudflare, Access policies, GitHub, YouTube and Search Console, and check that the second admins can still sign in.

**Yearly:** recheck crisis and support numbers and external links; check the domain expiry and that the renewal card is valid; upgrade Wrangler and raise `compatibility_date` (§18.2). Sign in to the Google accounts that own YouTube and Search Console at least every 2 years, or Google may delete them as inactive.

### 19.2 Adding a video

1. Upload to YouTube, on a channel that holds only SleepSteps videos (with `rel: 0` the suggestions at the end of a video come from its own channel). For each video, and in Studio's upload defaults where the setting exists:
   - **Visibility: upload as Unlisted, then switch to Public** (Public is the working decision, to confirm, §21). An Unlisted video plays in the site's player (a Private one doesn't), so its captions can be checked on a preview link or the local dev server before anyone can find it. Switch it to Public once that check passes, or keep it Unlisted until launch (M8) if the team wants videos hidden until then.
   - **Audience: "No, it's not made for kids".** YouTube's developer policies require embedders to turn off tracking on made-for-kids videos, which would stop the §9.4 play events. **No age restriction**: age-restricted videos don't play on other sites.
   - **Allow embedding** on; **comments off**; no end screen or cards; category Education; video language English. Leave "Publish to subscriptions feed and notify subscribers" unticked until launch.
   - **Licence: Standard YouTube License**, with the CC BY 4.0 statement and its exclusions in the description (the template is in `README.md`, "Uploading a video to YouTube"). `LICENSE-CONTENT.md` covers videos whose description states the licence; YouTube's own Creative Commons option covers the whole video and can't state the exclusions.
   - **Captions:** a plain "English" track, uploaded and checked (§9.1). While the video is Unlisted, check that it has a published "English" track, not only "English (auto-generated)", and that captions show when it plays on the site.
2. Export the audio-only MP3 from the final video (`README.md`, "Exporting the audio-only version"; §9.2) and add it, the handout and any thumbnail to `media/`.
3. Create `content/videos/<video_id>.md` with the front matter and transcript (§7.1), or, to replace a placeholder, edit its file: put in the real `youtube_id` and `duration`, replace the bracketed stand-in transcript with the real one, and delete `placeholder: true`.
4. Reference the `video_id` from a problem's `problem_video` or `solutions`, or from `content/start.md`.
5. For a new problem, also create `content/problems/<slug>.md` and add a row to `keywords.csv`.
6. Commit; the build validates everything and deploys. It warns about a video that is no longer a placeholder but has no handout, audio or transcript. `node scripts/validate-content.js` runs the same check on its own.

### 19.3 End of grant

1. Do a final export of all tables.
2. Set all `features` to `false` in `site.config.json` and `DATA_COLLECTION` to `"off"` in production and previews (`wrangler.jsonc`), and push. Turn off preview builds, and delete every remaining preview (`npx wrangler preview delete --name <preview>`): each keeps the build and vars it was made with.
3. Delete or retain the D1 data per ethics approval, and update the privacy page accordingly. Delete the `sleepsteps-preview` database.
4. Archive the videos, audio, handouts and transcripts in Zenodo or the institutional repository.
5. Record account owners and the domain expiry date in `README.md`.

## 20. Implementation milestones

Each milestone is a separate PR with tests passing and acceptance criteria met.

| # | Milestone | Acceptance criteria |
|---|---|---|
| M0 | Scaffold | Eleventy builds to `dist/`; Worker serves it locally with `wrangler dev`; `npm test` runs |
| M1a | Design system + site shell | Tokens as CSS custom properties; system fonts; logo; header, mobile header and menu, footer and topic menu match the handoff and work without JS; the information pages and 404 render; keyboard and 320px-width checks pass |
| M1b | Content model + page templates | Areas, the 36 problems (placeholder text) and sample videos load; build fails on missing fields, unknown references, bad solution counts or missing media; Sleep problems page (both views, live filter, no-JS fallback); problem page with expanding solution cards for 1–3 main and 0–3 extras; video facade with the YouTube notice under it (§15.1); Start here; Home; footer licence line (§22) |
| M2 | Search | Index built from content + keywords; search page works with fuzzy matching; query tests pass; no-JS fallback |
| M3 | Database + events | `worker/generated/pages.json` built (§8.3); migration applied locally; `/api/event` validates and inserts; page views and media plays (with the furthest point reached) logged; origin check; feature switch off → 404 and no client calls; `DATA_COLLECTION` off → 404 (§11), and whether production builds also leave the widgets out; the production API answers only on production's own host, never on version URLs (§18.2); first migration applied to both remote databases (§17); the usage-statistics switch works (§10.1); search events stored without `session_id` |
| M4 | Ratings | Widget accessible by keyboard and screen reader; inserts rows; failure message shown when the API is stopped |
| M5 | Feedback | Dialog, Turnstile (using test keys locally), validation, notice text, failure handling |
| M6 | Admin | Summary page and CSV export; requests without a valid Access JWT get 403 |
| M7 | Hardening | Headers/CSP enforced without console errors; accessibility pass (axe, keyboard-only walkthrough); all features tested off and with API failure |
| M8 | Launch | Human setup tasks done (§18.4); production smoke test; privacy page approved; urgent-help numbers and region confirmed, and Cancer Council's number and hours rechecked (§21); stored items checked in browser devtools against §15.4 and no Cloudflare-injected script in the live HTML (§16.3); no placeholder videos, and a handout, audio-only version and transcript for every video (`node scripts/validate-content.js --no-placeholders` passes); every video has the visibility confirmed in §21 and a checked plain "English" caption track that shows when it plays on the site (§19.2); audio plays and seeks in Safari on an iPhone and in Chrome (§9.2); no `[bracketed]` placeholder text left on any page |

## 21. Open decisions

- [x] Information architecture and navigation: resolved by the design handoff (§7, §22)
- [ ] Data retention period for ratings, feedback and events
- [ ] Whether to add an optional weekly feedback-digest email (scheduled Worker; needs Email Routing)
- [ ] Whether the AI "Agent" crawler category is allowed
- [ ] Domain: interim plan is a `.org` through Cloudflare Registrar; a university domain is under discussion (whether it avoids "SleepSteps" is the next item)
- [ ] Whether names outside the pages avoid "SleepSteps" too, as the site's copy now does (§7.5): the YouTube channel name, the domain, the Turnstile widget name and any email display names. The project email, psych.sleepsteps@monash.edu, is decided (2026-11-06)
- [x] Bot Fight Mode and cookies: essential storage is allowed if disclosed (§2, §15.4); Bot Fight Mode is off at launch and held in reserve (§16.3)
- [ ] Privacy-officer questions from the cookies/GDPR review: which privacy law covers the university; GDPR/PECR scope; approval of "no tracking, all storage disclosed", whether the HREC must re-approve that change, and whether participant information sheets say anything about cookies or the website; the statistics switch (and whether to honour Global Privacy Control); search-text handling; Turnstile; the YouTube notice and YouTube's Terms of Service wording; overseas processing; implied consent for health details; pre-approval of the `__cf_bm` wording
- [x] Content licence: CC BY 4.0, excluding the SleepSteps name and logo and third-party material (`LICENSE-CONTENT.md`, §22)
- [x] Code licence: stays MIT (Creative Commons advises against CC licences for software)
- [ ] Copyright holder: `Behavioural Medicine Lab` is used in both licence files; confirm with the university's IP policy who owns staff-created materials
- [ ] Whether to move to Workers Paid (US$5/month) at launch, for no daily cut-off and 30-day recovery (§17)
- [ ] Data collection in previews: to test ratings, feedback and events on previews (M3–M5), previews first go behind Cloudflare Access ("Previews only", named emails; §18.4 step 6), because preview URLs are public and appear on pull requests in the public repo. Until then `DATA_COLLECTION` stays off in previews and M3–M5 are tested locally. Access sets a `CF_Authorization` cookie for the reviewers who sign in, which §15.4 and the privacy page would need to cover
- [x] Whether ratings appear on non-video pages: no, ratings are per video (§12)
- [ ] Handout format: PDF, Word or web page (every video has one; what each would change is in §9.3)
- [x] GP summary and sleep diary: none for now (2026-11-06); Getting more help has no GP summary line (§7.5)
- [x] Audio-only versions: yes, for every video, made from the video's own soundtrack (§9.2)
- [x] Transcripts: yes, for every video (2026-11-06), as the audio-only version's text alternative (WCAG 2.2 SC 1.2.1) and the captions' source (§9.3)
- [ ] Urgent-help numbers and the region they apply to (the mockups assume Australia: 000, Lifeline 13 11 14)
- [x] Cancer support line: Cancer Council, 13 11 20 (Australia), `https://www.cancer.org.au/` (2026-11-06). A free, confidential information and support line, open 9am to 5pm, Monday to Friday (longer in some states); not a crisis service (§7.4, §16.1)
- [x] Captions on by default: yes (`cc_load_policy: 1`, §9.1)
- [ ] YouTube videos public or unlisted: working decision Public (2026-11-06), to be confirmed before the first video is switched to Public; videos are uploaded as Unlisted until then (§19.2)
- [ ] Ads on the videos: YouTube may show ads on any video, public or unlisted, with no opt-out unless the channel joins the YouTube Partner Program and turns ads off per video (in the privacy-enhanced player they are not personalised). The team will explore the Partner Program (2026-11-06), but joining needs 1,000 subscribers and 4,000 watch hours of public long-form videos in the last 12 months, so a new channel is unlikely to qualify by launch. Whether the team and the HREC accept ads until then, and whether the privacy page or the video notice should say so
- [ ] Team review of each problem's area and time-of-day placement, related topics and keywords
- [ ] Confirm the About and Home trial text drafted from the concept note (version 0.3, 5 July 2026; not a final protocol): what the trial tests, who can take part, the steps, Joshua F. Wiley as chief investigator, the research group and the NHMRC funding line (§22). Still placeholders: the other team members and their photos, ethics committee and number, trial registry and number (on About and in the footer), and the lived-experience quote
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
| 2026-11-05 | "No tracking, and everything disclosed" replaces "no cookies" (§2): essential storage is allowed when listed in §15.4 and on the privacy page | "No cookies" was already untrue once YouTube plays or Turnstile loads; Australian law requires an accurate policy, not consent; follows UK-style disclosure practice voluntarily |
| 2026-11-05 | Bot Fight Mode off at launch, held in reserve with triggers and a fallback order (§16.3); Cloudflare Web Analytics and Email Address Obfuscation off; Challenge Passage 30 minutes | Bot Fight Mode barely protects the D1 budget, can drop real beacons, and its script needs the Worker on every page; the other two inject scripts that break §16.2 and the CSP |
| 2026-11-05 | A "Turn off usage statistics" switch on the privacy page (§10.1) | Meets the objection condition in PECR Sch A1 para 5 for consent-free statistics (the "sole purpose" wording is pending the privacy officer, §21); lets anyone opt out |
| 2026-11-05 | Search events are stored without `session_id`, with `ts` rounded down to the hour (§10.1, §10.2, §14.1, §14.2) | Search text is the data most likely to hold health details; storing it without the visit code, with its time rounded to the hour, makes it hard to link to the rest of a visit. No migration: the column is nullable |
| 2026-11-05 | Keep the YouTube IFrame Player API, with a notice under each video before play (§9.1, §15.1) | Play depth needs the API, which sets YouTube cookies after play; the notice makes pressing play an informed choice (ICO "feature-led consent"; EU two-click practice) |
| 2026-11-06 | Placeholder content builds and is flagged: `[bracketed]` text, and videos with `placeholder: true` and `youtube_id: "PLACEHOLDER"` that show "[Video coming soon]" with no link (the §15.1 notice still shows under them); the build warns about them and M8 requires none (§7, §9.1, §20) | The team can review real layouts before the videos exist; sample content never carries a real third-party video ID, and nothing contacts YouTube from a placeholder |
| 2026-11-06 | More content checks: each video once per page, `youtube_id` and `duration` formats, plain-Markdown transcripts (no headings or HTML), bare media file names, unknown fields, at most 3 related topics and none the problem itself, at most 4 bullets; front matter read with Eleventy's own parser; the check also runs inside every Eleventy build (§7.1–§7.3, §18.1) | Each catches a mistake that would otherwise render wrongly or silently drop content: duplicate ids, a broken heading outline, CSP-breaking HTML, a misspelt field |
| 2026-11-06 | `playerVars` gain `autoplay: 1`, which only takes effect because the player is created after the click; focus moves to the player; a failed load shows "The video couldn't load here." with the YouTube link (§9.1) | One press plays the chosen video; keyboard and screen-reader users land in the player; no dead button |
| 2026-11-06 | A video's title is a visible plate on the facade only where no nearby heading names it (a problem's own video); elsewhere it is the play control's accessible name (§9.1) | §9.1 lists the title in the facade; repeating a heading on the frame adds clutter |
| 2026-11-06 | "Read transcript" and "Audio only" are native `<details>` that JavaScript doesn't replace; "Read transcript" sits on its own line under the handout and audio buttons; "Print transcript" is a button that only JavaScript shows (§7.5, §9.3) | Works without JavaScript; a native summary can't share a row with other buttons and open its panel below the whole row; printing one transcript needs `window.print()` |
| 2026-11-06 | `scripts` front matter loads page modules, as `styles` does for stylesheets; shared component styles are in `src/css/components.css` (§7.4, §7.5) | Video JavaScript loads only on pages with videos (§11); pages built in parallel don't edit one stylesheet |
| 2026-11-06 | The footer's bottom row states the content licence, linking to CC BY 4.0; `creativecommons.org` joins the outbound-link allowlist (§16.1) | CC BY needs a licence notice where the content is published |
| 2026-11-06 | Phone section headings use the 24px title size, not the boards' 26px (§7.5) | No new type token for one board value |
| 2026-11-06 | Solution cards are native `<details name="solution">` that `solutions.js` upgrades to `<h3><button aria-expanded>` with a labelled region, one open at a time across both sections; they start closed (the boards open the first); on phones focus stays on the card's button instead of moving to the heading (HANDOFF §6.4) (§7.5) | Works without JavaScript; one video facade and notice on the first screen instead of two; the heading the handoff focuses isn't shown on phones |
| 2026-11-06 | Sleep problems: areas are headings that `problems.js` upgrades to buttons; the filter, view toggle, "Open all areas" and the lanes appear only with JavaScript; commas or semicolons separate alternatives; when nothing matches every topic stays in view; the filter is labelled "Find a sleep problem on this page" (§7.2, §7.5, §8.1) | No dead or unexplained controls and no link listed twice without JavaScript; the header's site search is already "Search sleep problems" and leaves the page |
| 2026-11-06 | The play control is described by the video notice (`aria-describedby`); focus moves to the player only if it hasn't moved elsewhere while loading (§9.1) | Keyboard and screen-reader users meet the notice before pressing play, which keeps pressing play an informed choice; no focus pulled back after a slow load |
| 2026-11-06 | Phone layouts keep content the phone boards drop ("Is this you?" in full, Related topics' lines, Home's area descriptions, step links and format tiles), stack the formats one per line, and use the 34px phone H1 on Home; the first "On this page" chip is filled and the chips wrap (§7.5) | Nothing lost at 320px or 400% zoom (WCAG 1.4.10); native disclosures need the full width to open; one phone H1 size; no sideways scrolling |
| 2026-11-06 | Transcripts may not contain images or links to other sites; links on a `panel` ground are `ink`; layouts can declare `styles` and `scripts` in their own front matter (§7.1, §7.4, §7.5) | An image or outside link would break the CSP or skip the outbound-link allowlist and `noreferrer`; `deep-teal` on `panel` is not a listed pair; page assets stay with the layout that needs them |
| 2026-11-06 | The browser modules are tested in a small DOM written for the tests (`test/node/mini-dom.js`), not a DOM package (§5, §18.1) | The privacy-critical player behaviour (nothing loads before the click; the nocookie host and player settings) and the accordion and filter behaviour need running, not text matching; no new dependency |
| 2026-11-06 | Every video has a handout; its format (PDF, Word or web page) is still open, and until it is decided handouts are PDFs in `media/pdf/` (§7.1, §9.3, §21) | Project lead's decision, 2026-11-06. Supersedes the handout part of the 2026-11-05 "optional per video" row |
| 2026-11-06 | Every video has an audio-only version: its own soundtrack exported as a mono 44.1 kHz 96 kbps MP3, loudness-normalised to −16 LUFS (`dual_mono`) with a −1.5 dBTP true-peak ceiling before encoding so the MP3 measures at or below −1 dBTP, metadata stripped and ID3 tags added; the export commands are in `README.md`; the per-file limit is now about 36 minutes (§9.2, §19.2) | Project lead's decision, 2026-11-06 (supersedes the audio part of the 2026-11-05 "optional per video" row). 96 kbps instead of 64 because the soundtrack may carry music, at about 1.2 MB more per 5 minutes; −16 LUFS matches podcast apps, so the audio plays at a familiar level |
| 2026-11-06 | Captions on by default: `playerVars` gain `cc_load_policy: 1` and `cc_lang_pref: 'en'`; captions are uploaded as a plain "English" track and checked by a person; the "Watch on YouTube" link stays without a caption parameter (§9.1) | Project lead's decision, 2026-11-06. YouTube doesn't document whether auto-generated captions show with `cc_load_policy`, and the watch page has no documented caption parameter |
| 2026-11-06 | YouTube videos are public (working decision, to be confirmed), on a SleepSteps-only channel: uploaded as Unlisted and switched to Public once their captions are checked on the site (M8 checks every video), not made for kids, no age restriction, embedding allowed, comments off, Standard YouTube License with the CC BY 4.0 statement in the description (§19.2, §20, §21) | Project lead's working decision, 2026-11-06. A video uploaded straight to Public can't have its captions checked on the site before anyone can find it, and a Private one doesn't play there. Made-for-kids videos would require turning off play tracking; age-restricted videos don't embed; YouTube's Creative Commons option can't express `LICENSE-CONTENT.md`'s exclusions; with `rel: 0` end suggestions come from the same channel |
| 2026-11-06 | No GP summary or sleep diary for now: the Info-Help board's GP summary line and the `gp_summary` front matter are removed, and the "What to bring" placeholder no longer mentions a SleepSteps diary (§7.5, §21). Supersedes the 2026-11-05 GP summary row | Project lead's decision, 2026-11-06; git history keeps the `gp_summary` code if the summary returns |
| 2026-11-06 | The `pdf_download` event is renamed `handout_open` and its detail becomes `{ media: video_id }` instead of the file name; the handout link's `data-pdf` hook becomes `data-handout`, holding the `video_id` (§9.3, §9.4, §10.2) | Neither the name nor the detail depends on the handout format (a web-page handout has no file name), and the Worker can check the `video_id` against `pages.json` as it does for `transcript_open`. No events have been collected and the Worker's closed list (M3) isn't built, so nothing else changes |
| 2026-11-06 | Launch check: the build warns (`missing-handout`, `missing-audio`) about a video that is not a placeholder and has no handout or audio, and `--no-placeholders` fails on any video without them; placeholders are not warned about twice; transcripts stay optional (§7.1, §18.1, §20 M8) | Every video is to have both by launch; keeping placeholders out of the warnings keeps the normal build output readable |
| 2026-11-06 | Home names the audio-only version and promises no transcript for every video: the board's "Watch, read or print" panel becomes "Watch, listen, read or print" (the hero line too) and gains an "Audio" tile after Video, in the heading's order; the panel's line and step 3 no longer mention transcripts; the tiles go one, two or four to a row, by the width of their list (four from 636px, the board's 150px tiles and 12px gaps) (§7.5) | Every video has an audio-only version; transcripts are optional; four tiles in a 150px-minimum grid would otherwise leave one tile alone on a row |
| 2026-11-06 | Audio play and seek are checked on a real iPhone and in Chrome before launch, and a range-serving Worker route is added only if that fails (§9.2, §20 M8) | Workers static assets answer `Range` requests with the whole file (documented November 2026); a single report says Safari still plays MP3s that way, and a Worker route would cost Worker requests on every play |
| 2026-11-06 | Every video has a transcript by launch, superseding the "transcripts stay optional" parts of the 2026-11-05 optional-formats row and the 2026-11-06 launch-check and Home rows: the build warns (`missing-transcript`) about a real video whose body is empty or only whitespace, and `--no-placeholders` fails on it; a real video whose transcript is still a placeholder's [bracketed] stand-in, or any transcript with an HTML comment, fails the build; Home's formats line and step 3 name the transcript again (§7, §7.1, §7.5, §9.2, §9.3, §18.1, §19.2, §20 M8, §21) | Project lead, 2026-11-06. WCAG 2.2 SC 1.2.1 (Level A) asks for a text alternative to the audio-only versions, and the captions are made from the transcript anyway |
| 2026-11-06 | The YouTube channel holds only SleepSteps videos (confirmed); the team will explore the YouTube Partner Program to turn ads off, which stays an open item (§19.2, §21) | Project lead, 2026-11-06. With `rel: 0` end suggestions come from the same channel. Only Partner Program members can turn ads off per video, and joining needs 1,000 subscribers and 4,000 public watch hours in 12 months |
| 2026-11-06 | The Worker is `sleepsteps`, with D1 databases `sleepsteps` (production) and `sleepsteps-preview` (Worker Previews), created with location hint `oc`; their IDs are in `wrangler.jsonc`, which has no `account_id` (§17, §18.2) | The owner's choice of name. Workers Builds supplies the account, and a mismatched `account_id` fails the build |
| 2026-11-06 | Previews are Worker Previews built with `npx wrangler preview`: a `previews` block repeats the `DB` binding (to `sleepsteps-preview`) and every var; `wrangler.preview-migrations.jsonc` declares the preview database for `npm run db:migrate:preview`; `workers_dev` and `preview_urls` are set explicitly (§17, §18.1–§18.3) | Previews inherit no vars or bindings, and `wrangler preview` refuses to run without the block. `wrangler d1` commands read only the top-level databases (Cloudflare's documented pattern). Without `preview_urls`, a new Worker copies `workers_dev`, which the launch PR turns off. `versions upload` previews would run on production's database |
| 2026-11-06 | Data collection is switched per environment by the Worker var `DATA_COLLECTION`, which must be exactly `"on"`: `"off"` in production until the privacy officer's go-ahead, and `"off"` in previews until they are behind Access (§21). While it is off every `/api/*` route returns 404, which a Worker test guards. Whether production builds also leave the widgets out is decided in M3 (§11, §18.3, §20 M3) | Production and previews have their own vars but run the same build command, and the build has no reliable production-or-preview signal (only the branch name, or build variables whose dashboard support is unverified). A runtime switch fails safe. Preview URLs are public, appear on pull requests in the public repo, and share the account's D1 limits with production, so previews collect nothing either |
| 2026-11-06 | `noindex` before launch comes from `_headers` (`src/_headers`, copied to `dist/`): `https://:version.:subdomain.workers.dev/*` and `/404`; a test parses the file as Cloudflare does and checks that no rule could hide the custom domain; the rule stays after launch for preview and version URLs (§16.1, §18.2, §18.3) | Cloudflare's docs describe automatic noindex only for preview URLs. Setting it in the Worker would need `run_worker_first: true`, making every asset request a Worker request. The placeholder rule can't match a custom domain and survives a rename. The 404 page is also served at `/404` with a 200 |
| 2026-11-06 | Node is pinned to 24.22.1 in `.node-version` and npm to 11.18.0 in `packageManager`, superseding the reason given in §18.3 ("Builds defaults to an older Node") (§18.3) | Builds now defaults to Node 24.22.1 (preinstalled) and npm 10.9.2; Node 26 isn't documented for Builds. Exact pins keep builds reproducible, and npm 10 ignores `allowScripts`. A clean `npm ci`, `npm test` and `npm run build` passed on Node 24.22.1 with npm 11.18.0 |
| 2026-11-06 | User-facing copy doesn't lean on the name "SleepSteps" (one word): by default it says "this program", "we", "us" and "our", or "this website" for the site itself, placeholder copy included. The name is in the header logo (image and alt text "SleepSteps home") and the footer heading (`siteName`, which stays "SleepSteps"), and the team may use it in a few places, such as About; it is a soft rule with no test. The urgent page's back link becomes "Back to home"; the footer's tagline and licence line say "This program" and "our name and logo"; a printed transcript's source line drops the site name; `LICENSE-CONTENT.md` says "this website's content" and "the Behavioural Medicine Lab", and names what is excluded exactly ("the SleepSteps name and logo"), as does the README's YouTube description template; its suggested credit names and links the item adapted. Technical names (repo, Worker, D1 databases, `workers.dev` address, Wrangler files, package name, storage keys, the `sleepsteps:event` DOM event, file names, data attributes) keep `sleepsteps` (§7.5, §9.3, §15.1, §15.2) | Project lead, 2026-11-06: another organisation has trademarked a "Sleep Steps" program. The technical names don't present the program to anyone, and renaming them would mean new databases, storage keys and deploy settings |
| 2026-11-06 | Browser tab titles are the page title alone, without " \| SleepSteps"; Home, which had no title, is titled "Sleep during and after cancer" (its H1 and headings don't change; its copy changes are in §7.5) (§7.5, §11) | Follows the naming rule above; without the site name Home needs a title of its own |
| 2026-11-06 | The About page is "About us" (its title, eyebrow and information side-menu label), and "Why we made SleepSteps" becomes "Why we made this program"; the main nav keeps "About" (§7.4, §7.5) | Follows the naming rule above |
| 2026-11-06 | The intro placeholder video `how-to-use-sleepsteps` ("[How to use SleepSteps]") is renamed `how-to-use-this-program` ("[How to use this program]"), with `content/start.md` updated (§7.5) | Follows the naming rule above. Videos have no URL of their own, so no redirect is needed, and as a placeholder it has no ratings or events |
| 2026-11-06 | The project email is psych.sleepsteps@monash.edu, on the Contact page and in the privacy page's contact line (§7.4, §15.2) | Project lead, 2026-11-06 |
| 2026-11-06 | The cancer support line is Cancer Council, 13 11 20 (Australia): a card on Getting urgent help (the number as a `tel:` link, and its hours) and a service card on Getting more help, each with a link to `https://www.cancer.org.au/`, which joins the outbound-link allowlist (§7.4, §16.1, §21). Cards in `other_contacts` and `services` gain optional `url` and `link_text`; an urgent card with a website makes only its number a `tel:` link, not the whole card. The crisis numbers and `crisisRegion` stay to be confirmed | Project lead, 2026-11-06. Cancer Council describes it as a free, confidential information and support line, open 9am to 5pm, Monday to Friday (longer in some states). It is not a crisis service, so it sits with the smaller cards, not the crisis cards |
| 2026-11-06 | Audio-only MP3s are tagged with "Behavioural Medicine Lab" as artist and no album tag, superseding the tag part of the 2026-11-06 audio row (§9.2; the commands are in `README.md`) | Follows the naming rule above: the tags were "SleepSteps" as artist and album |
| 2026-11-06 | Site search (M2): MiniSearch 7.2.0 is a dependency, copied as published (browser ES module, source map, MIT licence) to `/js/vendor/minisearch/` by Eleventy passthrough (§5, §6) | No bundler (§5); the published ES build is one self-contained module. Released September 2025, well past the two-week rule |
| 2026-11-06 | The search index is built inside every Eleventy build by `content/search-index.11ty.js` with `scripts/build-data.js`, not as a separate build step; entries are every problem, Start here and the information pages without `search: false`; a problem's text also carries its "Is this you?" summary and bullets; information pages contribute their rendered body text; `worker/generated/pages.json` moves to M3 (§8.3, §18.1, §20) | One source of truth for URLs and titles, and `npm run dev` and the tests' build get the index too. "Is this you?" is written in the words people use for their problem. Information pages are built from front matter and Nunjucks, so only their rendered text is right. Nothing uses `pages.json` before M3 |
| 2026-11-06 | The search page (no board): its own GET form ("Search this website"), a `role="status"` count line, results as title link (H2), type label and summary, top 10, messages for no results and for a failed load (15-second limit), the urgent-help line under the form on every search, and the no-JavaScript fallback; the first focus on a header search box prefetches MiniSearch and the index (`menu.js`) (§8.1) | Uses existing components and tokens. The urgent line is there because ranking alone can't put Getting urgent help first for every way of saying distress. Prefetching uses `<link rel="prefetch">`: the browser fetches the two static files into its cache, but no script runs and no query is sent |
| 2026-11-06 | `data/keywords.csv` is validated by the content check (unknown, empty or repeated `page_id`, wrong columns fail; pages without keywords warn), and a starter set is in place, drafted from the team's planning sheet and draft scripts; `test/node/search-queries.test.js` checks 72 example queries (expected page in the top 3) and 10 crisis words (Getting urgent help first) (§8.2, §8.4) | The team will hand-edit keywords once titles, areas and videos settle; the query tests show what an edit changes |
| 2026-11-06 | The search page sets `<meta name="referrer" content="strict-origin">`, names its search landmark, keeps its status line rendered while empty, and builds the index's information pages from `collections.all`; a keywords row for a page with `search: false` fails with its own message (§8.1, §8.2, §8.3, §16.1) | Found in review: without the meta tag, a query reached YouTube through the next page's `document.referrer` (its player script copies it into the embed); two unnamed search landmarks read the same; a live region shown with its first text may not be announced; a page importing a collection could silently drop out of the index |
| 2026-11-06 | The footer's wording moves from `src/_includes/partials/site-footer.njk` into `footer` in `site.config.json`: the tagline, the Acknowledgement of Country, the trial registration and ethics approval numbers (still placeholders) and the licence line's exclusions. "Content is licensed under CC BY 4.0" and its link stay in the template; an empty acknowledgement, registration or ethics value is left out. The footer renders as before apart from the Acknowledgement; README "Other content" says where the text is (§6, §7.5, §11) | Project lead, 2026-11-06: editors looked for the footer text in `content/` and couldn't find it. `site.config.json` already holds the other site-wide wording (the crisis contacts). Keeping the licence name and link in the template means the line always states the licence |
| 2026-11-06 | The footer's Acknowledgement of Country reads "We acknowledge and pay respects to the Elders and Traditional Owners of the land on which we work.", adapted from Monash University's ("We acknowledge and pay respects to the Elders and Traditional Owners of the land on which our Australian campuses stand.", monash.edu) (§11) | Project lead, 2026-11-06: something simple, based on what Monash University says. "On which we work" fits a website, which has no campus |
| 2026-11-06 | About and Home trial text drafted from the project lead's concept note (version 0.3, 5 July 2026, a team working document and not a final protocol), for the team to confirm (§21): About's hero line, "Why we made this program" (naming the program once: "SleepSteps is a research trial of a stepped care program for sleep in people with cancer."), the trial facts "What it tests" (a self-help program: the website's videos with regular tips by text or email, then a therapist and a sleep specialist for those who need more) and "Who can take part" (new; framed as the trial's criteria, "Other criteria apply", and that anyone can use the website), Joshua F. Wiley as chief investigator in "Who we are", and Home's trial text, which adds that you don't need to be in the trial to use the website. From the project lead's own records (CV, not the note): "Who runs it" is the Behavioural Medicine Lab, School of Psychological Sciences, Monash University; "Funding" is a National Health and Medical Research Council (NHMRC) Investigator Grant (2043220), on which he is chief investigator. Only what suits a public page is used: what the trial tests, the steps in plain words, who can take part in general terms, and that Monash University runs it. The rest of the note (study design details, sites, grant amounts and internal notes) is left out, and whatever it doesn't give stays a placeholder (§7.5) | Project lead, 2026-11-06: fill the placeholder text from the concept note. Written for people affected by cancer, in plain words, with the program named only where the lead asked (§7.5) |
