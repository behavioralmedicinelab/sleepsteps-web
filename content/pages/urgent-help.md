---
layout: layouts/urgent.njk
title: Getting urgent help
summary: Who to contact if you need help now, including emergency services and crisis support.
styles: ["pages/urgent-help.css"]
# Analytics (SPEC §10.2): this page sends a page_view. base.njk renders it as
# <body data-page-view>, which events.js and pages.json (SPEC §8.3) read.
track_page_view: true
# The smaller cards under the crisis numbers: `heading`, `description`, an
# optional phone number in `value` and an optional website in `url` (https
# only, on the SPEC §16.1 list of allowed sites) with its link text in
# `link_text`. A card whose `value` is set (and no longer starts with "[") is
# a tel: link: the whole card, or, when the card also has a website, just the
# number, because one link can't hold another. "Your treating team" has no
# number: it is on each person's care plan, so that card is information, not
# a link (SPEC §7.4). Cancer Council 13 11 20 is an information and support
# line, not a crisis service.
other_contacts:
  - heading: "Your treating team"
    description: "For worrying symptoms or side effects. Use the number on your care plan."
  - heading: "Cancer Council"
    value: "13 11 20"
    description: "Free, confidential cancer information and support. Monday to Friday, 9am to 5pm (longer in some states)."
    url: "https://www.cancer.org.au/"
    link_text: "Cancer Council website"
---
{#-
  Getting urgent help (SPEC §7.4, §11; HANDOFF §6.5; board Info-Urgent.dc.html).
  One call card per site.config.json `crisisContacts` entry, in order: the
  first (the emergency number) on ink, the rest on deep-teal. The team must
  confirm the crisis numbers and the region (`crisisRegion`) before the site
  opens (SPEC §21, M8). The page stays as
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
{%- set cardLink = callable and not contact.url %}
<li>{% if cardLink %}<a class="contact-card contact-card--link" href="{{ contact.value | telHref }}">{% else %}<div class="contact-card">{% endif %}<h2 class="contact-card__title">{{ contact.heading }}</h2> <p class="contact-card__text">{% if contact.value %}{% if callable and not cardLink %}<a class="contact-card__number" href="{{ contact.value | telHref }}"><span class="visually-hidden">Call </span>{{ contact.value }}</a>{% else %}<span class="contact-card__number">{% if callable %}<span class="visually-hidden">Call </span>{% endif %}{{ contact.value }}</span>{% endif %}{% if contact.description %} · {% endif %}{% endif %}{{ contact.description }}</p>{% if contact.url %} <p class="contact-card__web link-standalone"><a href="{{ contact.url }}" rel="noreferrer">{{ contact.link_text or contact.url }}</a></p>{% endif %}{% if cardLink %}</a>{% else %}</div>{% endif %}</li>
{%- endfor %}
</ul>
<p class="urgent-help__note">This program is not a crisis service, and our team can't respond to urgent messages. Numbers shown are for {{ site.crisisRegion }}; if you are elsewhere, contact your local emergency service.</p>
</div>
