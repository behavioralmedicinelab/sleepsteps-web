---
title: About us
eyebrow: About us
heading: Sleep after cancer often gets missed. We want to change that.
band: hero
summary: "[One or two sentences: sleep problems are common during and after cancer, but help that fits is hard to find. This program brings that help to people at home.]"
styles: ["pages/about.css"]
# "Who we are": one card per person, in order. Keep values that start with
# "[" in quotes.
team:
  - name: "[Name]"
    role: "[Chief investigator]"
  - name: "[Name]"
    role: "[Sleep psychologist]"
  - name: "[Name]"
    role: "[Oncology clinician]"
  - name: "[Name]"
    role: "[Trial coordinator]"
  - name: "[Name]"
    role: "[Lived experience adviser]"
  - name: "[Name]"
    role: "[Lived experience adviser]"
# "About the trial": one row per fact, in order.
trial_facts:
  - term: What it tests
    detail: "[One sentence.]"
  - term: Who runs it
    detail: "[Institution and research group.]"
  - term: Funding
    detail: "[Funder.]"
  - term: Ethics approval
    detail: "[Committee and number.]"
  - term: Registration
    detail: "[Trial registry and number.]"
---
{#- About us (SPEC §7.4; HANDOFF §6.5; board Info-About.dc.html). The hero band comes from `band: hero`. Styles: src/css/pages/about.css. Keep the HTML free of blank lines inside each section: a blank line ends Markdown's HTML block. -#}
<section class="about-why">
<h2>Why we made this program</h2>
<p>[Short paragraph: what people affected by cancer told us about their sleep.]</p>
<p>[Short paragraph: why existing sleep programs didn't fit, e.g. long courses, not built around treatment, symptoms or fatigue.]</p>
<p>[Short paragraph: what we did differently. Short videos, choose your own problems, try one thing at a time.]</p>
</section>

<figure class="about-quote">
<blockquote class="about-quote__text"><p>“[A lived-experience adviser on why this matters to them.]”</p></blockquote>
<figcaption class="about-quote__caption">Lived experience adviser<br>[Name, with permission]</figcaption>
</figure>

<section>
<h2>Who we are</h2>
<p class="about-intro">Researchers, clinicians and people with lived experience of cancer, working together.</p>
<ul class="about-team" role="list">
{%- for person in team %}
<li class="card about-person"><div class="about-person__photo" aria-hidden="true">[Photo]</div><div class="about-person__body"><h3 class="about-person__name">{{ person.name }}</h3><p class="about-person__role">{{ person.role }}</p></div></li>
{%- endfor %}
</ul>
</section>

<section class="card about-trial">
<h2>About the trial</h2>
<dl class="about-facts">
{%- for fact in trial_facts %}
<dt>{{ fact.term }}</dt><dd>{{ fact.detail }}</dd>
{%- endfor %}
</dl>
<p class="about-trial__links">Questions about the trial? <a href="/contact/">Contact the team</a> <span aria-hidden="true">·</span> <a href="/privacy/">How we use data</a></p>
</section>
