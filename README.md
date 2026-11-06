# sleepsteps-web

Website for a clinical trial of a stepped-care sleep intervention. It is a static site (Eleventy) plus a single Cloudflare Worker and a D1 database for optional anonymous ratings, feedback and usage events.

`SPEC.md` is the source of truth for how the site works and how it is built. The visual design handoff is in `docs/design/`.

## Quick start

Requires Node 22.12 or later (current LTS recommended).

```sh
npm install
npm run build   # build the site into dist/
npm run dev     # local site + Worker at http://localhost:8787
npm test        # run tests
```

`npm run dev` passes extra flags to `wrangler dev`, e.g. `npm run dev -- --port 8799`.

## Content editing

Everything below can be edited in GitHub's web editor. Every build starts with a content check (`node scripts/validate-content.js` runs it on its own): if something is wrong, the build stops and names the file and field. The full rules are in `SPEC.md` §7.

Text in `[square brackets]` is a placeholder for the team to replace.

### Videos

One file per video in `content/videos/<video_id>.md`. The file name is the `video_id`: lowercase words joined by hyphens, and never renamed once used. A video has no page of its own; problem pages and Start here show it.

```yaml
---
title: "Setting up a wind-down hour"
youtube_id: "AbCdEfGhIjK"           # the 11 characters after watch?v= in the YouTube link
duration: "6:40"                    # minutes:seconds, in quotes
audio: "wind-down-hour.mp3"         # the audio-only version: a file in media/audio/ (25 MiB at most)
handout: "wind-down-hour.pdf"       # the handout: a file in media/pdf/
thumbnail: "wind-down-hour.jpg"     # optional: a file in media/thumbs/
---
The transcript goes here, as plain paragraphs: word for word, naming the speakers.
Leave a blank line between paragraphs. No headings (#), no HTML, no images,
and no links except to pages on this site, such as [Pain](/problems/pain/).
```

Every video needs a handout, an audio-only version and a transcript by launch. The build warns about a video that is missing any of them, and the launch check (`node scripts/validate-content.js --no-placeholders`) fails on it. Any format a video doesn't have yet is simply not shown.

The handout's format (PDF, Word or a web page) is still being decided (`SPEC.md` §9.3); until then it is a PDF.

**Placeholder videos.** Until a video is on YouTube, its file has `placeholder: true`, `youtube_id: "PLACEHOLDER"` and `duration: "[mm:ss]"`; the page shows "[Video coming soon]". To make it real, put in the YouTube ID and duration, replace the bracketed stand-in transcript (if it has one) with the real transcript, and delete the `placeholder: true` line. The build fails on a real video that still has the stand-in. The build lists the placeholders that are left; there must be none at launch.

### Exporting the audio-only version

The audio-only version is the video's own soundtrack, exported from the final video file as an MP3 (`SPEC.md` §9.2): mono, 44.1 kHz, 96 kbps, loudness-normalised to -16 LUFS, with `loudnorm` aiming for a true peak of -1.5 dBTP so the finished MP3 stays at or below -1 dBTP, and with the source file's metadata removed and the SleepSteps tags added. It needs [ffmpeg](https://ffmpeg.org/). The commands below assume a stereo master; if the master's sound is already mono, leave out `pan=mono|c0=0.5*c0+0.5*c1,` in both steps.

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
     -metadata title="<video title>" -metadata artist=SleepSteps -metadata album=SleepSteps \
     -metadata date=2026 -metadata language=eng \
     -metadata copyright="2026 Behavioural Medicine Lab. Licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/" \
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

Find its transcript, handout and audio-only version on SleepSteps: https://[domain]/[page]/

This video gives general information about sleep. It is not medical advice and does not replace advice from your doctor or treating team.

If you need help now, [the contacts on Getting urgent help, once confirmed]. More: https://[domain]/urgent-help/

© 2026 Behavioural Medicine Lab. This video is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), except the SleepSteps name and logo and any third-party material marked as such. Suggested credit: "SleepSteps, Behavioural Medicine Lab, CC BY 4.0".

Comments are turned off. You can send feedback on the SleepSteps website.
```

### Adding a video to a problem

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
    video: wind-down-hour
    blurb: "Try this if you go straight from busy to bed."
  - tier: extra
    video: worry-time
    blurb: "Try this if worries keep you up."
related:                                # 2-3 other problems, by file name
  - not-sleepy-at-bedtime
  - stress-and-worries
```

A video can appear on several pages, but only once on each page. Leave the lines above `problem_video` (title, statement, area and so on) as they are unless the wording changes.

### Start here

The intro videos are `chapters` in `content/start.md`, in order, each with a `video` (a `video_id`) and a one-line `description`. Titles and durations come from the video files.

### Other content

- **Home page** wording (the hero, the format tiles' line and the trial text): the front matter at the top of `content/index.njk`. The hero photo goes in `src/img/`, named in `hero.photo`.
- **Problem areas:** `data/areas.csv` (edit in Excel, save as CSV UTF-8).
- **Information pages:** `content/pages/*.md`. The front matter they take is described at the top of `src/_includes/layouts/info.njk`.
- **Crisis numbers** on Getting urgent help: `crisisContacts` in `site.config.json`. The smaller cards under them (your treating team, the cancer support line) are `other_contacts` in `content/pages/urgent-help.md`; a card becomes a phone link once its `value` is a real number.

## Tests

`npm test` runs two Vitest projects: `worker` (the Worker, inside the Workers runtime) and `node` (the CSV parser, content data, checks on a fresh build of the whole site, and the browser modules run on that build in a small test DOM, `test/node/mini-dom.js`). `npm test -- --project node` runs one of them.

## Licence

- **Content** (page text, transcripts, data files, handouts, audio and thumbnails): [CC BY 4.0](LICENSE-CONTENT.md). The SleepSteps name and logo, and third-party material, are not covered.
- **Code:** [MIT](LICENSE).
