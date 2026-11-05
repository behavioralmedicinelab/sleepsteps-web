---
title: Privacy and your data
summary: You don't need an account to use SleepSteps. Here is what we collect, and what we don't.
styles: ["pages/privacy.css"]
# The two cards at the top of the page. Keep them in step with SPEC §15.2
# and with what the site actually stores (SPEC §10, §12, §13, §15.3).
collect:
  - "Star ratings you give a video"
  - "Written feedback, if you choose to send it, and the page you sent it from"
  - "Words you type into the site search. We store these without the code that groups your visit, and with the time rounded to the hour"
  - "Anonymous usage: views of the sleep problem, introduction and urgent help pages, videos and audio played (and how far), transcripts opened and handouts downloaded"
collect_note: "Each of these is stored with the page it came from and the date and time."
not_collect:
  - "Your name, email or other contact details, unless you email or phone us (see below)"
  - "Accounts or passwords"
  - "Advertising or tracking cookies from SleepSteps, or anything else we use to follow you from one visit to the next"
  - "A record of your IP address, or details of your device or browser"
  - "[Anything that identifies you, unless you write it in feedback]"
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

This site uses YouTube API Services to play videos. Google says videos watched this way aren't used to personalise YouTube or ads for you, and any ads are not personalised. YouTube may still store cookies and other information in your browser and collect information about what you watch. See [Cookies and browser storage](#cookies-and-browser-storage) below. Google's privacy policy and YouTube's Terms of Service apply. [Wording about YouTube's Terms of Service to be confirmed with the privacy officer.]

<p class="link-standalone"><a href="https://policies.google.com/privacy" rel="noreferrer">Google privacy policy</a></p>
<p class="link-standalone"><a href="https://www.youtube.com/t/terms" rel="noreferrer">YouTube Terms of Service</a></p>

</section>

<section>

## Who handles this information

Cloudflare hosts this website and the database that stores this information. It also protects the site from spam and automated attacks, including a check that runs in your browser when you open the feedback form. YouTube (part of Google) receives information from your browser only when you choose to play a video.

Some of this processing may happen outside Australia.

</section>

<section aria-labelledby="cookies-and-browser-storage">

<h2 id="cookies-and-browser-storage">Cookies and browser storage</h2>

Websites can keep small pieces of information in your browser. Cookies are one kind. Browser storage is another.

SleepSteps doesn't use cookies to track you or show you ads, and SleepSteps itself doesn't set any cookies. A few things may be stored in your browser, by us or by the services we use: to make the site work, to protect it from spam and automated programs, or to count visits without knowing who you are. They are all listed here. SleepSteps doesn't use any of them to find out who you are.

<div class="table-scroll" role="region" aria-labelledby="storage-table-caption" tabindex="0">
<table class="storage-table">
<caption id="storage-table-caption">What may be stored in your browser</caption>
<thead>
<tr><th scope="col">Name</th><th scope="col">Set by</th><th scope="col">What it's for</th><th scope="col">How long it lasts</th></tr>
</thead>
<tbody>
<tr><th scope="row"><code>sleepsteps-visit</code></th><td>SleepSteps</td><td>A random code that lets us count visits. It groups the page views, plays and downloads from one visit. On its own it can't identify you. It isn't stored if you turn off usage statistics.</td><td>Deleted when you close the tab</td></tr>
<tr><th scope="row"><code>sleepsteps-stats-off</code></th><td>SleepSteps</td><td>Remembers that you turned off usage statistics. It is only stored if you do this.</td><td>Until you turn statistics back on or clear your browser data</td></tr>
<tr><th scope="row"><code>cf_clearance</code></th><td>Cloudflare, our hosting provider</td><td>Only if Cloudflare asks your browser to do a quick check that you're a person, not an automated program. It remembers that you passed, so you aren't asked again straight away.</td><td>30 minutes</td></tr>
<tr><th scope="row"><code>cf.turnstile.u</code></th><td>Cloudflare</td><td>Part of the check on the feedback form that stops automated spam. It is only stored if you open the form.</td><td>Cloudflare doesn't say. Clearing your browser data removes it.</td></tr>
<tr><th scope="row">YouTube cookies and storage, such as <code>YSC</code> and <code>__Secure-YNID</code></th><td>YouTube (Google)</td><td>Only if you press play on a video. Google says it uses them to play videos, keep YouTube secure and measure use, and lists other purposes, including advertising, on its cookies page. We don't receive this information.</td><td>Some last until you close your browser. Google says others last up to 13 months.</td></tr>
</tbody>
</table>
</div>

Research staff who sign in to the site's admin area also get sign-in cookies from Cloudflare Access. Visitors never see that area.

### Turning off usage statistics

You can stop your browser sending us anonymous usage information: views of the sleep problem, introduction and urgent help pages, videos and audio played, transcripts opened, searches and handout downloads. Ratings and feedback you choose to send still reach us.

<p class="placeholder">[The “Turn off usage statistics” switch arrives with usage statistics in milestone M3.]</p>

Your choice is saved in this browser only. If you use another browser or device, or clear your browser data, you'll need to turn them off again. If your browser blocks storage, we can't remember your choice. If JavaScript is turned off, we don't receive any usage statistics.

### Blocking cookies

You can block or delete cookies and browser storage in your browser's settings. SleepSteps' own pages don't need them. YouTube videos and the spam check on the feedback form come from other services and may not work if you block their storage. If Cloudflare asks your browser to do a check while cookies are blocked, the check may not work.

</section>

<section>

## How we use this information

We use this information only to improve SleepSteps. Reporting on how the site is used is part of that. It is kept separate from the trial's research data and is never linked to anyone taking part in the trial. [Only the SleepSteps team can see it.] Ratings and feedback are never shown on the site.

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
