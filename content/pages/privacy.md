---
title: Privacy and your data
summary: You don't need an account to use SleepSteps. Here is what we collect, and what we don't.
styles: ["pages/privacy.css"]
# The two cards at the top of the page. Keep them in step with SPEC §15.2
# and with what the site actually stores (SPEC §10, §12, §13, §15.3).
collect:
  - "Star ratings you give a video"
  - "Written feedback, if you choose to send it, and the page you sent it from"
  - "Words you type into the site search"
  - "Anonymous usage: pages viewed, topics chosen, videos and audio played (and how far), transcripts opened and handouts downloaded"
collect_note: "Each of these is stored with the page it came from and the date and time."
not_collect:
  - "Your name, email or other contact details, unless you email or phone us (see below)"
  - "Accounts or passwords"
  - "Cookies, or anything else that tracks you from one visit to the next"
  - "A record of your IP address, or details of your device or browser"
  - "[Anything that identifies you, unless you write it in feedback]"
not_collect_note: "To count visits, your browser tab holds a temporary random code. It is deleted when you close the tab, and it can't identify you."
---
{#-
  Privacy and your data (SPEC §15.2; board Info-Privacy.dc.html).
  All of this wording is a draft until the HREC and privacy officer approve
  it (SPEC §15, M8). [Square brackets] mark placeholders the team must fill
  in. Links to other sites need rel="noreferrer" and a host on the build
  test's allowlist (SPEC §16.1).
-#}
<div class="privacy-cards">
<section class="card privacy-card privacy-card--collect">
<h2>What we collect</h2>
<ul>
{%- for item in collect %}
<li>{{ item }}</li>
{%- endfor %}
</ul>
<p>{{ collect_note }}</p>
</section>
<section class="card privacy-card privacy-card--not-collect">
<h2>What we don't collect</h2>
<ul>
{%- for item in not_collect %}
<li>{{ item }}</li>
{%- endfor %}
</ul>
<p>{{ not_collect_note }}</p>
</section>
</div>

<section>

## Our videos are on YouTube

The videos on this site are hosted on YouTube and shown here in an embedded player. Nothing is loaded from YouTube until you press play. When you do, the video plays in YouTube's privacy-enhanced mode, and YouTube (part of Google) receives information from your browser. If you use a “Watch on YouTube” link, the video opens on YouTube's own website.

Google's privacy policy applies.

<p class="link-standalone"><a href="https://policies.google.com/privacy" rel="noreferrer">YouTube privacy policy</a></p>

</section>

<section>

## Who handles this information

Cloudflare hosts this website and the database that stores this information. It also protects the site from spam and automated attacks, including a check that runs in your browser when you open the feedback form. YouTube (part of Google) receives information from your browser only when you choose to play a video.

Some of this processing may happen outside Australia.

</section>

<section>

## How we use this information

We use this information only to improve SleepSteps and to report on how the site is used. It is kept separate from the trial's research data and is never linked to anyone taking part in the trial. [Only the SleepSteps team can see it.] Ratings and feedback are never shown on the site.

<p class="notice--urgent">Feedback is not monitored for urgent issues. If you need help now, go to <a href="/urgent-help/">Getting urgent help</a>.</p>

</section>

<section>

## How long we keep it

We keep this information for [retention period]. We will stop collecting it when the funded project ends; the website itself will stay online.

</section>

<section>

## If you email or phone us

Emails and phone calls are not anonymous. If you contact us this way, for example to give feedback, we receive your email address or phone number along with your message. We use them only to reply to you. They are kept in [the team's email and phone records], separate from the information above, and we don't link them to it. We keep them for [retention period for emails and call notes].

</section>

<section class="panel privacy-contact">

## Questions or concerns

Contact the team at [email], or [the ethics committee contact for complaints].

SleepSteps is part of a research project approved by [HREC name] (approval number [HREC approval number]).

</section>
