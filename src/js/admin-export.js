// The admin "download in parts" page (SPEC §14.4; decision B5): fetches an
// export too big for one request in parts and saves them as one CSV file.
// The only admin script, loaded by that page alone, under the admin CSP
// (script-src 'self'; connect-src 'self').
//
// The page ships its button hidden and a line saying the download needs
// JavaScript; this module shows the one and hides the other. On a press it
// fetches /admin/export with paged=1, follows each part's X-Export-Next
// (the next part's cursor: type, ts and skip, no id), keeps every part as a
// Blob (Response.text() would drop the first part's byte-order mark) and
// saves them joined, through a temporary <a download> on an object URL.
// Any failure (a non-2xx, a network error, a redirect to the Access sign-in,
// a timeout, an unexpected answer, too many parts) saves nothing and says so.
//
// The progress bar follows every part; the status line, which screen
// readers announce, changes at the start, at most every ANNOUNCE_EVERY_MS
// while fetching, and at the end, so a long download isn't hundreds of
// announcements. No console calls, no storage, and nothing here throws.

/** A runaway guard: at the 100,000-row cap, 500-row feedback parts make 200. */
export const MAX_PARTS = 1000;

/** How long one part may take. */
export const PART_TIMEOUT_MS = 30_000;

/** The least time between two announcements of progress. */
export const ANNOUNCE_EVERY_MS = 5000;

/** How long the saved file's object URL is kept before it is revoked. */
export const REVOKE_AFTER_MS = 60_000;

/** X-Export-Next, as the Worker writes it (cursorQuery in worker/lib/admin-data.js). */
export const NEXT_RE = /^(?:type=[a-z_]+&)?ts=[0-9A-Za-z%.:-]+&skip=\d{1,7}$/;

const ROWS_RE = /^\d{1,7}$/;
const TABLE_RE = /^[a-z]+$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILENAME_RE = /^[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/;

// It sends staff to the summary, not to a reload of this page: after a
// sign-in the return to /admin/export arrives cross-site, which the export
// refuses with a bare 403 (SPEC §14.4 step 5); the summary accepts it.
export const FAILED =
  "Couldn't download the data, so nothing was saved. If you've been signed out, choose 'Back to site data' below to sign in again, then start the download again.";

const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const rowsText = (n) => `${thousands(n)} ${n === 1 ? 'row' : 'rows'}`;

/** One part: its CSV as a Blob, its row count and the next cursor (null on the last part). Throws on anything unexpected. */
async function fetchPart(base, next) {
  const url = `/admin/export?${base}${next ? `&${next}` : ''}`;
  const response = await window.fetch(url, {
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(PART_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('status');
  if (!(response.headers.get('Content-Type') ?? '').startsWith('text/csv')) throw new Error('type');
  const rows = response.headers.get('X-Export-Rows') ?? '';
  if (!ROWS_RE.test(rows)) throw new Error('rows');
  const following = response.headers.get('X-Export-Next');
  if (following !== null && !NEXT_RE.test(following)) throw new Error('next');
  return { blob: await response.blob(), rows: Number(rows), next: following };
}

/** Save `blob` as `filename` through a temporary link. */
function save(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', href);
  link.setAttribute('download', filename);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(href);
    } catch {
      // Nothing to do: the URL goes when the page does.
    }
  }, REVOKE_AFTER_MS);
}

function setUp(button) {
  const { table, from, to, filename } = button.dataset;
  if (!TABLE_RE.test(table ?? '') || !DAY_RE.test(from ?? '') || !DAY_RE.test(to ?? '') || !FILENAME_RE.test(filename ?? '')) return;
  const status = document.querySelector('[data-export-status]');
  const progressBox = document.querySelector('[data-export-progress]');
  const progress = progressBox?.querySelector('progress') ?? null;
  const total = Number(progress?.getAttribute('max'));
  const base = new URLSearchParams({ table, from, to, paged: '1' }).toString();
  let running = false;

  const say = (text) => {
    if (status) status.textContent = text;
  };
  const show = (rows) => {
    if (progress) progress.value = rows;
  };
  const sofar = (rows) => (Number.isFinite(total) && total > 0 ? `${thousands(rows)} of ${rowsText(total)}` : rowsText(rows));

  button.addEventListener('click', async () => {
    if (running) return;
    running = true;
    button.setAttribute('aria-disabled', 'true');
    const parts = [];
    let rows = 0;
    let next = null;
    try {
      show(0);
      if (progressBox) progressBox.hidden = false;
      say(`Downloading: ${sofar(0)} so far. Keep this page open.`);
      let announced = Date.now();
      do {
        if (parts.length >= MAX_PARTS) throw new Error('parts');
        const part = await fetchPart(base, next);
        parts.push(part.blob);
        rows += part.rows;
        next = part.next;
        show(rows);
        if (next !== null && Date.now() - announced >= ANNOUNCE_EVERY_MS) {
          announced = Date.now();
          say(`Downloading: ${sofar(rows)} so far. Keep this page open.`);
        }
      } while (next !== null);
      save(new Blob(parts, { type: 'text/csv;charset=utf-8' }), filename);
      say(`Done: ${rowsText(rows)}. Your browser is saving ${filename}.`);
    } catch {
      if (progressBox) progressBox.hidden = true;
      say(FAILED);
    } finally {
      running = false;
      button.removeAttribute('aria-disabled');
    }
  });

  for (const line of document.querySelectorAll('[data-export-nojs]')) line.hidden = true;
  button.hidden = false;
}

try {
  const button = document.querySelector('[data-export]');
  if (button) setUp(button);
} catch {
  // Leave the page as it shipped: it says the download needs JavaScript.
}
