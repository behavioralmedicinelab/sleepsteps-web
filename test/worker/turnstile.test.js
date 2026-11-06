// Turnstile's Siteverify check (SPEC §14.3, worker/lib/turnstile.js): the
// request it makes, how each answer maps to 403 or 500, the timeout, and that
// it never throws or logs. Runs in workerd with a fetcher passed in, so
// nothing reaches Cloudflare. /api/feedback's use of it is in
// feedback.test.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REQUEST_ERRORS,
  SITEVERIFY_TIMEOUT_MS,
  SITEVERIFY_URL,
  TOKEN_ERRORS,
  UNAVAILABLE_REASONS,
  verifyTurnstile,
} from '../../worker/lib/turnstile.js';

const SECRET = 'zq-secret-0x4AAAAAAA-not-a-real-one';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX-zq';
const IP = '203.0.113.77';

let logged;
beforeEach(() => {
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
});
afterEach(() => {
  // verifyTurnstile never logs; the route logs its fixed outcome.
  expect(logged).toEqual([]);
  vi.restoreAllMocks();
});

/** A fetcher that records each call as a Request and answers with `answer()`. */
function recorder(answer = () => Response.json({ success: true, 'error-codes': [] })) {
  const calls = [];
  const fetcher = async (input, init) => {
    calls.push({ request: new Request(input, init), init });
    return answer();
  };
  return { calls, fetcher };
}

/** Verify with a fetcher that answers `body` (JSON unless a string) with `status`. */
async function answered(body, status = 200) {
  const { fetcher } = recorder(() =>
    typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status }),
  );
  return verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher });
}

/** A recorded request's form fields (read as bytes: workerd warns on .text() for a form). */
const formOf = async (request) => new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));

const refused = (code) => ({ ok: false, status: 500, log: 'siteverify refused the request', code });
const unavailable = (code) => ({ ok: false, status: 500, log: 'siteverify unavailable', code });

describe('the Siteverify request (SPEC §14.3)', () => {
  it("goes to Cloudflare's endpoint, with a 3-second limit", () => {
    expect(SITEVERIFY_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(SITEVERIFY_TIMEOUT_MS).toBe(3000);
  });

  it('is one form-encoded POST of the secret, the token and the IP address, and nothing else', async () => {
    const { calls, fetcher } = recorder();
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, remoteIp: IP, fetcher })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const [{ request, init }] = calls;
    expect(request.url).toBe(SITEVERIFY_URL);
    expect(request.method).toBe('POST');
    expect(request.headers.get('Content-Type')).toMatch(/^application\/x-www-form-urlencoded/);
    const form = await formOf(request);
    expect([...form]).toEqual([
      ['secret', SECRET],
      ['response', TOKEN],
      ['remoteip', IP],
    ]);
    // No idempotency_key: there is never a retry.
    expect(form.has('idempotency_key')).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['not a string', 203],
  ])('leaves remoteip out when the IP address is %s', async (_, remoteIp) => {
    const { calls, fetcher } = recorder();
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, remoteIp, fetcher })).toEqual({ ok: true });
    const form = await formOf(calls[0].request);
    expect([...form.keys()]).toEqual(['secret', 'response']);
  });

  it('encodes a token with characters that mean something in a form', async () => {
    const token = 'a+b/c=d&remoteip=1.2.3.4 é';
    const { calls, fetcher } = recorder();
    await verifyTurnstile({ token, secret: SECRET, fetcher });
    const form = await formOf(calls[0].request);
    expect(form.getAll('response')).toEqual([token]);
    expect(form.has('remoteip')).toBe(false);
  });

  it("uses the global fetch when no fetcher is given, looked up when called (so tests can mock it)", async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: true }));
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET })).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(SITEVERIFY_URL);
  });
});

describe('the answer: only success === true passes; the rest fail closed', () => {
  it('passes a 2xx answer whose success is exactly true', async () => {
    expect(await answered({ success: true, 'error-codes': [], hostname: 'example.com' })).toEqual({ ok: true });
    expect(await answered({ success: true })).toEqual({ ok: true });
    // A test secret always answers example.com; neither hostname nor action is checked.
    expect(await answered({ success: true, hostname: 'zq-elsewhere.example', action: 'other' })).toEqual({ ok: true });
  });

  it.each([
    ['success false, no codes', { success: false }],
    ['success false, an empty list', { success: false, 'error-codes': [] }],
    ['success "true" (a string)', { success: 'true' }],
    ['success 1', { success: 1 }],
    ['no success key', { 'error-codes': [] }],
    ['an empty object', {}],
    ...TOKEN_ERRORS.map((code) => [code, { success: false, 'error-codes': [code] }]),
    ['two token codes', { success: false, 'error-codes': ['invalid-input-response', 'timeout-or-duplicate'] }],
    ['success "yes" with a token code', { success: 'yes', 'error-codes': ['timeout-or-duplicate'] }],
  ])('refuses the token (403) for %s', async (_, body) => {
    expect(await answered(body)).toEqual({ ok: false, status: 403 });
  });

  it('lists the token codes, request codes and unavailable reasons it knows', () => {
    expect(TOKEN_ERRORS).toEqual(['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response']);
    expect(REQUEST_ERRORS).toEqual(['missing-input-secret', 'invalid-input-secret', 'bad-request']);
    expect(UNAVAILABLE_REASONS).toEqual(['internal-error', 'timeout', 'network', 'bad-response', 'other']);
    for (const list of [TOKEN_ERRORS, REQUEST_ERRORS, UNAVAILABLE_REASONS]) expect(Object.isFrozen(list)).toBe(true);
  });

  it.each(REQUEST_ERRORS)('answers 500 when Siteverify refuses our request: %s', async (code) => {
    expect(await answered({ success: false, 'error-codes': [code] })).toEqual(refused(code));
    // Checked before the token's codes: a wrong secret makes every token fail.
    expect(await answered({ success: false, 'error-codes': ['invalid-input-response', code] })).toEqual(refused(code));
    // And whatever the HTTP status.
    expect(await answered({ success: false, 'error-codes': [code] }, 400)).toEqual(refused(code));
  });

  it('logs only a code from its own list, never one Siteverify made up', async () => {
    expect(await answered({ success: false, 'error-codes': ['zq-made-up', 'bad-request'] })).toEqual(refused('bad-request'));
    expect(await answered({ success: false, 'error-codes': ['zq-made-up'] })).toEqual(unavailable('other'));
  });

  it.each([
    ['internal-error', { success: false, 'error-codes': ['internal-error'] }, 'internal-error'],
    ['internal-error with a token code', { success: false, 'error-codes': ['timeout-or-duplicate', 'internal-error'] }, 'internal-error'],
    ['an unknown code', { success: false, 'error-codes': ['zq-new-code'] }, 'other'],
    ['an unknown code with a token code', { success: false, 'error-codes': ['invalid-input-response', 'zq-new-code'] }, 'other'],
    ['a code that is not a string', { success: false, 'error-codes': [42] }, 'other'],
    ['error-codes that is a string, not a list', { success: false, 'error-codes': 'invalid-input-response' }, 'bad-response'],
    ['error-codes that is an object', { success: false, 'error-codes': {} }, 'bad-response'],
    ['JSON null', null, 'bad-response'],
    ['a JSON list', [{ success: true }], 'bad-response'],
    ['a JSON number', 1, 'bad-response'],
    ['a JSON string', 'success', 'bad-response'],
    ['JSON true', true, 'bad-response'],
  ])('answers 500 when Siteverify gives no usable answer: %s', async (_, body, code) => {
    const { fetcher } = recorder(() => new Response(JSON.stringify(body), { status: 200 }));
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher })).toEqual(unavailable(code));
  });

  it.each([
    ['text that is not JSON', 'zq not json', 200],
    ['an empty body', '', 200],
    ['an HTML error page with HTTP 500', '<html>zq error</html>', 500],
    ['HTTP 502 with no body', '', 502],
  ])('answers 500 for %s', async (_, text, status) => {
    expect(await answered(text, status)).toEqual(unavailable('bad-response'));
  });

  it.each([
    ['success true', { success: true }],
    ['an empty object', {}],
    ['success false with no codes', { success: false, 'error-codes': [] }],
  ])('answers 500 for a non-2xx status with %s', async (_, body) => {
    for (const status of [400, 429, 500, 503]) expect(await answered(body, status), String(status)).toEqual(unavailable('bad-response'));
  });

  it("follows a non-2xx answer's own codes when it gives them", async () => {
    expect(await answered({ success: false, 'error-codes': ['invalid-input-response'] }, 400)).toEqual({ ok: false, status: 403 });
    expect(await answered({ success: false, 'error-codes': ['internal-error'] }, 500)).toEqual(unavailable('internal-error'));
  });
});

describe('no answer (SPEC §14.3): 500, never a throw', () => {
  it('answers 500 "network" when the fetch rejects, whatever it rejects with', async () => {
    const hostile = {
      get name() {
        throw new Error('zq hostile name');
      },
    };
    for (const error of [new TypeError(`Network connection lost ${TOKEN}`), new Error('zq'), 'zq string', undefined, hostile]) {
      const fetcher = async () => {
        throw error;
      };
      expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher })).toEqual(unavailable('network'));
    }
  });

  it('answers 500 "network" when the fetcher throws before returning a promise, or returns nothing', async () => {
    const throws = () => {
      throw new Error('zq sync');
    };
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher: throws })).toEqual(unavailable('network'));
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher: async () => undefined })).toEqual(unavailable('network'));
  });

  it('answers 500 "network" when the body fails while being read', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new Error('zq body broke'));
      },
    });
    const fetcher = async () => new Response(body);
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher })).toEqual(unavailable('network'));
  });

  it('gives up after the timeout when the fetch never answers, and aborts it', async () => {
    let signal;
    const fetcher = (_, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    };
    const started = Date.now();
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher, timeoutMs: 20 })).toEqual(unavailable('timeout'));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal.aborted).toBe(true);
    expect(signal.reason?.name).toBe('TimeoutError');
  });

  it('gives up after the timeout even when the fetcher ignores the signal', async () => {
    const fetcher = () => new Promise(() => {});
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher, timeoutMs: 20 })).toEqual(unavailable('timeout'));
  });

  it('gives up after the timeout when the answer starts but its body never ends', async () => {
    const fetcher = async () => new Response(new ReadableStream({ pull() {} }), { status: 200 });
    const started = Date.now();
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher, timeoutMs: 20 })).toEqual(unavailable('timeout'));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is not cut short by its timeout when the answer comes in time', async () => {
    const fetcher = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ success: true });
    };
    expect(await verifyTurnstile({ token: TOKEN, secret: SECRET, fetcher, timeoutMs: 200 })).toEqual({ ok: true });
    // The timer firing later rejects nothing anyone sees.
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
});
