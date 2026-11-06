// Sending to the Worker API from a widget that tells the visitor how it went
// (SPEC §11): the ratings widget (rating.js) now, the feedback dialog from
// M5. Usage statistics don't use it: events.js sends beacons and ignores the
// answer (SPEC §10.1).
//
// postJson(path, data, { keepalive }) POSTs `data` as JSON to a path on this
// site and resolves to the answer's HTTP status, or 0 when there is none: a
// network error, no answer within TIMEOUT_MS (the request is then aborted),
// or no window.fetch. It never rejects or throws, makes one attempt (no
// retries), never reads the answer's body and logs nothing. Only a 2xx status
// counts as sent (succeeded()); 404 (the API is off, as in production before
// the privacy go-ahead), 429 and 5xx are failures like a timeout. Credentials
// stay at fetch's default, so a preview behind Cloudflare Access keeps its
// sign-in cookie. The widget shows SEND_FAILED on any failure.

/** How long to wait for an answer before giving up (SPEC §11). */
export const TIMEOUT_MS = 5000;

/** The inline message for a failed send (SPEC §11), word for word. */
export const SEND_FAILED = "Couldn't send right now — please try again later";

/** Whether a status from postJson means the API accepted the request. */
export const succeeded = (status) => Number.isInteger(status) && status >= 200 && status < 300;

/**
 * POST `data` as JSON.
 * @param {string} path   a path on this site, e.g. '/api/rate'
 * @param {unknown} data  the body, sent as JSON
 * @param {{ keepalive?: boolean }} [options]  keepalive: let the request
 *   finish if the page is closed or left
 * @returns {Promise<number>} the HTTP status, or 0 without an answer
 */
export function postJson(path, data, { keepalive = false } = {}) {
  return new Promise((resolve) => {
    let timer;
    const finish = (status) => {
      window.clearTimeout(timer);
      resolve(status);
    };
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: keepalive === true,
      };
      if (controller) init.signal = controller.signal;
      timer = window.setTimeout(() => {
        finish(0);
        controller?.abort();
      }, TIMEOUT_MS);
      Promise.resolve(window.fetch(path, init)).then(
        (response) => finish(Number.isInteger(response?.status) ? response.status : 0),
        () => finish(0),
      );
    } catch {
      // No fetch, or it threw before sending.
      finish(0);
    }
  });
}
