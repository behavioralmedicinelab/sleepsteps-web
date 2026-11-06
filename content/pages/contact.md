---
title: Contact us
summary: Questions about this program or the trial? We're happy to help.
styles: ["pages/contact.css"]
# Contact details. Replace the [placeholders] and keep the quotes. The email
# address and phone number become links once they no longer start with "[".
email: "psych.sleepsteps@monash.edu"
email_note: "We usually reply within [two working days]."
phone: "[phone number]"
phone_hours: "[Days and hours, with time zone]"
---
{#- Contact us (SPEC §7.4; HANDOFF §2, §6.5; board Info-Contact.dc.html). There is no contact form (HANDOFF §2). Styles: src/css/pages/contact.css. Keep the HTML free of blank lines inside each block: a blank line ends Markdown's HTML block. -#}
<div class="contact-cards">
<section class="card contact-card">
<h2 class="contact-card__label">Email</h2>
<p class="contact-card__value">{% if email.startsWith('[') %}<span>{{ email }}</span>{% else %}<a href="mailto:{{ email }}">{{ email }}</a>{% endif %}</p>
<p class="contact-card__meta">{{ email_note }}</p>
</section>
<section class="card contact-card">
<h2 class="contact-card__label">Phone</h2>
<p class="contact-card__value">{% if phone.startsWith('[') %}<span>{{ phone }}</span>{% else %}<a href="{{ phone | telHref }}">{{ phone }}</a>{% endif %}</p>
<p class="contact-card__meta">{{ phone_hours }}</p>
</section>
</div>

<section class="panel panel--wash contact-help">
<h2>What we can help with</h2>
<p>Using the website, finding a video, questions about the trial, or feedback on the program.</p>
<p>Emails and phone calls aren't anonymous: we see your email address or phone number, and use it only to reply to you.</p>
</section>

<p class="notice--urgent">This inbox and phone line are not monitored for urgent help. If you need help now, go to <a href="/urgent-help/">Getting urgent help</a>.</p>
