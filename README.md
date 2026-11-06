# sleepsteps-web

Website for a clinical trial of a stepped-care sleep intervention. It is a static site (Eleventy) plus a single Cloudflare Worker and a D1 database for optional anonymous ratings, feedback and usage events.

`SPEC.md` is the source of truth for how the site works and how it is built. The visual design handoff is in `docs/design/`.

## Quick start

Requires Node 22.12 or later. Cloudflare builds with the Node version in `.node-version` (24.22.1) and the npm version in `package.json`'s `packageManager`.

```sh
npm install
npm run build   # build the site into dist/
npm run dev     # local site + Worker at http://localhost:8787
npm test        # run tests
npm run db:migrate:local && npm run dev:collect   # the same, storing usage statistics, ratings and feedback locally (below)
```

`npm run dev` passes extra flags to `wrangler dev`, e.g. `npm run dev -- --port 8799`.

### Usage statistics, ratings and feedback locally

`npm run dev` keeps data collection off, as production does until the privacy officer's go-ahead: pages still send their usage statistics, and the API answers 404 and stores nothing (`SPEC.md` §11). The stars under each video show, but a rating gets "Couldn't send right now — please try again later", and so does the feedback dialog ("Send feedback" in the footer). To try the statistics, ratings and feedback end to end against a local database:

```sh
npm run db:migrate:local   # once, and again after each new file in migrations/
npm run dev:collect        # like npm run dev, with collection on for this run
```

Open http://localhost:8787 (the API answers only on port 8787, at `localhost` or `127.0.0.1`). Open a sleep problem page, play an audio-only version, open a handout, rate a video or search, then look at what was stored:

```sh
npx wrangler d1 execute sleepsteps --local --command "SELECT ts, session_id, page, type, detail FROM events ORDER BY ts DESC LIMIT 20"
npx wrangler d1 execute sleepsteps --local --command "SELECT ts, page, video, stars FROM ratings ORDER BY id DESC LIMIT 20"
```

A star clicked or tapped is sent at once; a star reached with the arrow keys is sent after a 2-second pause, when focus leaves the stars, or on Enter (`SPEC.md` §12).

**Feedback and its spam check.** The feedback dialog uses Cloudflare Turnstile, which needs no Cloudflare account locally: on `localhost` and `127.0.0.1` the dialog uses Cloudflare's published always-pass test site key, `1x00000000000000000000AA`, and `dev:collect` gives the Worker the matching test secret, `1x0000000000000000000000000000000AA`, with `--var` (`SPEC.md` §13, §14.3). The widget then says "For testing only. If seen, report to site owner"; that is expected. The dialog still loads Turnstile's script from `challenges.cloudflare.com` the first time it opens, so you need to be online. Send a message, then check what was stored, without printing the message itself:

```sh
npx wrangler d1 execute sleepsteps --local --command "SELECT ts, page, page_title, length(message) FROM feedback ORDER BY id DESC LIMIT 20"
```

The time is rounded down to the hour. To see a check that fails, run the Worker with one of Cloudflare's other test secrets instead (`npm run build` first): `2x0000000000000000000000000000000AA` always fails, and `3x0000000000000000000000000000000AA` answers as if the token had already been used. Either way the dialog says "Couldn't send right now — please try again later" and keeps the text.

```sh
npx wrangler dev --var DATA_COLLECTION:on --var API_HOSTS:localhost:8787,127.0.0.1:8787 --var TURNSTILE_SECRET:2x0000000000000000000000000000000AA
```

Keep `--local` (Wrangler's default, written out so the command says what it does) and never use `--remote`, which reaches the real database. Never put `DATA_COLLECTION` or `API_HOSTS` in `.dev.vars`; `dev:collect` passes them on the command line for that run only, and the tests check this. `.dev.vars` may hold a `TURNSTILE_SECRET` line, but only with one of Cloudflare's three test secrets above (the tests check that too); the real secret lives only in Cloudflare (`SPEC.md` §18.4). The "Turn off usage statistics" switch on the privacy page works in this mode too.

## Content editing

Everything below can be edited in GitHub's web editor. Every build starts with a content check (`node scripts/validate-content.js` runs it on its own): if something is wrong, the build stops and names the file and field. The full rules are in `SPEC.md` §7.

Text in `[square brackets]` is a placeholder for the team to replace.

In page text, don't lean on the name "SleepSteps" (one word): call it "this program" and the team "we" or "us" by default, and name it only in a few places, such as About (`SPEC.md` §7.5). File names, storage keys and other technical names keep `sleepsteps`.

### Videos

One file per video in `content/videos/<video_id>.md`. The file name is the `video_id`: lowercase words joined by hyphens, and never renamed once used. A video has no page of its own; problem pages and Start here show it.

```yaml
---
title: "Sleep drive"
youtube_id: "AbCdEfGhIjK"           # the 11 characters after watch?v= in the YouTube link
duration: "6:40"                    # minutes:seconds, in quotes
audio: "sleep-drive.mp3"            # the audio-only version: a file in media/audio/ (25 MiB at most)
handout: "sleep-drive.pdf"          # the handout: a file in media/pdf/
thumbnail: "sleep-drive.jpg"        # optional: a file in media/thumbs/
---
Optional: a transcript, as plain paragraphs. The site never shows it, but its
words help the site search find the video's page. Leave a blank line between
paragraphs. No headings (#), no HTML, no images, and no links except to pages
on this site, such as [Pain](/problems/pain/).
```

Every video needs a handout and an audio-only version by launch. The build warns about a video that is missing either, and the launch check (`node scripts/validate-content.js --no-placeholders`) fails on it. Any format a video doesn't have yet is simply not shown. Under each video the page shows one row: "Audio only", "Handout" and "Was this helpful?" with its stars.

**The handout carries the narration.** There are no transcripts on the site: the handout is each video's text version (the text alternative for people who can't hear the audio), so it has the video's full narration, word for word, naming the speakers, plus anything that matters on screen. The "Handout" button under each video links to it. Make it accessible: for a PDF, export it from Word as a tagged PDF and check it (`SPEC.md` §9.3).

A transcript in the video file is optional. If there is one, it is never shown, but the site search indexes it, and it can be the source for the YouTube captions.

The handout's format (PDF, Word or a web page) is still being decided (`SPEC.md` §9.3); until then it is a PDF.

**Placeholder videos.** Until a video is on YouTube, its file has `placeholder: true`, `youtube_id: "PLACEHOLDER"` and `duration: "[mm:ss]"`; the page shows "[Video coming soon]". To make it real, put in the YouTube ID and duration, replace the bracketed stand-in transcript (if it has one) with the real transcript or delete it, and delete the `placeholder: true` line. The build fails on a real video that still has the stand-in, since the search would index it. The build lists the placeholders that are left; there must be none at launch.

### Exporting the audio-only version

The audio-only version is the video's own soundtrack, exported from the final video file as an MP3 (`SPEC.md` §9.2): mono, 44.1 kHz, 96 kbps, loudness-normalised to -16 LUFS, with `loudnorm` aiming for a true peak of -1.5 dBTP so the finished MP3 stays at or below -1 dBTP, and with the source file's metadata removed and our own tags added. It needs [ffmpeg](https://ffmpeg.org/). The commands below assume a stereo master; if the master's sound is already mono, leave out `pan=mono|c0=0.5*c0+0.5*c1,` in both steps.

1. Measure the loudness. Note `input_i`, `input_tp`, `input_lra`, `input_thresh` and `target_offset` from the output.

   ```sh
   ffmpeg -hide_banner -nostats -i master.mp4 -map 0:a:0 -vn \
     -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:dual_mono=true:print_format=json" \
     -f null -
   ```

2. Export, putting the step 1 numbers in place of the `<...>` and the video's title and `video_id` at the end. In the output, `normalization_type` should be `linear`. If it says `dynamic`, one steady gain wasn't possible: the master's peaks are too high to reach -16 LUFS under the ceiling, or its loudness range is wider than `LRA=11`. Either ask the video editor for a peak-limited master and start again, or keep the file and listen to all of it after step 3, since dynamic mode changes the level as it goes.

   ```sh
   ffmpeg -hide_banner -i master.mp4 -map 0:a:0 -vn -map_metadata -1 -map_chapters -1 \
     -af "pan=mono|c0=0.5*c0+0.5*c1,loudnorm=I=-16:TP=-1.5:LRA=11:dual_mono=true:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true:print_format=json" \
     -ar 44100 -ac 1 -c:a libmp3lame -b:a 96k -id3v2_version 3 -fflags +bitexact \
     -metadata title="<video title>" -metadata artist="SleepSteps Trial Research Team" \
     -metadata date=2026 -metadata language=eng \
     -metadata copyright="2026 SleepSteps Trial Research Team. Licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/" \
     media/audio/<video_id>.mp3
   ```

3. Check the file. The first command should show `mp3`, `44100`, 1 channel, the video's duration and a size of at most 26214400 bytes (25 MiB). The second should show an integrated loudness (`I:`) of about -16 LUFS and, under "True peak", a `Peak:` at or below -1.0 dBFS. `loudnorm` aims for -1.5 to leave room for the MP3 encoder, which can push peaks a little higher. If the peak is above -1.0, repeat steps 1 and 2 with `TP=-2` in place of `TP=-1.5`.

   ```sh
   ffprobe -v error -sexagesimal -show_entries format=duration,size,bit_rate:stream=codec_name,sample_rate,channels \
     -of default=noprint_wrappers=1 media/audio/<video_id>.mp3
   ffmpeg -hide_banner -nostats -i media/audio/<video_id>.mp3 -af ebur128=peak=true:dualmono=true -f null - 2>&1 | tail -n 12
   ```

Listen to the first export on a phone speaker and on earbuds before exporting the rest. The copyright line starts with the year, as the MP3 tag requires; players add "Copyright ©" themselves.

### Uploading a video to YouTube

Use the settings in `SPEC.md` §19.2: upload as Unlisted, check on the site that its plain "English" captions show, then switch it to Public once Public is confirmed (`SPEC.md` §21; until then keep it Unlisted); comments off, not made for kids, embedding allowed. The description follows this template. Replace each `[...]`: `[page]` is where the video appears on the site (`problems/<slug>` for a problem's video or a solution, picking the closest problem if it is on several, or `start` for an intro video).

```text
[One or two sentences on what this video covers.]

Find its handout (the full text of the video) and audio-only version on our website: https://[domain]/[page]/

This video gives general information about sleep. It is not medical advice and does not replace advice from your doctor or treating team.

If you need help now, [the contacts on Getting urgent help, once confirmed]. More: https://[domain]/urgent-help/

© 2026 SleepSteps Trial Research Team. This video is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), except the SleepSteps name and logo and any third-party material marked as such. Suggested credit: "[Video title]" by the SleepSteps Trial Research Team, CC BY 4.0.

Comments are turned off. You can send feedback on our website.
```

### Adding a video to a problem

There are three kinds of video (`SPEC.md` §7.1): each problem's own video (`<slug>-about`), the eight mechanism videos that problems share as solutions (`sleep-drive`, `circadian-rhythm`, `conditioning`, `cognitive-arousal`, `physiological-arousal`, `sleep-effort-and-control`, `treatment-symptoms-and-sleep` and `daytime-rhythms-and-sleep`), and the intro videos on Start here.

In `content/problems/<slug>.md`, refer to videos by `video_id`:

```yaml
problem_video: tired-but-wired-about    # the video about the problem itself
is_this_you:
  summary: "One or two plain sentences."
  bullets:                              # 2 to 4
    - "feel exhausted but alert in bed"
    - "take a long time to fall asleep"
solutions:                              # 1-3 main, then 0-3 extra, in display order
  - tier: main
    video: conditioning
    blurb: "Try this if bed has become a place where you lie awake."
  - tier: extra
    video: sleep-effort-and-control
    blurb: "Try this if trying hard to fall asleep keeps you awake."
related:                                # 2-3 other problems, by file name
  - not-sleepy-at-bedtime
  - stress-and-worries
```

The solutions follow the team's planning sheet (`SPEC.md` §7.2): its 1s are the main solutions, with the suggested start first, and its 2s are the extras.

A **stand-alone problem** has one video made for it instead of mechanism videos. Its file has `standalone: true` and no `solutions`; its `problem_video` is that video, and the page shows it with "Is this you?" and no solution cards. The build stops if a stand-alone problem lists solutions, or if any other problem has none.

```yaml
problem_video: sharing-a-bed-about      # the video made for this problem
standalone: true
```

A video can appear on several pages, but only once on each page. Leave the lines above `problem_video` (title, statement, area and so on) as they are unless the wording changes.

### Start here

The intro videos are `chapters` in `content/start.md`, in order, each with a `video` (a `video_id`) and a one-line `description`. Titles and durations come from the video files.

### Other content

- **Home page** wording (the hero, the format tiles' line and the trial text): the front matter at the top of `content/index.njk`. The hero photo goes in `src/img/`, named in `hero.photo`.
- **Footer** wording: `footer` in `site.config.json` (`SPEC.md` §11). `tagline` is the line under the name; `acknowledgement` is the Acknowledgement of Country; `trialRegistration` and `ethicsApproval` share a line (leave one empty, `""`, to hide it); `licenceExceptions` is the end of the licence sentence, after "Content is licensed under CC BY 4.0,", with no full stop (the site adds it). The words "Content is licensed under CC BY 4.0" and their link stay in `src/_includes/partials/site-footer.njk`, so the footer always names the licence. This file is JSON: keep the double quotes and the commas between lines, or the build stops.
- **Problem areas:** `data/areas.csv` (edit in Excel, save as CSV UTF-8).
- **The team** on About ("Who we are"): `data/team.csv` (edit in Excel, save as CSV UTF-8). One row per person, in any order: `name`, `role` and an optional `organisation`. The page lists people by last name, taken as the last word of `name`. The build stops if a row has no name or role.
- **Search keywords:** `data/keywords.csv` (edit in Excel, save as CSV UTF-8). One row per page: `page_id` is a problem's file name (without `.md`), `start`, or an information page's file name; `keywords` lists the words people might type, separated by `;`, including misspellings and US spellings. The site search and the filter on the Sleep problems page both use them. The build stops on an unknown or repeated `page_id`, and lists pages with no keywords. `npm test` checks that example searches (`test/node/search-queries.test.js`) still find the right page, so add a case there when you add keywords for something new. An information page with `search: false` in its front matter is left out of the search.
- **Star ratings** under each video: on or off with `ratings` in `features` in `site.config.json` (`true` or `false`, without quotes; with it off there are no stars and no note on Home). The question ("Was this helpful?") and the star names are in `src/_includes/partials/rating.njk`; there is no line under the stars (`SPEC.md` §15.1). The row under each video (Audio only, Handout, the stars) is in `src/_includes/partials/video-controls.njk`. The message after a rating ("Thanks. You rated this 4 of 5.") is in `src/js/rating.js`, and the failure message in `src/js/api.js`. `rating.njk` also holds hidden copies of the two longest messages, which keep room for them, so change them together. Home's "Rate each video to help us improve" is in `content/index.njk`; like the stars, it shows only when JavaScript runs. The tests check all of this wording word for word, so a change also needs the tests updated, or the build stops; ask a developer (or Claude) to make it.
- **Information pages:** `content/pages/*.md`. The front matter they take is described at the top of `src/_includes/layouts/info.njk`.
- **The YouTube note** at the end of each page with a video ("Pressing play on a video loads it from YouTube …"): `src/_includes/notices/video.njk` (draft wording for the privacy officer, `SPEC.md` §15.1). The tests check it word for word, so ask a developer (or Claude) to change it.
- **Feedback** ("Send feedback" in the footer, which opens a dialog): on or off with `feedback` in `features` in `site.config.json` (`true` or `false`, without quotes; with it off there is no "Send feedback"). The notice in the dialog is in `src/_includes/notices/feedback.njk` (draft wording for the privacy officer, `SPEC.md` §15.1), the heading, label and hint in `src/_includes/partials/feedback-dialog.njk`, the dialog's messages in `MESSAGES` in `src/js/feedback.js`, and the failure message in `src/js/api.js`. The tests check this wording word for word, so ask a developer (or Claude) to change it. `turnstileSiteKey` in `site.config.json` is the spam check's public site key: a person creates it in Cloudflare (`SPEC.md` §18.4 step 5), and until then it stays `"<PUBLIC_SITE_KEY>"`.
- **Crisis numbers** on Getting urgent help: `crisisContacts` in `site.config.json`. The smaller cards under them (your treating team, Cancer Council) are `other_contacts` in `content/pages/urgent-help.md`; a card becomes a phone link once its `value` is a real number (only its number, if the card also links to a website). A card there, or a service card on Get more help (`services` in `content/pages/help.md`), can link to the service's website with `url` and `link_text`, but only to a site on the allowed list in `SPEC.md` §16.1 (a new site is added there and to `OUTBOUND_HOSTS` in `test/node/build-output.test.js`).

## Tests

`npm test` runs two Vitest projects: `worker` (the Worker, inside the Workers runtime, each test file with an empty database of its own that the migrations are applied to) and `node` (the CSV parser, content data, checks on a fresh build of the whole site, and the browser modules run on that build in a small test DOM, `test/node/mini-dom.js`). `npm test -- --project node` runs one of them. Before either runs, `test/global-setup.js` builds the site into a temporary directory; that build also writes `worker/generated/pages.json`, the list of pages and their videos the Worker checks events, ratings and feedback against (`SPEC.md` §8.3). The tests never contact Cloudflare: the Worker tests stand in for Turnstile's Siteverify, and the browser-module tests for its script.

## Deployment

Cloudflare Workers Builds deploys the site from GitHub (`SPEC.md` §18.3):

- **Merging to `main`** runs `npm test && npm run build` and deploys production. Until launch, production is at `sleepsteps.behavioural-medicine-lab.workers.dev`, marked `noindex` so search engines leave it out.
- **Other branches** each get a preview at `<branch>-sleepsteps.behavioural-medicine-lab.workers.dev`. All previews share one database, `sleepsteps-preview`, separate from production's, for test data only.
- **Data collection is off** (`DATA_COLLECTION` in `wrangler.jsonc`): in production until the privacy officer's go-ahead, and in previews until they are behind Cloudflare Access (`SPEC.md` §11, §21). Pages still send usage statistics, and the API answers them with 404 and stores nothing; the stars under each video show, and say "Couldn't send right now — please try again later" when used. The feedback dialog shows too. In production, until a person has created the Turnstile widget and its site key is in `site.config.json`, it has no box to write in: it says the spam check isn't working, points to the Contact page and offers Close; after that it says "Couldn't send right now…" until the go-ahead. Previews always use Cloudflare's test key (`SPEC.md` §11, §13). The API also answers only on the hosts in `API_HOSTS`: none in production until launch, and every preview URL in previews (`SPEC.md` §14.1).
- **Database changes** are new files in `migrations/`, never edits to an applied one; the first, `0001_init.sql`, creates the `ratings`, `feedback` and `events` tables (`SPEC.md` §17). `npm run db:migrate:local` applies them locally. A team member with Cloudflare access applies them to the preview and production databases (`npm run db:migrate:preview`, `npm run db:migrate:remote`). This is needed only before data collection is turned on there; after that, each new migration is applied to production just before its pull request merges (`SPEC.md` §17, §18.4).

## Licence

- **Content** (page text, transcripts, data files, handouts, audio and thumbnails): [CC BY 4.0](LICENSE-CONTENT.md). Our name and logo, and third-party material, are not covered.
- **Code:** [MIT](LICENSE).
