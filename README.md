# sleepsteps-web

Website for a clinical trial of a stepped-care sleep intervention. It is a static site (Eleventy) plus a single Cloudflare Worker and a D1 database for optional anonymous ratings, feedback and usage events.

`SPEC.md` is the source of truth for how the site works and how it is built. The visual design handoff is in `docs/design/`.

## Quick start

Requires Node 22.13 or later (`npm test` and the accessibility check use Node's built-in `node:sqlite`, which needs no flag from 22.13). Cloudflare builds with the Node version in `.node-version` (24.22.1) and the npm version in `package.json`'s `packageManager`.

```sh
npm install
npm run build   # build the site into dist/
npm run dev     # local site + Worker at http://localhost:8787
npm test        # run tests
npm run db:migrate:local && npm run dev:collect   # the same, storing usage statistics, ratings and feedback locally (below)
npm run test:features   # the tests and the build with every combination of the feature switches (Tests, below)
npm run test:a11y       # the accessibility check in Google Chrome, on a Mac (below)
```

`npm run dev` passes extra flags to `wrangler dev`, e.g. `npm run dev -- --port 8799`.

### Usage statistics, ratings and feedback locally

`npm run dev` keeps data collection off, as previews do: pages still send their usage statistics, and the API answers 404 and stores nothing (`SPEC.md` §11). The stars under each video show, but a rating gets "Couldn't send right now — please try again later", and so does the feedback dialog ("Send feedback" in the footer). To try the statistics, ratings and feedback end to end against a local database:

```sh
npm run db:migrate:local   # once, and again after each new file in migrations/
npm run dev:collect        # like npm run dev, with collection on for this run
```

Open http://localhost:8787 (the API answers only on port 8787, at `localhost` or `127.0.0.1`). Open a sleep problem page, play an audio-only version, open a handout, rate a video or search, then look at what was stored (every time is rounded down to the hour, so rows from the same hour share a `ts`; these queries list the newest first by id):

```sh
npx wrangler d1 execute sleepsteps --local --command "SELECT ts, session_id, page, type, detail FROM events ORDER BY id DESC LIMIT 20"
npx wrangler d1 execute sleepsteps --local --command "SELECT ts, page, video, stars FROM ratings ORDER BY id DESC LIMIT 20"
```

A star clicked or tapped is sent at once; a star reached with the arrow keys is sent after a 2-second pause, when focus leaves the stars, or on Enter (`SPEC.md` §12).

**Feedback and its spam check.** The feedback dialog uses Cloudflare Turnstile, which needs no Cloudflare account locally: on `localhost` and `127.0.0.1` the dialog uses Cloudflare's published always-pass test site key, `1x00000000000000000000AA`, and `dev:collect` gives the Worker the matching test secret, `1x0000000000000000000000000000000AA`, with `--var` (`SPEC.md` §13, §14.3). The widget then says "For testing only. If seen, report to site owner"; that is expected. The dialog still loads Turnstile's script from `challenges.cloudflare.com` the first time it opens, so you need to be online. Send a message, from the footer's "Send feedback" or from a video's "Feedback" button, then check what was stored, without printing the message itself (`video` is empty for a message sent from the footer; if the command says there is no such column, run `npm run db:migrate:local` first):

```sh
npx wrangler d1 execute sleepsteps --local --command "SELECT ts, page, video, length(message) FROM feedback ORDER BY id DESC LIMIT 20"
```

Only the page id, and the video's id when the message was sent from a video's "Feedback" button, are stored with the message (the admin page shows the page's current title), and the time is rounded down to the hour, as it is for every row. To see a check that fails, run the Worker with one of Cloudflare's other test secrets instead (`npm run build` first): `2x0000000000000000000000000000000AA` always fails, and `3x0000000000000000000000000000000AA` answers as if the token had already been used. Either way the dialog says "Couldn't send right now — please try again later" and keeps the text.

```sh
npx wrangler dev --var DATA_COLLECTION:on --var API_HOSTS:localhost:8787,127.0.0.1:8787 --var TURNSTILE_SECRET:2x0000000000000000000000000000000AA
```

Keep `--local` (Wrangler's default, written out so the command says what it does) and never use `--remote`, which reaches the real database. Never put `DATA_COLLECTION` or `API_HOSTS` in `.dev.vars`; `dev:collect` passes them on the command line for that run only, and the tests check this. `.dev.vars` may hold a `TURNSTILE_SECRET` line, but only with one of Cloudflare's three test secrets above (the tests check that too); the real secret lives only in Cloudflare (`SPEC.md` §18.4). The "Turn off usage statistics" switch on the privacy page works in this mode too.

## Content editing

Everything below can be edited in GitHub's web editor. Every build starts with a content check (`node scripts/validate-content.js` runs it on its own): if something is wrong, the build stops and names the file and field. The full rules are in `SPEC.md` §7.

Text in `[square brackets]` is a placeholder for the team to replace.

In page text, don't lean on the name "SleepSteps" (one word): call it "this program" and the team "we" or "us" by default, and name it only in a few places, such as About (`SPEC.md` §7.5). File names, storage keys and other technical names keep `sleepsteps`.

### Videos

All the videos are in one spreadsheet, `data/videos.csv`: one row per video. Edit it in Excel and save it as **CSV UTF-8 (Comma delimited)**, as with the other files in `data/`. A video has no page of its own; problem pages and Start here show it, with everything on its row (`SPEC.md` §7.1). The columns, in this order:

| Column | What goes in it |
|---|---|
| `video_id` | The video's permanent name: lowercase words joined by hyphens, such as `sleep-drive`. Problems, Start here, ratings and usage records use it, so **never change it** once the video is on the site. |
| `title` | The video's title. |
| `description` | One or two sentences about the video, shown with it. A line break inside the cell is fine. |
| `youtube_url` | The link to the video on YouTube: the link from YouTube's Share button (`https://youtu.be/…`), the watch page (`https://www.youtube.com/watch?v=…`) or an embed link (`https://www.youtube.com/embed/…`). Leave it blank until the video is on YouTube. |
| `duration` | The video's length, minutes:seconds, such as `6:40` (`[mm:ss]` until it's known). Format this column as Text in Excel, or Excel may turn `6:40` into a time (`6:40:00`), which the build refuses. |
| `audio` | The audio-only version: a file name in `media/audio/` (25 MiB at most). |
| `handout` | The handout: a file name in `media/pdf/`. |
| `thumbnail` | Optional: a picture for the video's frame, a file name in `media/thumbs/`. Leave it blank for the plain frame. |

A real video's row, as the file holds it (Excel adds the quotes around a cell with a comma when it saves, so just type the text):

```csv
video_id,title,description,youtube_url,duration,audio,handout,thumbnail
sleep-drive,Sleep drive,"Why time awake builds the pressure to sleep, and how to use it.",https://youtu.be/AbCdEfGhIjK,6:40,sleep-drive.mp3,sleep-drive.pdf,
```

Every column but `youtube_url` and `thumbnail` needs something in it. The build checks every row and stops, naming the row as Excel numbers it (the header is row 1), on a missing cell, an unknown or repeated `video_id`, a link that isn't a YouTube video link, two rows linking to the same YouTube video, a duration that isn't minutes:seconds or a file that isn't in `media/`. A file name must match the file exactly, capitals included (`Sleep-Drive.mp3` is not `sleep-drive.mp3`: a Mac doesn't mind, but the website's host does), and the message suggests the right name. The build also stops if the file was saved as plain "CSV" instead of "CSV UTF-8", which spoils curly quotes and accented letters, and on text that was garbled by opening the file in the wrong encoding (`â€œ` where a `“` was): undo, open the file through Excel's Data > From Text/CSV with "65001: Unicode (UTF-8)", and save it as CSV UTF-8 again. The file starts with an invisible UTF-8 marker (a byte-order mark) so that Excel opens it as UTF-8 when you double-click it; Excel's "CSV UTF-8" save keeps it. If a column to the right of the table was ever used, Excel may save an extra column with no name: the build names it ("Column I has no name"), so delete that column in Excel.

The rows can be in any order; the pages follow the problem files and `content/start.md`, not the spreadsheet. To use a video on a page, name its `video_id` there (below).

**Every video looks the same** wherever it is (the problem's own video, an open solution card, a Start here chapter): its label where it has one ("1 Main", "2 Extra" on a solution, "1 of 2" on Start here), its title and description, the video, then one row: "Audio only", "Handout" and "Was this helpful?" with its stars. A closed solution card shows its label, length, title and description (on a phone, its number, title and description). An open solution card adds the video's worksheets under that row, where it has some ("Worksheets", below). All of it comes from the video's row (a solution's `blurb` can replace the description, below); the layout is one template, `src/_includes/partials/video-block.njk`, and a test checks that every video on the site matches it (`SPEC.md` §7.5).

**The handout carries the narration.** There are no transcripts on the site: the handout is each video's text version (the text alternative for people who can't hear the audio), so it has the video's full narration, word for word, naming the speakers, plus anything that matters on screen. The "Handout" button under each video links to it. Make it accessible: for a PDF, export it from Word as a tagged PDF and check it (`SPEC.md` §9.3). The handout's format (PDF, Word or a web page) is still being decided; until then it is a PDF.

**Transcripts are optional.** A video's transcript is a plain-text file, `data/transcripts/<video_id>.txt` (such as `data/transcripts/sleep-drive.txt`), saved as plain text in UTF-8 (in Word: Save As, Plain Text, then the Unicode (UTF-8) encoding). It is never shown, but the site search indexes it, so a search for words in it finds the video's pages, and it can be the source for the YouTube captions. The build stops on a transcript whose name isn't a `video_id` in `data/videos.csv`, on text that isn't UTF-8 or was garbled by opening the file in the wrong encoding, and on a real video's transcript that is only `[bracketed]` placeholder text. There are none yet, so the `data/transcripts/` folder is created with the first one.

**Placeholder videos.** Until a video is on YouTube, its row has a blank `youtube_url`, `[mm:ss]` as its duration, a `[bracketed]` title and description, and the shared stand-in files `placeholder-audio.mp3` (in `media/audio/`, two seconds of silence) and `placeholder-handout.pdf` (in `media/pdf/`, a one-page PDF) in its `audio` and `handout` columns; the page shows "[Video coming soon]" in place of the video, and "Audio only" and "Handout" open the stand-ins. Every video is a placeholder for now. Keep the two stand-in files while any row names them.

**Replacing a placeholder with the real video** (`SPEC.md` §19.2 has the YouTube settings):

1. Put the video's audio-only MP3 in `media/audio/` and its handout in `media/pdf/`, named after its `video_id` (`sleep-drive.mp3`, `sleep-drive.pdf`).
2. In its row of `data/videos.csv`, keep the `video_id` as it is, and put in:
   - `youtube_url`: the link from YouTube's Share button;
   - `duration`: its length as minutes:seconds, in place of `[mm:ss]`;
   - `audio` and `handout`: its own file names, in place of the stand-ins;
   - the real `title` and `description`, in place of the bracketed ones (the build doesn't check these, so look over the row);
   - a `thumbnail`, if it has one.
3. Save as CSV UTF-8 and commit. Every page with the video picks up the change; nothing else needs editing.

The build stops if a video with a link still has a `[mm:ss]` duration or one of the stand-in files, or shares its audio or handout with another video. It lists the placeholders that are left; there must be none at launch (`node scripts/validate-content.js --no-placeholders` checks).

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
    video: sleep-effort-and-control     # no blurb: the card shows the video's description
related:                                # 2-3 other problems, by file name
  - not-sleepy-at-bedtime
  - stress-and-worries
```

The solutions follow the team's planning sheet (`SPEC.md` §7.2): its 1s are the main solutions, with the suggested start first, and its 2s are the extras. A solution's card shows the video's description from `data/videos.csv`; a `blurb` (optional) replaces it on this problem only, to say why the video suits this problem.

A **stand-alone problem** has one video made for it instead of mechanism videos. Its file has `standalone: true` and no `solutions`; its `problem_video` is that video, and the page shows it with "Is this you?" and no solution cards. The build stops if a stand-alone problem lists solutions, or if any other problem has none.

```yaml
problem_video: sharing-a-bed-about      # the video made for this problem
standalone: true
```

A video can appear on several pages, but only once on each page. Leave the lines above `problem_video` (title, statement, area and so on) as they are unless the wording changes.

### Worksheets

A solution video can have worksheets: one, a few, or none. They show in a "Worksheets" section at the bottom of the video's open solution card, under "Audio only", "Handout", "Feedback" and the stars, as download buttons. A worksheet belongs to its **video**, so the same worksheets show on every problem page where that video is a solution; you list them once. Only solution videos show worksheets: a problem's own video and the Start here videos don't (`SPEC.md` §7.6).

All the worksheets are in one spreadsheet, `data/worksheets.csv`: one row per worksheet. Edit it in Excel and save it as **CSV UTF-8 (Comma delimited)**, like `data/videos.csv`. The columns, in this order:

| Column | What goes in it |
|---|---|
| `worksheet_id` | The worksheet's permanent name: lowercase words joined by hyphens, such as `sleep-drive-worksheet-1`. Each row has its own. **Never change it** once the worksheet is on the site. |
| `video_id` | The video it goes with: a `video_id` from `data/videos.csv`. |
| `title` | The words on the worksheet's button. |
| `file` | The worksheet's file: a PDF's file name in `media/worksheets/` (25 MiB at most). |

```csv
worksheet_id,video_id,title,file
sleep-drive-worksheet-1,sleep-drive,Planning your time in bed,sleep-drive-time-in-bed.pdf
sleep-drive-worksheet-2,sleep-drive,Sleep diary,sleep-diary.pdf
```

To add a worksheet, put its PDF in `media/worksheets/` and add a row. A video's worksheets show in the order of their rows. For a video with several, add a row for each; for one worksheet that goes with two videos, add two rows that name the same file. To remove one, delete its row. Nothing changes in the problem files.

The build checks every row and stops, naming the row as Excel numbers it, on a missing cell, a `worksheet_id` used twice, a `video_id` that isn't in `data/videos.csv`, or a file that isn't a PDF in `media/worksheets/` (the name must match exactly, capitals included, as for the videos' files). It only warns, without stopping, about a worksheet whose video isn't a solution on any problem (nobody would see it) and about a solution video with no worksheet.

**Placeholder worksheets.** For now the eight solution videos have sample rows with `[bracketed]` titles, which all name the stand-in file `placeholder-worksheet.pdf`. Replace each with a real one by changing its `title` and `file` (keep its `worksheet_id`), and delete the sample rows a video doesn't need. Once a video has its YouTube link, the build stops if one of its worksheets still names the stand-in, and there must be none at launch (`node scripts/validate-content.js --no-placeholders` checks). The worksheets are PDFs for now; whether another format would suit worksheets people fill in is still being decided (`SPEC.md` §21). Make a PDF accessible as you would a handout (`SPEC.md` §9.3).

### Start here

The intro videos are `chapters` in `content/start.md`, in order, each a `video` (a `video_id`). There are two: `sleep-and-cancer` (how sleep works and why cancer can change it) and `how-to-use-this-program`. Their titles, descriptions and durations come from their rows in `data/videos.csv`, so change an intro video's description there: a chapter has only its `video`, and the build stops on a `description` line in `content/start.md`. The labels "1 of 2" and "2 of 2" are counted for you, but the `summary` line in `content/start.md` ("Two short videos everyone watches first…") is typed by hand, so change its number if you add or remove an intro video.

### Other content

- **Home page** wording (the hero, the heading and line over the list of sleep problems, and the trial text): the front matter at the top of `content/index.njk`. The hero photo goes in `src/img/`, named in `hero.photo`. The home page is also where the sleep problems are listed, by area, with a box that narrows the list as you type; the list builds itself from the problem files and `data/areas.csv`. There is no separate Sleep problems page any more: its old address, `/problems/`, goes to the home page (`src/_redirects`), and each problem keeps its own address, `/problems/<file name>/`.
- **Footer** wording: `footer` in `site.config.json` (`SPEC.md` §11). `tagline` is the line under the name; `acknowledgement` is the Acknowledgement of Country; `trialRegistration` and `ethicsApproval` share a line (leave one empty, `""`, to hide it); `licenceExceptions` is the end of the licence sentence, after "Content is licensed under CC BY 4.0,", with no full stop (the site adds it). The words "Content is licensed under CC BY 4.0" and their link stay in `src/_includes/partials/site-footer.njk`, so the footer always names the licence. This file is JSON: keep the double quotes and the commas between lines, or the build stops.
- **Problem areas:** `data/areas.csv` (edit in Excel, save as CSV UTF-8).
- **The team** on About ("Who we are"): `data/team.csv` (edit in Excel, save as CSV UTF-8). One row per person, in any order: `name`, `role` and an optional `organisation`. The page lists people by last name, taken as the last word of `name`. The build stops if a row has no name or role, or has text garbled by opening the file in the wrong encoding (as for `data/videos.csv`, above).
- **Search keywords:** `data/keywords.csv` (edit in Excel, save as CSV UTF-8). One row per page: `page_id` is a problem's file name (without `.md`), `start`, or an information page's file name; `keywords` lists the words people might type, separated by `;`, including misspellings and US spellings. The site search and the filter over the list of sleep problems on the home page both use them. The build stops on an unknown or repeated `page_id`, and on text garbled by opening the file in the wrong encoding (as for `data/videos.csv`, above), and lists pages with no keywords. `npm test` checks that example searches (`test/node/search-queries.test.js`) still find the right page, so add a case there when you add keywords for something new. An information page with `search: false` in its front matter is left out of the search.
- **Star ratings** under each video: on or off with `ratings` in `features` in `site.config.json` (`true` or `false`, without quotes; with it off there are no stars). The question ("Was this helpful?") and the star names are in `src/_includes/partials/rating.njk`; there is no line under the stars (`SPEC.md` §15.1). The row under each video (Audio only, Handout, the stars) is in the video template, `src/_includes/partials/video-block.njk`. The message after a rating ("Thanks. You rated this 4 of 5.") is in `src/js/rating.js`, and the failure message in `src/js/api.js`. `rating.njk` also holds hidden copies of the two longest messages, which keep room for them, so change them together. The tests check all of this wording word for word, so a change also needs the tests updated, or the build stops; ask a developer (or Claude) to make it.
- **Information pages:** `content/pages/*.md`. The front matter they take is described at the top of `src/_includes/layouts/info.njk`.
- **The YouTube note** at the end of each page with a video ("Pressing play on a video loads it from YouTube …"): `src/_includes/notices/video.njk` (draft wording for the privacy officer, `SPEC.md` §15.1). The tests check it word for word, so ask a developer (or Claude) to change it.
- **Feedback** ("Send feedback" in the footer, which opens a dialog, and a "Feedback" button under each video, which opens the same dialog about that video): on or off with `feedback` in `features` in `site.config.json` (`true` or `false`, without quotes; with it off there is no "Send feedback" and no "Feedback" button). The button is in the video template, `src/_includes/partials/video-block.njk`, and shows only when JavaScript runs. The notice in the dialog is in `src/_includes/notices/feedback.njk` (draft wording for the privacy officer, `SPEC.md` §15.1), the heading, label and hint in `src/_includes/partials/feedback-dialog.njk`, the dialog's messages in `MESSAGES` in `src/js/feedback.js`, and the failure message in `src/js/api.js`. The tests check this wording word for word, so ask a developer (or Claude) to change it. `turnstileSiteKey` in `site.config.json` is the spam check's public site key, from the Turnstile widget a person created in Cloudflare for `sleepsteps.org` on 2026-11-10 (`SPEC.md` §18.4 step 5). Only that domain can use it: `localhost`, `127.0.0.1`, previews and version URLs use Cloudflare's test key instead, and `npm run test:a11y` and `npm run a11y:serve` serve pages with the `"<PUBLIC_SITE_KEY>"` placeholder, so other local addresses show the form's "spam check isn't working" state.
- **Crisis numbers** on Getting urgent help: `crisisContacts` in `site.config.json`. The smaller cards under them (your treating team, Cancer Council) are `other_contacts` in `content/pages/urgent-help.md`; a card becomes a phone link once its `value` is a real number (only its number, if the card also links to a website). A card there, or a service card on Referral info (`services` in `content/pages/help.md`), can link to the service's website with `url` and `link_text`, but only to a site on the allowed list in `SPEC.md` §16.1 (a new site is added there and to `OUTBOUND_HOSTS` in `test/node/build-output.test.js`).

## Tests

`npm test` runs two Vitest projects: `worker` (the Worker, inside the Workers runtime, each test file with an empty database of its own that the migrations are applied to) and `node` (the CSV parser, content data, checks on a fresh build of the whole site, and the browser modules run on that build in a small test DOM, `test/node/mini-dom.js`). `npm test -- --project node` runs one of them. Before either runs, `test/global-setup.js` builds the site into a temporary directory; that build also writes `worker/generated/pages.json`, the list of pages and their videos the Worker checks events, ratings and feedback against (`SPEC.md` §8.3). The tests never contact Cloudflare: the Worker tests stand in for Turnstile's Siteverify, and the browser-module tests for its script. The admin tests sign their own Access tokens with throwaway keys and stand in for Access's key list.

The setup also builds the site with every combination of the three feature switches (ratings, feedback, usage statistics) through `test/features.config.js`, a test-only config that never writes `pages.json`. The widget tests run on the build with all three on, and `test/node/features-off.test.js` checks each combination's pages, so turning a feature off in `site.config.json` skips none of the checks and `npm test` still passes (`SPEC.md` §11). `npm run test:features` goes further: for each combination it runs `npm test` and `npm run build` in a temporary copy of the repo with `site.config.json` set that way, and fails unless every run has the same tests as all on. It takes about 25 seconds and changes nothing in the repo.

## Security headers and browser checks

### Security headers

Static pages, scripts, styles and media get their headers from one rule, `/*`, in `src/_headers`: the Content Security Policy (enforced), `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy` and `Strict-Transport-Security`. The API and the admin pages set their own in the Worker (`worker/lib/http.js`, `worker/routes/admin.js`). `SPEC.md` §16.1 explains each value, and `test/node/deploy-config.test.js` pins them.

- Set each header in one rule only. Cloudflare joins a header that two rules set with a comma, which for the policy means two policies, both enforced. A rule for one path that needs a different value goes after `/*` and starts with `! <Header>`.
- A new third-party script or frame needs its host in the policy and in `SPEC.md` §16.2; the deploy-config test fails if the code loads a host the policy doesn't allow. Inline scripts, inline styles and `style="…"` are blocked, and the build tests forbid them.
- Never use `no-referrer` anywhere: embedded videos stop playing and the API refuses the pages' requests.
- Cloudflare adds Network Error Logging headers (`nel`, `report-to`) of its own to production's responses. The site discloses them on the privacy page rather than overriding them (`SPEC.md` §15.4, §16.1).

To look for problems by hand, run `npm run dev` and open http://localhost:8787 (not another host name: Chrome logs an error about `Cross-Origin-Opener-Policy` on plain-`http` hosts other than `localhost`, `127.0.0.1` and `*.localhost`). In the developer tools' Console, with every level shown, there should be no "Content Security Policy" message. These don't count (`SPEC.md` §20 M7): the API's 404s while data collection is off, a missing page's own 404, and messages inside YouTube's and Cloudflare's frames, or warnings from their scripts in our page (for example a `postMessage` warning from Turnstile's `api.js` or YouTube's widget API).

### The accessibility check (`npm run test:a11y`)

`npm run test:a11y` builds the site, serves it locally under the real headers (and the admin pages through the real Worker code with sample data and a throwaway sign-in), and drives Google Chrome to check it with axe-core:

- every page, and the main states (menus, groups, the filter, an open solution card with its worksheets, a rating sent or failed, search results, none and failed, the statistics switch, the feedback dialog's states, pages without JavaScript, the admin summary, error and download pages), at 320 and 1280px wide;
- at 320px with WCAG 1.4.12's wider text spacing, every page and the open phone menu, solution card and feedback dialog and the admin summary and download pages, where nothing may scroll sideways or be cut off by a box that clips (text that overlaps other content without being clipped still needs a person's eye);
- a keyboard walk of each page type, the phone menu, a solution card and the feedback dialog: every stop shows a 2px ring, is at least 44px, and comes fully on screen, Tab and Shift+Tab give the same order, and nothing traps focus;
- in every state, the site's own errors: Content Security Policy violations, script errors, console messages from our scripts and failed requests to the site.

It fails on any of those, and lists for a person to check what axe couldn't decide, other sites' console messages and warnings in our page (for example from Turnstile's `api.js`), failed requests to other sites and failures caused on purpose. It doesn't capture messages inside YouTube's or Cloudflare's frames (Turnstile's frame logs errors on every render, `SPEC.md` §13). Those don't count (`SPEC.md` §20 M7), and only a person's own browser check sees them. It runs on a Mac with Google Chrome installed (set `CHROME_PATH` to use another Chrome or Chromium); without Chrome it stops and says so. It needs the internet only for Turnstile's test widget, and takes about four minutes with the build. A check that needs a feature that is switched off is skipped, and the output says so. `npm run test:a11y -- --only <pattern>` runs the checks whose names match, and `-- --report <file>` saves every result as JSON. It isn't part of `npm test` or Cloudflare's builds, which have no browser. Run it after changes to templates, CSS or browser scripts, and before launch. It doesn't replace people: one screen-reader session with VoiceOver and NVDA is planned before the site goes public (M8, `SPEC.md` §18.3, §18.4).

`npm run a11y:serve` builds the site and serves the same local copy without Chrome, until you press Ctrl+C: the site with data collection on, and the admin pages with sample data and a throwaway sign-in, at http://127.0.0.1:8790/ (it prints the admin addresses to open). Use it for checks a person makes, such as the screen-reader session, zoom, print preview and the admin download. `npm run a11y:serve -- --port 8791` picks another port, and `-- --host <address>` listens on one of the Mac's network addresses instead, so NVDA in a Windows virtual machine or on another computer can reach it (there the feedback dialog says the spam check isn't working, as on any host other than `localhost` or `127.0.0.1`). Nothing it stores outlasts the run.

### The site icons

`src/favicon.svg`, `src/favicon.ico` and `src/apple-touch-icon.png` are the only copies of the site icons. The build copies them to the site root, and every page and the admin pages link them. To change an icon, replace the file in `src/`, keeping the SVG to presentation attributes (no `<style>`, `style="…"`, script or link; a build test checks this, `SPEC.md` §7.5).

## Deployment

Cloudflare Workers Builds deploys the site from GitHub (`SPEC.md` §18.3):

- **Merging to `main`** runs `npm test && npm run build` and deploys production. Production is at `sleepsteps.org`, its only address since 2026-11-10, behind Cloudflare Access until launch (below). Merging a change to `src/_headers` changes production's security headers, so a person checks the pull request's preview in Chrome, Firefox and Safari first (`SPEC.md` §18.4).
- **Other branches** each get a preview at `<branch>-sleepsteps.behavioural-medicine-lab.workers.dev`. All previews share one database, `sleepsteps-preview`, separate from production's, for test data only.
- **Before launch, the whole site is behind Cloudflare Access** (since 2026-11-09): every address, `sleepsteps.org` and preview links included, asks for a university email and a one-time PIN. On `sleepsteps.org` only the "data access" list gets in (`SPEC.md` §18.3).
- **Data collection** (`DATA_COLLECTION` in `wrangler.jsonc`) is on in production since 2026-11-10, so the team can test ratings, feedback, statistics and the admin page on the live site. Those test rows are deleted before the site goes public, which waits for the privacy officer's go-ahead (`SPEC.md` §18.3). It is off in previews and in `npm run dev`: pages still send usage statistics, and the API answers them with 404 and stores nothing; the stars under each video say "Couldn't send right now — please try again later" when used, and so does the feedback dialog. In production the dialog uses the real spam check: its site key has been in `site.config.json`, and its secret in Cloudflare, since 2026-11-10. Previews always use Cloudflare's test key (`SPEC.md` §11, §13). The API also answers only on the hosts in `API_HOSTS`: `sleepsteps.org` in production, and every preview URL in previews (`SPEC.md` §14.1).
- **The admin page** (`/admin/`, below) answers only where Cloudflare Access is set up for it (`SPEC.md` §18.4 step 6), and says "Forbidden" elsewhere. On previews it shows the preview database's test data; on `sleepsteps.org`, production's.
- **Database changes** are new files in `migrations/`, never edits to an applied one; the first, `0001_init.sql`, creates the `ratings`, `feedback` and `events` tables, `0002_feedback_drop_page_title.sql` removes feedback's `page_title` column, and `0003_feedback_add_video.sql` adds feedback's `video` column, the video a message is about (`SPEC.md` §17). `npm run db:migrate:local` applies them locally. A team member with Cloudflare access applies them to the preview and production databases (`npm run db:migrate:preview`, `npm run db:migrate:remote`). This is needed only before data collection is turned on there, or the admin page is used there; after that, each new migration is applied to production just before its pull request merges, from a checkout of that pull request's branch, since `main` doesn't have the file yet (`SPEC.md` §17, §18.4).

## Admin page and data exports

The research team sees what the site has stored (ratings, feedback, searches and usage statistics) at `/admin/` on the live site (`sleepsteps.org`) and on preview links (`SPEC.md` §14.4). Access asks for your university email and sends you a one-time PIN. Only people on the "data access" list get into production's page; previews use a separate "preview reviewers" list, and their database holds test data only. Sign out with the link at the top of the page, which also shows which address you are on.

Where Access isn't set up for them (`SPEC.md` §18.4 step 6), the `/admin` addresses answer "Forbidden". The admin pages also answer only on the addresses the site's API answers on (`API_HOSTS`), never on production's version URLs. There is no way to open them locally with `npm run dev`: they need an Access sign-in, and the deployed Worker deliberately has no way to skip it. To look at them locally with sample data (for accessibility checks, print preview or a download), run `npm run a11y:serve` (above): its server, which is never deployed, signs itself in with a throwaway token.

**What the page shows,** for a date range (the last 30 days unless you choose; up to 92 days):

- page views and visits for each tracked page (the sleep problem pages, Start here and Getting urgent help), including pages nobody viewed;
- ratings per video, per page, and per page and video, with the mean (a changed rating counts as a new rating);
- how many searches found nothing, and the 20 most frequent of them, to help update `data/keywords.csv`;
- the 20 most recent feedback messages, and how many there were in the range;
- plays of each video and audio-only version, and how far people got;
- handout clicks;
- how many database rows the page read.

It shows exact counts, never row numbers or visit codes. Videos are shown by their `video_id`.

**Dates are UTC.** Every date on the page and in the files is a UTC calendar day, and both ends of a range are included. A UTC day runs from 10:00 on that date to 10:00 the next morning, Melbourne time (11:00 to 11:00 during daylight saving). Its figures include that evening and the early hours of the next day, but not the date's own early morning, which counts in the day before. Likewise, a month's file runs from 10 or 11 am on the 1st to the same time on the 1st of the next month, Melbourne time. Times are UTC too.

**The monthly export** (`SPEC.md` §19.1). Under "Download the data", use the four "Last month" links: ratings, feedback, usage events and searches. Each file covers one calendar month (UTC), so every row is in exactly one file. A month's files are ready from 00:00 UTC on the 1st of the next month (10:00 in Melbourne, 11:00 during daylight saving). Before then the "Last month" links still show the month before, and a range ending on the month's last day is refused as incomplete, so do this after 11:00 on the 1st or on any later day.

- A small file downloads at once. A larger one opens a page that fetches it in parts and saves one file: it needs JavaScript, and you keep the page open until it says the file is being saved.
- Start downloads from the admin page. A download link opened from another website (webmail included), or straight after signing in again, answers "Start the download from the admin page": open `/admin/` and choose it there. (A typed address or a bookmark works.) This stops another website from running downloads in your signed-in browser and using up the day's database reads.
- Save each file straight into the team's restricted folder, then delete it from Downloads. Never put exports in this repository or an email (the files are git-ignored as `sleepsteps-*.csv`, but don't rely on that). Feedback and searches come from anyone and can hold health or identifying details. The usage events file holds no free text, but it is still research data.
- One download covers at most 31 days and 100,000 rows, and complete days only, so it ends yesterday at the latest. If last month's usage events pass 100,000 rows (above about 3,200 a day), the link says so: choose half a month at a time with the date form, and use the "This range" links instead. A range longer than 31 days gets one set of links per month.

These limits protect the free plan's 5 million database rows read a day, which the whole Cloudflare account shares: once they run out, every database query fails until 00:00 UTC (10 or 11 am in Melbourne), visitors' ratings and feedback included. If the page's footer says it read more than a tenth of a day's allowance, choose shorter ranges and tell the developer.

**Reading the files:**

- Each file has one header row, then one row per stored row. Times are ISO 8601 UTC, rounded down to the hour (`2026-10-31T13:00:00.000Z` means between 13:00 and 14:00 UTC): the site stores no exact times, so the files don't show when within the hour anything happened, or the order of usage events and searches within an hour. Ratings and feedback ids do run in the order the rows were stored, so within one table they show which came first (see below).
- Every text cell is in double quotes, the header row's too; numbers are bare; an empty field means no value.
- A text cell that started with `=`, `+`, `-`, `@`, `'`, a tab or a line break (or a full-width `＝`, `＋`, `－` or `＠`) has an extra `'` in front, so spreadsheets show it as text instead of running it as a formula. Remove one leading `'` to get the stored text. Excel may drop this protection if you save the file from Excel and open it again, so keep the downloaded file as it is and work on a copy.
- The files start with a byte-order mark, so Excel opens them as UTF-8 by double-click. In R use `readr::read_csv()`, or `read.csv(…, fileEncoding = "UTF-8-BOM")`; in Python, `pandas.read_csv(…, encoding="utf-8-sig")`.
- The columns:
  - ratings: `id, ts, page, video, stars`;
  - feedback: `id, ts, page, video, message` (`page` is a page id; the summary page shows each page's current title; `video` is the `video_id` of the video a message is about when it was sent from that video's "Feedback" button, and empty otherwise);
  - usage events: `ts, session_id, page, type, media, furthest` (`media` is a `video_id`; `furthest` is 0, 25, 50, 75 or 100 for plays, and empty otherwise);
  - searches: `ts, q, results`.
- A ratings or feedback `id` is unique within its table, so it finds duplicates across files and a row to delete (a deleted row's id can be reused). Usage events and searches have no id, on purpose: ids run in order, so a search's id would link it to the visit it came from. Rows are in a fixed order: usage events by type, then hour, page and visit code; searches by hour, then by their stored content (a fixed order, but not alphabetical: sort the `q` column for that); ratings and feedback by hour, then id. Usage events and searches never come in the order they were stored.
- A `session_id` is one browser tab's random visit code, not a person.

**If the page says** "The database isn't set up here yet", the database migrations haven't been applied at that address (a team member with Cloudflare access runs them, `SPEC.md` §17). "Couldn't read the database" usually passes: try again in a few minutes; if it doesn't, the account may have reached the free plan's daily limit, which resets at 00:00 UTC.

## Licence

- **Content** (page text, transcripts, data files, handouts, audio and thumbnails): [CC BY 4.0](LICENSE-CONTENT.md). Our name and logo, and third-party material, are not covered.
- **Code:** [MIT](LICENSE).
