---
# Start here (/start/): SPEC §7.3; HANDOFF §6.2. This file is data only:
# layouts/start.njk builds the page from the fields below, and anything
# written under the closing "---" is not shown.
layout: layouts/start.njk
page_id: start
page_width: medium
title: Start here
eyebrow: Start here
heading: The introduction
summary: Three short videos everyone watches first. Watch them in order, in one sitting or over a few days.
styles: ["pages/start.css"]
scripts: ["players.js"]
# Analytics (SPEC §10.2): this page sends a page_view. base.njk renders it as
# <body data-page-view>, which events.js and pages.json (SPEC §8.3) read.
track_page_view: true
# Transcripts come from the video files, so they must be rendered first.
eleventyImport:
  collections: ["videos"]
# The intro videos, in order (SPEC §7.3). Each `video` is a file name in
# content/videos/ (without .md); its title, duration and formats come from
# that file. The descriptions are placeholders (HANDOFF §12).
chapters:
  - video: how-sleep-works
    description: "[What happens while we sleep, and what makes us feel sleepy at night.]"
  - video: why-cancer-can-change-sleep
    description: "[How diagnosis, treatment and recovery can affect your nights and days.]"
  - video: how-to-use-this-program
    description: "[Finding the sleep problems that fit you, and trying one idea at a time.]"
---
