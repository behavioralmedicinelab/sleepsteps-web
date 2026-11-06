---
title: Getting more help
summary: SleepSteps can help with many sleep problems, but not all. Here is when to talk to someone, and who.
styles: ["pages/help.css"]
# "Seeing a sleep specialist": the numbered steps, in order.
specialist_steps:
  - title: Book a GP appointment
    text: "[What to bring to the appointment.]"
  - title: Ask about a referral
    text: "[Sleep physician, sleep psychologist, or CBT-I provider.]"
  - title: Find a provider
    text: "[Link to a directory of accredited providers.]"
# "Other support": one card per service, in order.
services:
  - name: "[Cancer support line]"
    details: "[Phone · hours]"
  - name: "[Mental health support]"
    details: "[Phone · hours]"
  - name: "[Carer support]"
    details: "[Phone · hours]"
---
{#- Getting more help (SPEC §7.4; HANDOFF §6.5; board Info-Help.dc.html, without its GP summary line: there is no GP summary or sleep diary for now, SPEC §7.5, §21). Styles: src/css/pages/help.css. Keep the HTML free of blank lines inside each section: a blank line ends Markdown's HTML block. -#}
<section>
<h2>When to talk to your doctor</h2>
<p>Talk to your GP or treating team if:</p>
<ul>
<li>[your sleep problems are getting worse, or have lasted longer than expected]</li>
<li>[someone has noticed you stop breathing, gasp or choke in your sleep]</li>
<li>[you fall asleep without meaning to, such as while driving]</li>
<li>[low mood or worry is affecting most of your days]</li>
</ul>
<p class="help-note">[Clinical team to confirm this list.]</p>
</section>

<section>
<h2>Seeing a sleep specialist</h2>
<p class="help-intro">[How referral to a sleep clinic or sleep psychologist works, and what to say to your GP.]</p>
<ol class="help-steps" role="list">
{%- for step in specialist_steps %}
<li class="card help-step"><span class="help-step__num" aria-hidden="true">{{ loop.index }}</span><div><h3 class="help-step__title">{{ step.title }}</h3><p class="help-step__text">{{ step.text }}</p></div></li>
{%- endfor %}
</ol>
</section>

<section>
<h2>Other support</h2>
<ul class="help-services" role="list">
{%- for service in services %}
<li class="card help-service"><h3 class="help-service__name">{{ service.name }}</h3><p class="help-service__details">{{ service.details }}</p></li>
{%- endfor %}
</ul>
</section>

<p class="notice--urgent">If you feel unsafe or need help right now, go to <a href="/urgent-help/">Getting urgent help</a>.</p>
