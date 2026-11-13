// /admin and /admin/* (SPEC §14.4): the staff summary page and the CSV
// exports. Imports no JSON, so Node can load this module too.
//
// Every request, whatever its path or method, first passes two gates, and
// each failure answers the same plain 403, reveals nothing and touches no D1:
//   1. the host is in API_HOSTS (lib/hosts.js). Those are exactly the hosts
//      behind an Access application: the custom domain (since 2026-11-10),
//      and every preview URL. Production's version URLs, which run production's code
//      on production's database, never match, so a token copied from a
//      staff member's browser can't be replayed there;
//   2. a valid Access token (lib/access-jwt.js).
// Anything unexpected in the gates (a throw) also answers 403. Then:
//   3. 405 (Allow: GET, HEAD) for any other method;
//   4. the path, exactly: /admin answers 308 to /admin/ (keeping the query),
//      /admin/ the summary, /admin/export the CSV export, anything else 404.
// HEAD runs the summary's GET and drops the body. HEAD on /admin/export
// answers 405 (Allow: GET) without reading D1: a download is only ever a
// GET.
//   5. /admin/export only: a request another site started (Sec-Fetch-Site
//      present and neither "same-origin" nor "none") answers 403 with a
//      fixed text, before D1 is read (startedHere, below).
//
// Admin doesn't depend on DATA_COLLECTION or `features`: it only reads, and
// stored data must stay readable after collection or a feature is switched
// off. While DATA_COLLECTION isn't "on" the page says so.
//
// The summary page is rendered here, with no script and its own CSP. The
// export (EXPORT_TABLES in lib/admin-queries.js) answers one of:
//   - 400 and a fixed plain-text message for a bad table, dates, cursor
//     (its skip at most the row cap), or a range over MAX_EXPORT_ROWS
//     (counted before anything is built);
//   - without paged=1: the whole file when it fits in one part, or else a
//     "download in parts" page whose script (src/js/admin-export.js, the
//     only admin script) fetches the parts and saves one file;
//   - with paged=1: one part. The first starts with the BOM and header;
//     X-Export-Rows gives its row count and X-Export-Next, while more
//     remain, the next part's cursor (type, ts, skip), which holds no id.
// No answer is ever a partial file: a part is built whole in memory before
// it is sent, and a D1 failure answers 500.
//
// Logging: four fixed lines, plus a code from a closed list. Never the
// token, a claim, the URL, the query, a header or a row.

import { ACCESS_FAILURES, TEAM_DOMAIN_RE, createAccessVerifier } from '../lib/access-jwt.js';
import {
  buildPart,
  countRows,
  csvText,
  cursorQuery,
  EXPORT_ERRORS,
  EXPORT_TABLES,
  exportFilename,
  MAX_EXPORT_ROWS,
  parseCursor,
  readSummary,
  summaryModel,
  tablesPresent,
} from '../lib/admin-data.js';
import { renderDownloadPage, renderSummary } from '../lib/admin-page.js';
import { d1Code } from '../lib/d1.js';
import {
  exportPieces,
  exportRange,
  MAX_EXPORT_DAYS,
  MAX_SUMMARY_DAYS,
  previousMonth,
  summaryRange,
} from '../lib/date-range.js';
import { hostAllowed } from '../lib/hosts.js';

/** On every admin response, errors and HEAD included. Never Set-Cookie. */
export const ADMIN_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // A page that opened an admin page in a popup loses its handle on it once
  // it loads, so another site can't load the summary again and again
  // through one (SPEC §14.4). As on every static response (SPEC §16.1).
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // As on every static response (src/_headers, SPEC §16.1): no
  // includeSubDomains, no preload. Browsers ignore it over http.
  'Strict-Transport-Security': 'max-age=31536000',
});

/**
 * The enforced CSP. No script-src (it falls back to default-src 'none'), so
 * a missed escape can't run script; the download page alone adds
 * script-src and connect-src 'self'. form-action names the Access team when
 * the var is well formed, because Chrome checks it on the redirect to
 * sign-in when the session has ended.
 */
export function adminCsp(env, { scripts = false } = {}) {
  let team = '';
  try {
    const domain = env?.ACCESS_TEAM_DOMAIN;
    if (typeof domain === 'string' && TEAM_DOMAIN_RE.test(domain)) team = ` https://${domain}`;
  } catch {
    team = '';
  }
  const script = scripts ? " script-src 'self'; connect-src 'self';" : '';
  return `default-src 'none';${script} style-src 'self'; img-src 'self'; form-action 'self'${team}; base-uri 'none'; frame-ancestors 'none'`;
}

const TEXT = 'text/plain; charset=utf-8';
const HTML = 'text/html; charset=utf-8';
const CSV = 'text/csv; charset=utf-8; header=present';

function respond(env, status, body, headers = {}, { scripts = false } = {}) {
  return new Response(body, {
    status,
    headers: { ...ADMIN_HEADERS, 'Content-Security-Policy': adminCsp(env, { scripts }), ...headers },
  });
}

const text = (env, status, body, headers = {}) => respond(env, status, body, { 'Content-Type': TEXT, ...headers });

/** The 403 for an export another site started. A fixed text. */
export const EXPORT_CROSS_SITE = 'Start the download from the admin page: open /admin/ and choose it there.';

/**
 * Did this export request start on the admin pages, as far as the browser
 * says? Sec-Fetch-Site is "same-origin" for the summary's links and the
 * download page's fetches, and "none" for a typed address or a bookmark. A
 * browser that sends no header passes. Anything else ("cross-site",
 * "same-site") is another site making a signed-in browser run a download:
 * each is a top-level GET that carries the Lax Access cookie, and its
 * attachment leaves that site's page open to start the next, so it could
 * use up the account's daily D1 reads (SPEC §14.4). The summary isn't
 * checked: the redirect back from the Access sign-in arrives "cross-site",
 * and an HTML answer replaces the page that navigated. A popup the other
 * site opened is cut off from it by Cross-Origin-Opener-Policy
 * (ADMIN_HEADERS), so it can't be loaded again without another click.
 */
function startedHere(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  return site === null || site === 'same-origin' || site === 'none';
}

function logReadFailure(error) {
  console.error('/admin: database read failed', d1Code(error));
}

/**
 * @param {object} options
 * @param {Map} options.index  pageIndex(pages.json)
 * @param {{ verify(request, env): Promise<{ ok: boolean, code?: string }> }} [options.access]
 *   the token check; tests pass their own, the default is the real verifier
 * @param {() => number} [options.now]  the clock, in ms
 * @param {number} [options.pageRows]   rows per export part, for every table (tests)
 * @param {number} [options.maxExportRows]  the row cap per download (tests)
 * @returns {{ handle(request: Request, env: object, url: URL): Promise<Response> }}
 */
export function createAdmin({
  index,
  access = createAccessVerifier(),
  now = () => Date.now(),
  pageRows,
  maxExportRows = MAX_EXPORT_ROWS,
}) {
  const limits = Object.freeze({ maxSummaryDays: MAX_SUMMARY_DAYS, maxExportDays: MAX_EXPORT_DAYS, maxExportRows });

  async function summary(env, url) {
    const nowMs = now();
    const range = summaryRange(url.searchParams, nowMs);
    const view = {
      host: url.host,
      collectionOn: env.DATA_COLLECTION === 'on',
      generatedAt: nowMs,
      today: range.today,
      form: { from: range.from, to: range.to },
      limits,
      rowsRead: null,
    };
    if (!range.ok) return page(env, 400, renderSummary({ ...view, state: 'invalid', errors: range.errors }));

    let read;
    try {
      read = await readSummary(env.DB, range);
    } catch (error) {
      logReadFailure(error);
      let present = true;
      try {
        present = await tablesPresent(env.DB);
      } catch {
        present = true;
      }
      return page(env, 500, renderSummary({ ...view, state: present ? 'error' : 'no-tables' }));
    }
    return page(
      env,
      200,
      renderSummary({
        ...view,
        state: 'ok',
        range,
        summary: summaryModel(read.results, index),
        downloads: { lastMonth: previousMonth(nowMs), pieces: exportPieces(range.from, range.to, nowMs) },
        rowsRead: read.rowsRead,
      }),
    );
  }

  const page = (env, status, body, options) => respond(env, status, body, { 'Content-Type': HTML }, options);

  async function exportCsv(env, url) {
    const params = url.searchParams;
    const table = params.get('table');
    const spec = typeof table === 'string' ? EXPORT_TABLES.get(table) : undefined;
    if (!spec) return text(env, 400, EXPORT_ERRORS.table);
    const nowMs = now();
    const range = exportRange(params, nowMs);
    if (!range.ok) return text(env, 400, EXPORT_ERRORS[range.error]);
    const paged = params.get('paged') === '1';
    const parsed = paged ? parseCursor(params, spec, range, maxExportRows) : { cursor: null };
    if (parsed.error) return text(env, 400, EXPORT_ERRORS.cursor);
    const { cursor } = parsed;

    const rowsPerPart = pageRows ?? spec.pageRows;
    const filename = exportFilename(table, range.from, range.to);
    const download = { 'Content-Type': CSV, 'Content-Disposition': `attachment; filename="${filename}"` };

    try {
      let total = null;
      if (cursor === null) {
        // Every download starts here (the page, a one-file download, or a
        // first part), so the cap holds however the parts are fetched.
        total = await countRows(env.DB, spec, range, maxExportRows);
        if (total > maxExportRows) return text(env, 400, EXPORT_ERRORS['too-many-rows']);
      }
      if (!paged && total > rowsPerPart) {
        return downloadPage(env, url, { table, range, filename, rows: total, pageRows: rowsPerPart, nowMs });
      }
      const part = await buildPart(env.DB, spec, range, cursor, rowsPerPart);
      if (!paged) {
        // A count that fitted, but more rows after all: never send part of a file.
        if (part.next !== null) return downloadPage(env, url, { table, range, filename, rows: total, pageRows: rowsPerPart, nowMs });
        return respond(env, 200, csvText(spec, part.rows, true), download);
      }
      const headers = { ...download, 'X-Export-Rows': String(part.rows.length) };
      if (part.next !== null) headers['X-Export-Next'] = cursorQuery(part.next);
      return respond(env, 200, csvText(spec, part.rows, cursor === null), headers);
    } catch (error) {
      logReadFailure(error);
      return text(env, 500, 'Server error');
    }
  }

  function downloadPage(env, url, { table, range, filename, rows, pageRows: rowsPerPart, nowMs }) {
    const body = renderDownloadPage({
      host: url.host,
      collectionOn: env.DATA_COLLECTION === 'on',
      generatedAt: nowMs,
      table,
      from: range.from,
      to: range.to,
      filename,
      rows,
      pageRows: rowsPerPart,
    });
    return page(env, 200, body, { scripts: true });
  }

  async function route(request, env, url) {
    const { method } = request;
    if (method !== 'GET' && method !== 'HEAD') return text(env, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    switch (url.pathname) {
      case '/admin':
        return respond(env, 308, null, { Location: `/admin/${url.search}` });
      case '/admin/':
        return summary(env, url);
      case '/admin/export':
        if (method === 'HEAD') return text(env, 405, 'Method not allowed', { Allow: 'GET' });
        if (!startedHere(request)) return text(env, 403, EXPORT_CROSS_SITE);
        return exportCsv(env, url);
      default:
        return text(env, 404, 'Not found');
    }
  }

  return {
    async handle(request, env, url) {
      // The gates, in their own try: anything unexpected refuses (fail closed).
      let check = { ok: false, code: 'error' };
      try {
        check = hostAllowed(url.host, env?.API_HOSTS) ? await access.verify(request, env) : { ok: false, code: 'host' };
      } catch {
        check = { ok: false, code: 'error' };
      }
      if (check?.ok !== true) {
        const code = ACCESS_FAILURES.includes(check?.code) ? check.code : 'error';
        console.error('/admin: access denied', code);
        return text(env, 403, 'Forbidden');
      }

      try {
        const response = await route(request, env, url);
        if (request.method !== 'HEAD') return response;
        return new Response(null, { status: response.status, headers: response.headers });
      } catch {
        // The error is dropped unread: its message could quote a row.
        console.error('/admin: unexpected error');
        return text(env, 500, 'Server error');
      }
    },
  };
}
