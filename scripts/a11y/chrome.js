// Finds and drives the Mac's own Google Chrome over the DevTools protocol
// (CDP), with Node's built-in WebSocket: no puppeteer or other package. For
// `npm run test:a11y` only (SPEC §20 M7); Workers Builds has no Chrome.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * CHROME_PATH if set, else the Mac's Chrome, if it is an executable file
 * (not, say, the .app bundle, a folder); else null.
 */
export function findChrome(env = process.env) {
  const candidate = env.CHROME_PATH || MAC_CHROME;
  try {
    if (!statSync(candidate).isFile()) return null;
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long one DevTools command may take before the run gives up on it. */
const COMMAND_TIMEOUT_MS = 30000;

/**
 * Starts headless Chrome with a throwaway profile and connects to it.
 * `hostRules` maps names such as a1.localhost to this machine.
 */
export async function launchChrome(executable, { hostRules = 'MAP *.localhost 127.0.0.1' } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'sleepsteps-a11y-chrome-'));
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--host-resolver-rules=${hostRules}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // A spawn that fails (no such file, not executable) emits 'error', which
  // would otherwise be thrown as an uncaught exception.
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  const portFile = path.join(profile, 'DevToolsActivePort');
  let endpoint = null;
  for (let i = 0; i < 200 && !endpoint; i += 1) {
    if (child.exitCode !== null || spawnError) break;
    if (existsSync(portFile)) {
      const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
    }
    if (!endpoint) await sleep(50);
  }
  if (!endpoint) {
    child.kill();
    rmSync(profile, { recursive: true, force: true });
    throw new Error(`Chrome didn't start (${executable})${spawnError ? `: ${spawnError.code ?? spawnError.message}` : ''}`);
  }
  // If the run is interrupted (Ctrl+C, an uncaught error), don't leave
  // Chrome running.
  const stop = () => {
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      stop();
      rmSync(profile, { recursive: true, force: true });
      process.exit(130);
    });
  }
  let browser;
  let version;
  try {
    browser = await connect(endpoint);
    version = (await browser.send('Browser.getVersion')).product;
  } catch (error) {
    stop();
    rmSync(profile, { recursive: true, force: true });
    throw new Error(`Chrome started but the DevTools connection failed (${executable}): ${error.message}`);
  }
  return {
    browser,
    version,
    async close() {
      await browser.send('Browser.close').catch(() => {});
      browser.ws.close();
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * One WebSocket to the browser; commands and events carry a sessionId for
 * each tab. Every command settles: with Chrome's answer, after
 * `timeout` ms, or as soon as the connection closes (Chrome quit or
 * crashed), so a run never hangs on a dead browser.
 */
export async function connect(endpoint, { timeout = COMMAND_TIMEOUT_MS } = {}) {
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`can't connect to ${endpoint}`)), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const failAll = (why) => {
    for (const { reject, method, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(`${method}: ${why}`));
    }
    pending.clear();
  };
  ws.addEventListener('close', () => failAll('Chrome closed the connection'));
  ws.addEventListener('error', () => failAll('the connection to Chrome failed'));
  ws.addEventListener('message', (message) => {
    const data = JSON.parse(message.data);
    if (data.id !== undefined && pending.has(data.id)) {
      const { resolve, reject, method, timer } = pending.get(data.id);
      clearTimeout(timer);
      pending.delete(data.id);
      if (data.error) reject(new Error(`${method}: ${data.error.message}`));
      else resolve(data.result);
    } else if (data.method) {
      for (const listener of listeners) listener(data);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`${method}: the connection to Chrome is closed`));
        return;
      }
      nextId += 1;
      const id = nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no answer from Chrome within ${timeout / 1000} seconds`));
      }, timeout);
      pending.set(id, { resolve, reject, method, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, send, listeners };
}

const KEYS = {
  Tab: 9,
  Enter: 13,
  Escape: 27,
  Space: 32,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

/**
 * A new tab: navigation, evaluation, keys, and a record of what the page
 * reported (exceptions, console calls, log entries, CSP violations and
 * failed requests), read and cleared with `takeReport()`.
 */
export async function openTab(browser) {
  // A window of its own, brought to the front, so the page is visible and
  // focused: a background tab is "hidden", and Chrome slows its timers.
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  let report = freshReport();
  const requests = new Map();
  const waiters = new Set();
  const listener = ({ method, params, sessionId: from }) => {
    if (from !== sessionId) return;
    for (const waiter of waiters) waiter(method, params);
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      report.exceptions.push(`${d.exception?.description?.split('\n')[0] ?? d.text} (${d.url ?? 'no url'})`);
    } else if (method === 'Runtime.consoleAPICalled') {
      const frame = params.stackTrace?.callFrames?.[0];
      report.console.push({ type: params.type, url: frame?.url ?? '', text: params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    } else if (method === 'Log.entryAdded') {
      const { level, source, text, url } = params.entry;
      report.log.push({ level, source, text: text.slice(0, 300), url: url ?? '' });
    } else if (method === 'Network.requestWillBeSent') {
      requests.set(params.requestId, { url: params.request.url, method: params.request.method, type: params.type });
    } else if (method === 'Network.responseReceived') {
      const request = requests.get(params.requestId) ?? {};
      if (params.response.status >= 400) report.failed.push({ url: params.response.url, status: params.response.status, method: request.method, type: params.type });
    } else if (method === 'Network.loadingFailed') {
      const request = requests.get(params.requestId) ?? {};
      if (!params.canceled) report.failed.push({ url: request.url ?? '', status: 0, error: params.errorText, blocked: params.blockedReason, method: request.method, type: params.type });
    }
  };
  browser.listeners.add(listener);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // Our pages never set a global with this name. A CDP script isn't subject
  // to the page's CSP, and its listener sees every violation, enforced or
  // report-only.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('securitypolicyviolation', (e) => { (window.__a11yCsp ||= []).push(e.violatedDirective + ' blocked ' + (e.blockedURI || 'inline') + ' at ' + e.sourceFile + ':' + e.lineNumber); });`,
  });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`.slice(0, 600));
    }
    return result.result.value;
  };

  const once = (event, timeout = 15000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`timed out waiting for ${event}`));
      }, timeout);
      const waiter = (method, params) => {
        if (method !== event) return;
        clearTimeout(timer);
        waiters.delete(waiter);
        resolve(params);
      };
      waiters.add(waiter);
    });

  async function navigate(url, { width = 1280, height = 900, js = true } = {}) {
    await send('Emulation.setScriptExecutionDisabled', { value: !js });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // Animations (the view slider, menus) end at once, so axe never meets
    // a colour half-way through a transition.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const loaded = once('Page.loadEventFired');
    const { errorText } = await send('Page.navigate', { url });
    if (errorText) throw new Error(`navigate ${url}: ${errorText}`);
    await loaded;
    await sleep(300);
  }

  async function key(name, { shift = false } = {}) {
    const code = KEYS[name];
    const base = { key: name === 'Space' ? ' ' : name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (name === 'Enter' || name === 'Space') await send('Input.dispatchKeyEvent', { type: 'char', ...base, text: name === 'Enter' ? '\r' : ' ' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(25);
  }

  async function type(text) {
    await send('Input.insertText', { text });
    await sleep(50);
  }

  /** Clicks the centre of the first element matching `selector`, as a mouse would. */
  async function click(selector) {
    const point = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) throw new Error(`no element matches ${selector}`);
    for (const event of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type: event, x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    await sleep(200);
  }

  /** Waits until `expression` is truthy in the page; false if it never is. */
  async function waitFor(expression, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  }

  /**
   * The addresses of the frames from other sites in the browser (YouTube's,
   * Turnstile's). They run in processes of their own, so the page's frame
   * tree doesn't list them; the runner keeps one tab open at a time.
   */
  async function thirdPartyFrames() {
    const { targetInfos } = await browser.send('Target.getTargets');
    return targetInfos.filter((t) => t.type === 'iframe').map((t) => t.url);
  }

  async function takeReport() {
    const csp = await evaluate('window.__a11yCsp ?? []').catch(() => []);
    const out = { ...report, csp: [...report.csp, ...csp] };
    report = freshReport();
    await evaluate('window.__a11yCsp = []').catch(() => {});
    return out;
  }

  return {
    send,
    evaluate,
    navigate,
    key,
    type,
    click,
    waitFor,
    thirdPartyFrames,
    sleep,
    takeReport,
    async close() {
      browser.listeners.delete(listener);
      await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    },
  };
}

function freshReport() {
  return { exceptions: [], console: [], log: [], csp: [], failed: [] };
}
