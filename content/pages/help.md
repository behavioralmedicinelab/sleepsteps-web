---
title: Getting more help
summary: SleepSteps can help with many sleep problems, but not all. Here is when to talk to someone, and who.
styles: ["pages/help.css"]
# "Seeing a sleep specialist": the numbered steps, in order.
specialist_steps:
  - title: Book a GP appointment
    text: "[What to bring, e.g. a sleep diary from SleepSteps.]"
  - title: Ask about a referral
    text: "[Sleep physician, sleep psychologist, or CBT-I provider.]"
  - title: Find a provider
    text: "[Link to a directory of accredited providers.]"
# "Print a one-page summary for your GP": the file name of the summary in
# media/pdf/ (e.g. "gp-summary.pdf"). Leave it empty until the summary exists
# (SPEC §21): the line then shows as [placeholder] text, not a link. Once it
# is set, the line becomes the board's link, and the tests fail if the file
# is missing.
gp_summary: ""
# "Other support": one card per service, in order.
services:
  - name: "[Cancer support line]"
    details: "[Phone · hours]"
  - name: "[Mental health support]"
    details: "[Phone · hours]"
  - name: "[Carer support]"
    details: "[Phone · hours]"
---
{#- Getting more help (SPEC §7.4; HANDOFF §6.5; board Info-Help.dc.html). Styles: src/css/pages/help.css. Keep the HTML free of blank lines inside each section: a blank line ends Markdown's HTML block. -#}
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
{#- The GP summary: a link once `gp_summary` names a file in media/pdf/, bracketed placeholder text until then (SPEC §21, §22). #}
{%- if gp_summary %}
<p class="help-print link-standalone"><a href="/media/pdf/{{ gp_summary }}">Print a one-page summary for your GP</a></p>
{%- else %}
<p class="help-print">[Print a one-page summary for your GP]</p>
{%- endif %}
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
