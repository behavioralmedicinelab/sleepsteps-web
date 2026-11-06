---
layout: layouts/urgent.njk
title: Getting urgent help
summary: Who to contact if you need help now, including emergency services and crisis support.
styles: ["pages/urgent-help.css"]
# Analytics (SPEC §10.2): this page sends a page_view from M3. Data only for now.
track_page_view: true
# The smaller cards under the crisis numbers: `heading`, `description` and
# an optional phone number in `value`. A card whose `value` is set (and no
# longer starts with "[") is a tel: link. "Your treating team" has no number:
# it is on each person's care plan, so that card is information, not a link
# (SPEC §7.4). The cancer support line is not confirmed yet (SPEC §21).
other_contacts:
  - heading: "Your treating team"
    description: "For worrying symptoms or side effects. Use the number on your care plan."
  - heading: "[Cancer support line]"
    value: "[Number]"
    description: "[Hours]"
---
{#-
  Getting urgent help (SPEC §7.4, §11; HANDOFF §6.5; board Info-Urgent.dc.html).
  One call card per site.config.json `crisisContacts` entry, in order: the
  first (the emergency number) on ink, the rest on deep-teal. The team must
  confirm the numbers, the cancer support line and the region
  (`crisisRegion`) before the site opens (SPEC §21, M8). The page stays as
  minimal as the board: no draft or developer notes (a test checks this).
-#}
<div class="urgent-help">
<div>
<h1 class="urgent-help__title">{{ title }}</h1>
<p class="urgent-help__lead">You don't have to manage this on your own. If you need help now, contact one of these.</p>
</div>
<ul class="urgent-help__calls" role="list">
{%- for contact in site.crisisContacts %}
<li class="call-card{% if loop.first %} call-card--first{% endif %}"><a href="{{ contact.value | telHref }}"><div class="call-card__text"><h2 class="call-card__title">{{ contact.heading or contact.label }}</h2>{% if contact.description %} <p>{{ contact.description }}</p>{% endif %}</div> <span class="call-card__number"><span class="visually-hidden">Call </span>{{ contact.value }}</span></a></li>
{%- endfor %}
</ul>
<ul class="urgent-help__more" role="list">
{%- for contact in other_contacts %}
{%- set callable = contact.value and not contact.value.startsWith('[') %}
<li>{% if callable %}<a class="contact-card contact-card--link" href="{{ contact.value | telHref }}">{% else %}<div class="contact-card">{% endif %}<h2 class="contact-card__title">{{ contact.heading }}</h2> <p class="contact-card__text">{% if contact.value %}<span class="contact-card__number">{% if callable %}<span class="visually-hidden">Call </span>{% endif %}{{ contact.value }}</span>{% if contact.description %} · {% endif %}{% endif %}{{ contact.description }}</p>{% if callable %}</a>{% else %}</div>{% endif %}</li>
{%- endfor %}
</ul>
<p class="urgent-help__note">SleepSteps is not a crisis service, and our team can't respond to urgent messages. Numbers shown are for {{ site.crisisRegion }}; if you are elsewhere, contact your local emergency service.</p>
</div>
