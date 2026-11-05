---
layout: layouts/topics.njk
page_id: start
page_width: medium
title: Start here
band: standard
eyebrow: Start here
heading: The introduction
summary: Three short videos everyone watches first. Watch them in order, in one sitting or over a few days.
chapters:
  - title: How sleep works
  - title: Why cancer can change sleep
  - title: How to use SleepSteps
---
{#- M1a stub (SPEC §7.3; HANDOFF §6.2). The intro videos, ratings and formats arrive in M1b, when the chapters come from the video library. -#}
<div class="chapter-list">
{%- for chapter in chapters %}
<section class="chapter" id="v{{ loop.index }}">
  <h2 class="chapter__title">{{ loop.index }}. {{ chapter.title }}</h2>
  <p class="placeholder">[Intro video, rating and formats arrive in milestone M1b]</p>
</section>
{%- endfor %}
</div>
