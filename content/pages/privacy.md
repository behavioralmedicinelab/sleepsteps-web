---
title: Privacy and your data
summary: You don't need an account to use this program. Here is what we collect, and what we don't.
styles: ["pages/privacy.css"]
# The "Turn off usage statistics" button (SPEC §10.1). base.njk drops it
# while features.events is off, and the page then shows no switch.
scripts: ["stats-switch.js"]
# The two cards at the top of the page. Keep them in step with SPEC §15.2
# and with what the site actually stores (SPEC §10, §12, §13, §15.3).
# A `collect` item with a `feature` shows only while that switch in
# site.config.json is exactly true; its wording is then in `text`.
collect:
  - "Star ratings you give a video"
  - feature: feedback
    text: "Written feedback, if you choose to send it, and the page you sent it from. We store it with the time rounded to the hour"
  - "Words you type into the site search. We store these without the code that groups your visit, and with the time rounded to the hour"
  - "Anonymous usage: views of the sleep problem, introduction and urgent help pages, videos and audio played (and how far), and handouts opened"
collect_note: "Each of these is stored with the page it came from and the date and time."
not_collect:
  - "Your name, email or other contact details, unless you email or phone us (see below)"
  - "Accounts or passwords"
  - "Advertising or tracking cookies from us, or anything else we use to follow you from one visit to the next"
  - "A record of your IP address, or details of your device or browser"
  - "[Anything that identifies you, unless you write it in feedback or a search]"
not_collect_note: "To count visits, your browser tab holds a temporary random code. It is deleted when you close the tab, and on its own it can't identify you. You can turn it off (see “Cookies and browser storage”)."
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
{%- if not item.feature or site.features[item.feature] === true %}
<li>{{ item.text or item }}</li>
{%- endif %}
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
{%- if site.features.events === true %}
<p>{{ not_collect_note }}</p>
{%- endif %}
</section>
</div>

<section>

## Our videos are on YouTube

The videos on this site are hosted on YouTube and shown here in an embedded player. Nothing is loaded from YouTube until you press play. When you do, the video plays in YouTube's privacy-enhanced mode, and YouTube (part of Google) receives information from your browser. If you use a “Watch on YouTube” link, the video opens on YouTube's own website.

This site uses YouTube API Services to play videos. Google says videos watched this way aren't used to personalise YouTube or ads for you, and any ads are not personalised. YouTube may still store cookies and other information in your browser and collect information about what you watch. See [Cookies and browser storage](#cookies-and-browser-storage) below. Google's privacy policy and YouTube's Terms of Service apply. [Wording about YouTube's Terms of Service to be confirmed with the privacy officer.]

<p class="link-standalone"><a href="https://policies.google.com/privacy" rel="noreferrer">Google privacy policy</a></p>
<p class="link-standalone"><a href="https://www.youtube.com/t/terms" rel="noreferrer">YouTube Terms of Service</a></p>

</section>

<section>

## Who handles this information

Cloudflare hosts this website and the database that stores this information. It also protects the site from spam and automated attacks. YouTube (part of Google) receives information from your browser only when you choose to play a video.

{# What Turnstile, the feedback form's spam check, receives (SPEC §13,
   §15.2, decision A4): its script reads the page's address, which on the
   search page holds the search. Only while the form exists. #}
{% if site.features.feedback === true -%}
When you open the feedback form, a Cloudflare check runs in your browser to stop automated spam. The check receives technical details such as your IP address and browser, and the address of the page you're on, which on the search page includes your search. Cloudflare uses them for the check, and to improve its spam protection. We don't store your IP address or details of your browser.
{%- endif %}

Some of this processing may happen outside Australia.

</section>

<section aria-labelledby="cookies-and-browser-storage">

<h2 id="cookies-and-browser-storage">Cookies and browser storage</h2>

Websites can keep small pieces of information in your browser. Cookies are one kind. Browser storage is another.

We don't use cookies to track you or show you ads, and we don't set any cookies ourselves. A few things may be stored in your browser, by us or by the services we use: to make the site work, to protect it from spam and automated programs, or to count visits without knowing who you are. They are all listed here. We don't use any of them to find out who you are.

<div class="table-scroll" role="region" aria-labelledby="storage-table-caption" tabindex="0">
<table class="storage-table">
<caption id="storage-table-caption">What may be stored in your browser</caption>
<thead>
<tr><th scope="col">Name</th><th scope="col">Set by</th><th scope="col">What it's for</th><th scope="col">How long it lasts</th></tr>
</thead>
<tbody>
{%- if site.features.events === true %}
<tr><th scope="row"><code>sleepsteps-visit</code></th><td>This website</td><td>A random code that lets us count visits. It groups the usage information from one visit, such as page views and plays. On its own it can't identify you. It is stored when you open a sleep problem page, the introduction or Getting urgent help, unless you have turned off usage statistics.</td><td>Deleted when you close the tab. Reopening a closed tab, or your browser restoring its tabs, can bring it back, and duplicating a tab copies it.</td></tr>
<tr><th scope="row"><code>sleepsteps-stats-off</code></th><td>This website</td><td>Remembers that you turned off usage statistics. It is only stored if you do this.</td><td>Until you turn statistics back on or clear your browser data. Safari can also delete it after 7 days without a visit to this website.</td></tr>
{%- endif %}
<tr><th scope="row"><code>cf_clearance</code></th><td>Cloudflare, our hosting provider</td><td>Only if Cloudflare asks your browser to do a quick check that you're a person, not an automated program. It remembers that you passed, so you aren't asked again straight away.</td><td>30 minutes</td></tr>
{%- if site.features.feedback === true %}
<tr><th scope="row"><code>cf.turnstile.u</code></th><td>Cloudflare</td><td>Part of the check on the feedback form that stops automated spam. It is only stored if you open the form.</td><td>Cloudflare doesn't say. In our tests it stayed until browser data was cleared.</td></tr>
{%- endif %}
<tr><th scope="row">YouTube cookies and storage, such as <code>YSC</code> and <code>__Secure-YNID</code></th><td>YouTube (Google)</td><td>Only if you press play on a video. Google says it uses them to play videos, keep YouTube secure and measure use, and lists other purposes, including advertising, on its cookies page. We don't receive this information.</td><td>Some last until you close your browser. Google says others last up to 13 months.</td></tr>
</tbody>
</table>
</div>

### Turning off usage statistics

You can stop your browser sending us anonymous usage information: views of the sleep problem, introduction and urgent help pages, videos and audio played, handouts opened, and searches. Ratings and feedback you choose to send still reach us.

{# The switch (src/js/stats-switch.js). Without JavaScript the status line
    explains and the button stays hidden; the script shows the button and
    the current state, or says that the browser won't let it save a choice. #}
{% if site.features.events === true %}
<div class="stats-switch" data-stats-switch>
<p class="stats-switch__status" data-stats-status>Turning usage statistics off here needs JavaScript. Without JavaScript, your browser sends us no usage statistics.</p>
<button type="button" class="button button--primary stats-switch__toggle" data-stats-toggle hidden>Turn off usage statistics</button>
</div>

Your choice is saved in this browser only. If you use another browser or device, or clear your browser data, you'll need to turn them off again. If your browser blocks storage, we can't remember your choice.
{% else %}
This website isn't collecting usage statistics at the moment, so there is nothing to turn off.
{% endif %}

### Blocking cookies

Research staff who sign in to the site's admin area also get sign-in cookies from Cloudflare Access. Visitors never see that area.

You can block or delete cookies and browser storage in your browser's settings. Our own pages don't need them. {% if site.features.feedback === true %}YouTube videos and the spam check on the feedback form come from other services and may not work if you block their storage.{% else %}YouTube videos come from another service and may not work if you block its storage.{% endif %} If Cloudflare asks your browser to do a check while cookies are blocked, the check may not work.

</section>

<section>

## How we use this information

We use this information only to improve this program. Reporting on how the site is used is part of that. It is kept separate from the trial's research data and is never linked to anyone taking part in the trial. [Only our team can see it.] Ratings and feedback are never shown on the site.

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

Contact the team at [psych.sleepsteps@monash.edu](mailto:psych.sleepsteps@monash.edu), or [the ethics committee contact for complaints].

This program is part of a research project approved by [HREC name] (approval number [HREC approval number]).

</section>
