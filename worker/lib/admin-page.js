// The admin pages' HTML (SPEC §14.4): pure renderers, with no D1 and no env.
// Imports no JSON, so Node can load this module too.
//
// Every value goes through html`` (lib/html.js), so it is escaped; there is
// no way to insert text unescaped. Attribute values are always
// double-quoted. hrefs are built only from constants and checked days and
// table names. Free text (feedback, search text) sits in elements with
// dir="auto". Nothing links to a public page: a staff member's click would
// load events.js there and add a page view to the data being read.
//
// The pages load /css/tokens.css and /css/admin.css only. The summary page
// has no script (its CSP has no script-src); the download page alone loads
// /js/admin-export.js, the only admin script (decision B5).
//
// Dates and times are UTC (decision B2), and the page says so wherever it
// shows one. The page never shows events.id, session_id, ratings.id or
// feedback.id: the view objects below carry none.

import { TS_RE, thousands } from './admin-data.js';
import { html } from './html.js';
import { formatDayLong, formatHour, formatMonth, formatSpan, formatTime, MIN_DAY } from './date-range.js';

/** The tables the page offers to download, in link order, with their names in the copy. */
export const DOWNLOAD_TABLES = Object.freeze([
  Object.freeze({ table: 'ratings', name: 'Ratings' }),
  Object.freeze({ table: 'feedback', name: 'Feedback' }),
  Object.freeze({ table: 'events', name: 'Usage events' }),
  Object.freeze({ table: 'searches', name: 'Searches' }),
]);

/** The free plan's rows read a day, for the whole account (SPEC §17). */
export const DAILY_ROWS_READ = 5_000_000;

/**
 * A summary load that reads more than this (10% of a day's allowance) says
 * so in the footer, so staff choose shorter ranges and tell the developer:
 * the longest range (MAX_SUMMARY_DAYS) may need shortening (decision B3).
 */
export const ROWS_READ_NOTE = DAILY_ROWS_READ / 10;

/** Sign-out for the Access application (SPEC §14.4). */
export const SIGN_OUT_URL = '/cdn-cgi/access/logout';

const LIST_LIMIT = 20;

const plural = (n, one, many) => `${thousands(n)} ${n === 1 ? one : many}`;

/** The export link for a checked table and checked days. URLSearchParams encodes; html`` escapes the &. */
const exportHref = (table, from, to) => `/admin/export?${new URLSearchParams({ table, from, to })}`;

// ---------------------------------------------------------------- the frame

function head(title, { script = false } = {}) {
  return html`<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/admin.css">
${script ? html`<script type="module" src="/js/admin-export.js"></script>\n` : ''}</head>
<body class="admin">
<a class="skip-link" href="#main">Skip to content</a>`;
}

function header(host) {
  return html`<header class="admin-header">
<div class="admin-container admin-header__inner">
<p class="admin-header__title">Staff area <span class="admin-header__host">on ${host}</span></p>
<a class="admin-header__signout" href="${SIGN_OUT_URL}">Sign out</a>
</div>
</header>`;
}

function footer(generatedAt, rowsRead) {
  const read = Number.isFinite(rowsRead)
    ? html` This page read ${thousands(rowsRead)} rows from the database. The free plan allows 5 million rows read a day for the whole account, visitors' ratings and feedback included.`
    : '';
  const note = Number.isFinite(rowsRead) && rowsRead > ROWS_READ_NOTE
    ? html`
<p class="admin-footer__note">That is more than a tenth of a day's allowance. Choose shorter ranges, and if this keeps happening, tell the developer: the longest range may need to be shorter.</p>`
    : '';
  return html`<footer class="admin-footer">
<div class="admin-container">
<p>Page made ${formatTime(generatedAt)}.${read}</p>${note}
</div>
</footer>
</body>
</html>
`;
}

function collectionNotice(collectionOn) {
  if (collectionOn) return '';
  return html`<div class="admin-notice">
<p><strong>Data collection is off at this address.</strong> The site isn't storing new ratings, feedback or usage statistics here, so this page shows only what was stored before, if anything.</p>
</div>`;
}

// ---------------------------------------------------------------- tables

/**
 * A data table in a focusable scroll region named by its caption, so a
 * wide table scrolls inside the page (WCAG 1.4.10) and keyboard users can
 * scroll it. `columns`: [{ label, num }]; the first is the row header.
 * `rows`: html`` rows (<tr>…</tr>); `foot`: one html`` row or ''.
 */
function dataTable(id, caption, columns, rows, foot = '') {
  const cols = columns.map(
    ({ label, num }) => html`<th scope="col"${num ? html` class="num"` : ''}>${label}</th>`,
  );
  return html`<div class="table-scroll" role="region" aria-labelledby="${id}" tabindex="0">
<table>
<caption id="${id}">${caption}</caption>
<thead><tr>${cols}</tr></thead>
<tbody>
${rows}</tbody>${foot ? html`
<tfoot>${foot}</tfoot>` : ''}
</table>
</div>`;
}

const num = (n) => html`<td class="num">${thousands(n)}</td>`;
const meanCell = (mean) => html`<td class="num">${Number.isFinite(mean) ? mean.toFixed(1) : ''}</td>`;

/** A page as a row header: its title, then its id (or that it is no longer on the site). */
function pageHeader(row) {
  return html`<th scope="row"><span class="page-name">${row.title}</span> <span class="page-id">${row.known ? row.page : 'No longer on the site'}</span></th>`;
}

const videoHeader = (video) => html`<th scope="row" class="video-id">${video}</th>`;

const empty = (text) => html`<p class="empty">${text}</p>`;

// ---------------------------------------------------------------- the form

/** An example date, kept on one line: it would otherwise break at a hyphen. */
const example = (day) => html`<span class="nowrap">${day}</span>`;

const ERROR_TEXT = {
  'from-invalid': () => html`Enter the start date as a real date from ${formatDayLong(MIN_DAY)} on, for example ${example('2026-10-01')}`,
  'to-invalid': () => html`Enter the end date as a real date from ${formatDayLong(MIN_DAY)} on, for example ${example('2026-10-31')}`,
  future: (view) => `The end date can't be after today, ${formatDayLong(view.today)} (UTC)`,
  order: () => 'The start date must be on or before the end date',
  'too-long': (view) => `Choose a range of ${view.limits.maxSummaryDays} days or fewer. For longer periods, download the data a month at a time`,
};

/** An error's text; an unknown code still says something true. */
const errorText = (error, view) => (ERROR_TEXT[error.code] ?? (() => 'Check this date'))(view);

/**
 * The error summary. Each link's text is wrapped in one <span>: the link is
 * inline-flex (a 44px target), and without the wrapper the text before an
 * example date and the date's own span would be two flex items, laid out
 * side by side with the space between them lost.
 */
function errorSummary(view) {
  return html`<section class="error-summary" aria-labelledby="error-summary-title">
<h2 id="error-summary-title">There is a problem</h2>
<ul>
${view.errors.map((error) => html`<li><a href="${`#${error.field}`}"><span>${errorText(error, view)}</span></a></li>\n`)}</ul>
</section>`;
}

function dateField(view, field, label) {
  const error = (view.errors ?? []).find((e) => e.field === field);
  const errorId = `${field}-error`;
  const describedBy = error ? `${errorId} range-hint` : 'range-hint';
  return html`<div class="field">
<label for="${field}">${label}</label>
${error ? html`<p class="field-error" id="${errorId}"><span class="visually-hidden">Error: </span>${errorText(error, view)}</p>\n` : ''}<input type="date" id="${field}" name="${field}" value="${view.form[field] ?? ''}" min="${MIN_DAY}" max="${view.today}" aria-describedby="${describedBy}"${error ? html` aria-invalid="true"` : ''}>
</div>`;
}

function rangeForm(view) {
  return html`<form class="range" method="get" action="/admin/" novalidate>
<fieldset>
<legend>Date range</legend>
<p class="hint" id="range-hint">UTC days, both included. Leave both empty for the last 30 days. Up to ${view.limits.maxSummaryDays} days.</p>
<div class="range__fields">
${dateField(view, 'from', 'From')}
${dateField(view, 'to', 'To')}
<button class="range__submit" type="submit">Show</button>
</div>
</fieldset>
</form>`;
}

// ---------------------------------------------------------------- sections

function currentRange(view) {
  const { range } = view;
  const span = range.from === range.to
    ? formatDayLong(range.from)
    : `${formatDayLong(range.from)} to ${formatDayLong(range.to)}`;
  const lead = range.isDefault ? `Showing the last ${plural(range.days, 'day', 'days')}: ${span}` : `Showing ${span}`;
  const today = range.to === view.today ? ' Today is still under way, so its numbers can still grow.' : '';
  const reset = range.isDefault ? '' : html` <a class="range-current__reset" href="/admin/">Show the last 30 days</a>`;
  return html`<p class="range-current">${lead} (UTC days, both included).${today}${reset}</p>`;
}

const SECTIONS = [
  ['downloads', 'Download the data'],
  ['views', 'Page views and visits'],
  ['ratings', 'Ratings'],
  ['searches', 'Searches that found nothing'],
  ['feedback', 'Feedback'],
  ['plays', 'Plays and how far people got'],
  ['handouts', 'Handouts opened'],
];

function contents() {
  return html`<nav class="admin-toc" aria-label="On this page">
<ul>
${SECTIONS.map(([id, title]) => html`<li><a href="${`#${id}`}">${title}</a></li>\n`)}</ul>
</nav>`;
}

function section(id, body, className = '') {
  const title = SECTIONS.find(([key]) => key === id)[1];
  return html`<section class="${`admin-section${className ? ` ${className}` : ''}`}" aria-labelledby="${id}">
<h2 id="${id}">${title}</h2>
${body}
</section>`;
}

/** The four links for checked days. `label` names the days; each link adds that they are UTC. */
function exportLinks(from, to, label) {
  return html`<ul class="admin-links">
${DOWNLOAD_TABLES.map(({ table, name }) => html`<li><a href="${exportHref(table, from, to)}">${name}, ${label} UTC (CSV)</a></li>\n`)}</ul>`;
}

function downloads(view) {
  const { lastMonth, pieces } = view.downloads;
  const { range, limits } = view;
  const lastPiece = pieces[pieces.length - 1];
  let thisRange;
  if (pieces.length === 0) {
    thisRange = html`<p>Downloads cover complete UTC days only, so there is nothing to download for a range that starts today.</p>`;
  } else if (pieces.length === 1 && pieces[0].from === lastMonth.from && pieces[0].to === lastMonth.to) {
    thisRange = html`<p>This range is last month: use the links above.</p>`;
  } else {
    const ends = lastPiece.to !== range.to
      ? html`<p class="hint">Downloads cover complete UTC days only, so these end yesterday, ${formatDayLong(lastPiece.to)}.</p>\n`
      : '';
    const lists = pieces.length === 1
      ? exportLinks(pieces[0].from, pieces[0].to, formatSpan(pieces[0].from, pieces[0].to))
      : html`<p>A download covers at most ${limits.maxExportDays} days, so this range comes a month at a time.</p>
${pieces.map((piece) => html`<h4>${formatSpan(piece.from, piece.to)} (UTC days)</h4>
${exportLinks(piece.from, piece.to, formatSpan(piece.from, piece.to))}
`)}`;
    thisRange = html`${ends}${lists}`;
  }
  return section(
    'downloads',
    html`<p>CSV files (UTF-8 with a byte-order mark, and a header row) for Excel, R or Python. Times in the files are UTC and rounded down to the hour. A text cell that starts with =, +, -, @, ', a tab or a line break (or the full-width ＝, ＋, －, ＠) gets an extra ' in front, so a spreadsheet shows it as text: remove one leading ' to get the stored text. Usage events have no row number, on purpose.</p>
<p>Feedback and search text come from anyone and can hold health or identifying details. Save every file in the team's restricted folder, never in the code repository or an email.</p>
<h3>Last month: ${formatMonth(lastMonth.from)} (UTC)</h3>
<p class="hint">A UTC month starts at 10 am on the 1st in Melbourne (11 am during daylight saving), so each month's files are ready from that time on the 1st of the next month. Until then, these links show the month before.</p>
${exportLinks(lastMonth.from, lastMonth.to, formatMonth(lastMonth.from))}
<h3>This range</h3>
${thisRange}
<p>Each download covers at most ${limits.maxExportDays} days and ${thousands(limits.maxExportRows)} rows. A download too big for one request opens a page that fetches it in parts, which needs JavaScript.</p>`,
    'admin-section--downloads',
  );
}

function views(s) {
  const intro = html`<p>Problem pages, Start here and Getting urgent help send a page view each time they load; other pages send none. A visit is one browser tab's visit code, so a visit that opens three of these pages counts once on each of them, and once in the total. A visit that runs past midnight UTC at either end of the range counts in both ranges. Visitors who turned usage statistics off, or whose browser runs no JavaScript, send nothing.</p>`;
  if (s.views.views === 0) return section('views', html`${intro}\n${empty('No page views in this range.')}`);
  const rows = s.views.rows.map((row) => html`<tr>${pageHeader(row)}${num(row.views)}${num(row.visits)}</tr>\n`);
  const foot = html`<tr><th scope="row">All tracked pages</th>${num(s.views.views)}${num(s.views.visits)}</tr>`;
  const table = dataTable(
    'views-caption',
    'Views and visits per tracked page',
    [{ label: 'Page' }, { label: 'Views', num: true }, { label: 'Visits', num: true }],
    rows,
    foot,
  );
  return section('views', html`${intro}\n${table}`);
}

function ratings(s) {
  const r = s.ratings;
  const intro = html`<p>A changed rating is stored as a new rating, so these count ratings, not people. Ratings are kept by video id, so ratings given while a video was a placeholder stay with the real video that replaces it.</p>`;
  if (r.total === 0) return section('ratings', html`${intro}\n${empty('No ratings in this range.')}`);
  const meanCol = { label: 'Mean (out of 5)', num: true };
  const countCol = { label: 'Ratings', num: true };
  const byVideo = dataTable(
    'ratings-video-caption',
    'Ratings per video',
    [{ label: 'Video' }, countCol, meanCol],
    r.byVideo.map((row) => html`<tr>${videoHeader(row.video)}${num(row.n)}${meanCell(row.mean)}</tr>\n`),
  );
  const byPage = dataTable(
    'ratings-page-caption',
    'Ratings per page',
    [{ label: 'Page' }, countCol, meanCol],
    r.byPage.map((row) => html`<tr>${pageHeader(row)}${num(row.n)}${meanCell(row.mean)}</tr>\n`),
  );
  const byPageVideo = dataTable(
    'ratings-page-video-caption',
    'Ratings per page and video',
    [{ label: 'Page' }, { label: 'Video' }, countCol, meanCol],
    r.byPageVideo.map(
      (row) => html`<tr>${pageHeader(row)}<td class="video-id">${row.video}</td>${num(row.n)}${meanCell(row.mean)}</tr>\n`,
    ),
  );
  return section(
    'ratings',
    html`${intro}
<p>${plural(r.total, 'rating', 'ratings')} in this range. Means are to one decimal place.</p>
${byVideo}
${byPage}
${byPageVideo}`,
  );
}

function searches(s) {
  const { total, zero, top } = s.searches;
  if (total === 0) return section('searches', empty('No searches in this range.'));
  const counts = html`<p>${plural(total, 'search', 'searches')} in this range, ${thousands(zero)} of which found nothing.</p>`;
  if (zero === 0 || top.length === 0) return section('searches', html`${counts}\n${empty('Every search in this range found something.')}`);
  const table = dataTable(
    'searches-caption',
    top.length < LIST_LIMIT ? 'Searches with no results' : `The ${LIST_LIMIT} most frequent searches with no results`,
    [{ label: 'Search text' }, { label: 'Times searched', num: true }],
    top.map((row) => html`<tr><th scope="row" class="search-text" dir="auto">${row.q}</th>${num(row.n)}</tr>\n`),
  );
  return section(
    'searches',
    html`${counts}
<p>The searches that found nothing, most frequent first (up to ${LIST_LIMIT}), with capital letters A to Z ignored, to help update the search keywords. Search text comes from anyone and can hold health or identifying details.</p>
${table}`,
  );
}

/** A stored hour as <time>, only when it is exactly toISOString() output; otherwise its text, escaped. */
function hourOf(ts) {
  return TS_RE.test(ts) ? html`<time datetime="${ts}">${formatHour(ts)}</time>` : ts;
}

/**
 * A message's page: its current title from pages.json and its id, or its id
 * alone when it is no longer on the site (feedback stores no title, SPEC
 * §14.4).
 */
function feedbackPage(item) {
  if (!item.known) return html`<span class="feedback-item__page">${item.page}</span> (no longer on the site)`;
  if (item.title === item.page) return html`<span class="feedback-item__page">${item.page}</span>`;
  return html`<span class="feedback-item__page">${item.title}</span> <span class="feedback-item__page-id">(${item.page})</span>`;
}

/**
 * ", video <video_id>" after a message's page, when it was sent from that
 * video's Feedback button (SPEC §13, §14.4); nothing for a message without
 * one. By id, as every video on this page is.
 */
function feedbackVideo(item) {
  return item.video ? html`, video <span class="feedback-item__video video-id">${item.video}</span>` : '';
}

function feedback(s) {
  const { total, recent } = s.feedback;
  if (total === 0 || recent.length === 0) return section('feedback', empty('No feedback in this range.'));
  let lead;
  if (recent.length < total) lead = `The ${recent.length} most recent of ${thousands(total)} messages in this range, newest first.`;
  else if (total === 1) lead = 'The one message in this range.';
  else lead = `All ${thousands(total)} messages in this range, newest first.`;
  const items = recent.map(
    (item) => html`<li class="feedback-item">
<h3 class="feedback-item__heading">${feedbackPage(item)}${feedbackVideo(item)}, ${hourOf(item.ts)}</h3>
<blockquote class="feedback-item__message" dir="auto">${item.message}</blockquote>
</li>
`,
  );
  const more = recent.length < total
    ? html`
<p>To read every message, use the feedback downloads under <a href="#downloads">Download the data</a>.</p>`
    : '';
  return section(
    'feedback',
    html`<p>${lead} Times are UTC, rounded down to the hour. Messages are shown as stored: as sent, except that line breaks are made uniform, control characters are removed and spaces are trimmed from each end. Feedback comes from anyone and can hold health or identifying details.</p>
<ol class="feedback-list">
${items}</ol>${more}`,
  );
}

function plays(s) {
  const columns = [
    { label: 'Video' },
    { label: 'Plays', num: true },
    { label: 'Under 25%', num: true },
    { label: '25%', num: true },
    { label: '50%', num: true },
    { label: '75%', num: true },
    { label: '100%', num: true },
  ];
  const table = (rows, id, caption, none) => (rows.length === 0
    ? empty(none)
    : dataTable(
      id,
      caption,
      columns,
      rows.map(
        (row) => html`<tr>${videoHeader(row.media)}${num(row.plays)}${num(row.f0)}${num(row.f25)}${num(row.f50)}${num(row.f75)}${num(row.f100)}</tr>\n`,
      ),
    ));
  return section(
    'plays',
    html`<p>A play is one visit playing a video, or its audio-only version, on one page, counted once at the furthest point it reached. "Under 25%" means it started but didn't reach a quarter. Each row's five furthest-point columns add up to its plays.</p>
${table(s.plays.video, 'plays-video-caption', 'Video plays per video', 'No video plays in this range.')}
${table(s.plays.audio, 'plays-audio-caption', 'Audio-only plays per video', 'No audio-only plays in this range.')}`,
  );
}

function handouts(s) {
  const intro = html`<p>Each click on a video's handout link, whether the browser opened the handout or saved it, and the number of visits that clicked.</p>`;
  if (s.handouts.length === 0) return section('handouts', html`${intro}\n${empty('No handouts opened in this range.')}`);
  const table = dataTable(
    'handouts-caption',
    'Handout clicks per video',
    [{ label: 'Video' }, { label: 'Clicks', num: true }, { label: 'Visits', num: true }],
    s.handouts.map((row) => html`<tr>${videoHeader(row.media)}${num(row.clicks)}${num(row.visits)}</tr>\n`),
  );
  return section('handouts', html`${intro}\n${table}`);
}

// ---------------------------------------------------------------- the pages

const ALERTS = {
  'no-tables': html`<section class="admin-alert" aria-labelledby="alert-title">
<h2 id="alert-title">The database isn't set up here yet</h2>
<p>This address's database doesn't have the site's tables, so nothing has been stored here. Once a person applies the database migrations to it, this page will work.</p>
</section>`,
  error: html`<section class="admin-alert" aria-labelledby="alert-title">
<h2 id="alert-title">Couldn't read the database</h2>
<p>Try again in a few minutes. If it still fails, the account may have reached the free plan's daily limit (5 million rows read or 100,000 written). Every database query then fails until 00:00 UTC (10 or 11 am in Melbourne), downloads and visitors' ratings and feedback included.</p>
</section>`,
};

/**
 * The summary page.
 * @param {object} view
 * @param {'ok' | 'invalid' | 'no-tables' | 'error'} view.state
 * @param {string} view.host            the request's host (shown, escaped)
 * @param {boolean} view.collectionOn   DATA_COLLECTION is exactly "on"
 * @param {number} view.generatedAt     ms
 * @param {string} view.today           today's UTC day
 * @param {{ from: string | null, to: string | null }} view.form   valid dates only
 * @param {Array<{ field: 'from' | 'to', code: string }>} [view.errors]   invalid state
 * @param {object} [view.range]         ok: summaryRange()'s result
 * @param {object} [view.summary]       ok: summaryModel()'s result
 * @param {object} [view.downloads]     ok: { lastMonth: { from, to }, pieces: [{ from, to }] }
 * @param {number | null} [view.rowsRead]
 * @param {object} view.limits          { maxSummaryDays, maxExportDays, maxExportRows }
 * @returns {string}
 */
export function renderSummary(view) {
  const ok = view.state === 'ok';
  const title = ok ? `Site data, ${formatSpan(view.range.from, view.range.to)} (UTC)` : 'Error: Site data';
  let problem = '';
  if (view.state === 'invalid') problem = errorSummary(view);
  else if (!ok) problem = ALERTS[view.state] ?? ALERTS.error;

  const body = ok
    ? html`
${currentRange(view)}
${contents()}
${downloads(view)}
${views(view.summary)}
${ratings(view.summary)}
${searches(view.summary)}
${feedback(view.summary)}
${plays(view.summary)}
${handouts(view.summary)}`
    : '';

  return html`${head(title)}
${header(view.host)}
<main id="main" class="admin-container admin-main">
<h1>Site data</h1>
${problem ? html`${problem}\n` : ''}<p class="admin-lede">Ratings, feedback, searches and usage statistics stored by this website. Feedback and search text come from anyone and can hold health or identifying details, so keep this page, printouts and downloads within the research team.</p>
${collectionNotice(view.collectionOn)}
${rangeForm(view)}${body}
</main>
${footer(view.generatedAt, ok ? view.rowsRead : null)}`.toString();
}

/**
 * The "download in parts" page: the range is too big for one request.
 * Without JavaScript it says plainly that this download needs JavaScript
 * (decision B5); admin-export.js shows the button and hides that line.
 * @param {object} view
 * @param {string} view.host
 * @param {boolean} view.collectionOn
 * @param {number} view.generatedAt
 * @param {string} view.table       a checked EXPORT_TABLES key
 * @param {string} view.from        checked days
 * @param {string} view.to
 * @param {string} view.filename    exportFilename(table, from, to)
 * @param {number} view.rows        how many rows the range holds (at most the cap)
 * @param {number} view.pageRows    rows per part
 * @returns {string}
 */
export function renderDownloadPage(view) {
  const entry = DOWNLOAD_TABLES.find(({ table }) => table === view.table);
  const name = entry ? entry.name : view.table;
  const lower = name.toLowerCase();
  const parts = Math.max(1, Math.ceil(view.rows / view.pageRows));
  const span = view.from === view.to ? formatDayLong(view.from) : `${formatDayLong(view.from)} to ${formatDayLong(view.to)}`;
  return html`${head(`Download ${lower}, ${formatSpan(view.from, view.to)} (UTC)`, { script: true })}
${header(view.host)}
<main id="main" class="admin-container admin-main">
<h1>Download ${lower}</h1>
${collectionNotice(view.collectionOn)}
<p>${span} (UTC days) holds ${plural(view.rows, 'row', 'rows')} of ${lower}. One request on Cloudflare's free plan can send ${thousands(view.pageRows)}, so the button below fetches them in ${plural(parts, 'part', 'parts')} and saves them as one CSV file, ${view.filename}.</p>
<div class="admin-notice" data-export-nojs>
<p><strong>This download needs JavaScript.</strong> JavaScript is off or blocked in this browser, so the download can't run. Turn JavaScript on for this site and reload this page, or open it in a browser where JavaScript runs.</p>
</div>
<div class="export">
<button type="button" class="admin-button" data-export data-table="${view.table}" data-from="${view.from}" data-to="${view.to}" data-filename="${view.filename}" hidden>Download ${lower} (CSV)</button>
<div class="export__progress" data-export-progress hidden>
<label for="export-progress-bar">Rows fetched</label>
<progress id="export-progress-bar" max="${view.rows}" value="0"></progress>
</div>
<p class="export__status" role="status" data-export-status></p>
</div>
<p>Keep this page open until it says the file is being saved. Then move the file from Downloads to the team's restricted folder: never the code repository or an email.</p>
<p><a href="/admin/">Back to site data</a></p>
</main>
${footer(view.generatedAt, null)}`.toString();
}
