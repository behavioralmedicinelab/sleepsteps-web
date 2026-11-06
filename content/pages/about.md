---
title: About us
eyebrow: About us
heading: Sleep after cancer often gets missed. We want to change that.
band: hero
# The hero line under the heading; also the page's meta description. The
# text on this page was drafted from the trial's concept note (version 0.3,
# July 2026) for the team to confirm (SPEC §22).
summary: Sleep problems are common during and after cancer, but help that fits can be hard to find. This program brings that help to people at home.
styles: ["pages/about.css"]
# "Who we are": one row per person, in order (the coordinating principal
# investigator and trial coordinator first, then by surname). `organisation`
# is optional.
team:
  - name: Joshua Wiley
    role: Coordinating principal investigator
    organisation: Monash University
  - name: Alix Mellor
    role: Trial coordinator
    organisation: Monash University
  - name: Lisa Beatty
    role: Researcher
    organisation: Flinders University
  - name: Bei Bei
    role: Researcher and sleep psychologist
    organisation: Monash University
  - name: Fran Boyle
    role: Medical oncologist
    organisation: Mater Health
  - name: Daphne Day
    role: Medical oncologist
    organisation: Monash Health
  - name: Prue Francis
    role: Medical oncologist
    organisation: Peter MacCallum Cancer Centre
  - name: Maria Ftanou
    role: Psychologist
    organisation: Peter MacCallum Cancer Centre
  - name: Sheila Garland
    role: Researcher and sleep psychologist
    organisation: Memorial University (Canada)
  - name: Yun Hu
    role: Researcher
    organisation: Shanghai Jiao Tong University (China)
  - name: Michael Jefford
    role: Medical oncologist
    organisation: Peter MacCallum Cancer Centre
  - name: Daniel Johnstone
    role: Lived experience expert
  - name: Alysia Kepert
    role: Lived experience expert
  - name: Oxana Palesh
    role: Researcher
    organisation: Virginia Commonwealth University (USA)
  - name: Catriona Parker
    role: Researcher
    organisation: Monash University
  - name: Anna Singleton
    role: Researcher
    organisation: University of Sydney
  - name: Rebecca Wallace
    role: Psychologist
    organisation: Peter MacCallum Cancer Centre
# "About the trial": one row per fact, in order.
trial_facts:
  - term: What it tests
    detail: Whether a self-help program (this website's short videos, with regular tips by text or email) helps people with cancer sleep better. And whether extra help from a therapist, then a sleep specialist, helps people who are still having trouble sleeping.
  - term: Who can take part
    detail: In the trial, adults with any type or stage of cancer who have trouble sleeping. You can join any time from diagnosis until 6 months after your main treatment (surgery, chemotherapy or radiotherapy) ends. Other criteria apply, and the research team will check whether the trial suits you. Anyone can use this website.
  - term: Who runs it
    detail: The Behavioural Medicine Lab, School of Psychological Sciences, Monash University.
  - term: Funding
    detail: A National Health and Medical Research Council (NHMRC) Investigator Grant (2043220).
  - term: Ethics approval
    detail: "[Committee and number.]"
  - term: Registration
    detail: "[Trial registry and number.]"
---
{#- About us (SPEC §7.4; HANDOFF §6.5; board Info-About.dc.html). The hero band comes from `band: hero`. Styles: src/css/pages/about.css. Keep the HTML free of blank lines inside each section: a blank line ends Markdown's HTML block. -#}
<section class="about-why">
<h2>Why we made this program</h2>
<p>For many people, trouble sleeping lasts long after cancer treatment ends. People who sleep poorly often find it harder to think clearly, to work and to enjoy life. Yet help with sleep is not a routine part of cancer care in Australia.</p>
<p>The recommended first treatment for insomnia is cognitive behavioural therapy for insomnia, or CBT-I. It helps you change the habits and thoughts that keep you awake, and it works for people with cancer too. But the usual versions weren't made with cancer in mind. They don't cover things like treatment side effects, medicines such as steroids, or worry about cancer coming back. And few sleep programs made for people with cancer are widely available.</p>
<p>SleepSteps is a research trial of a stepped care program for sleep in people with cancer. Stepped care means starting with the simplest help, and adding more only for the people who need it.</p>
<p>The first step is self-help, built around this website: short videos made for people with cancer, which you can also listen to or read. You choose the sleep problems that fit you and go at your own pace. In the trial, some people who are still having trouble sleeping are then offered more help. This starts with two telehealth sessions with a trained therapist. If they need it, they can then be referred to a specialist sleep clinic.</p>
<p>Anyone can use this website. You don't need to be in the trial.</p>
</section>

<figure class="about-quote">
<blockquote class="about-quote__text"><p>“[A lived experience expert on why this matters to them.]”</p></blockquote>
<figcaption class="about-quote__caption">Lived experience expert<br>[Name, with permission]</figcaption>
</figure>

<section>
<h2>Who we are</h2>
<p class="about-intro">Researchers, clinicians and people with lived experience of cancer, working together.</p>
<ul class="about-team" role="list">
{%- for person in team %}
<li class="about-person"><span class="about-person__name">{{ person.name }}</span> <span class="about-person__role">{{ person.role }}{% if person.organisation %}, {{ person.organisation }}{% endif %}</span></li>
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
