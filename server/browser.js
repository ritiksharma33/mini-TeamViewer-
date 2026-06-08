/**
 * browser.js
 * Manages the Chromium Docker container lifecycle and bridges
 * Chrome DevTools Protocol (CDP) to WebSocket clients.
 *
 * Architecture:
 * Client (React) ←─── WebSocket ───→ This module ←─── CDP ───→ Docker/Chromium
 */

const { exec, execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

// ─── State ────────────────────────────────────────────────────────────────────

let browser = null;       // Puppeteer Browser instance
let page = null;          // Puppeteer Page instance
let cdpSession = null;    // Raw CDP session for screencast
let isRunning = false;    // Guard against double-start
let activeWs = null;      // The currently connected WebSocket client
let frameCount = 0;       // For server-side FPS calculation

// Current screencast settings (can be changed live by client)
let screencastConfig = {
  format: 'jpeg',
  quality: 60,
  maxWidth: 1280,
  maxHeight: 720,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Send a typed JSON message to the active WebSocket client.
 * Silently drops if socket is not open.
 */
function send(ws, payload) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      console.error('[WS] Send error:', e.message);
    }
  }
}

/**
 * Poll http://127.0.0.1:9222/json/version until Chromium's CDP endpoint
 * responds. Retries up to `retries` times with 500ms delay.
 */
async function waitForChromium(retries = 120) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[CDP] Attempt ${i + 1}`);

      // 🛑 BUGFIX: Added a 1-second timeout so fetch doesn't hang forever
      const res = await fetch('http://127.0.0.1:9222/json/version', {
        signal: AbortSignal.timeout(1000)
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[CDP] Connected');
        return data;
      }
    } catch (err) {
      // It's normal to fail here while Chromium boots. We just wait and loop.
      // Uncomment the line below if you want to see the exact fetch error:
      // console.log('[CDP] Not ready:', err.message);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error('Chromium did not become ready.');
}

// ─── Screencast ───────────────────────────────────────────────────────────────

/**
 * Start (or restart) the CDP screencast with current config.
 * Each frame arrives as base64-encoded JPEG and is forwarded to the client.
 */
async function startScreencast(ws) {
  if (!cdpSession) return;

  await cdpSession.send('Page.startScreencast', screencastConfig);

  cdpSession.on('Page.screencastFrame', async (event) => {
    frameCount++;

    // ACK every frame so Chromium knows we received it and sends the next one
    await cdpSession.send('Page.screencastFrameAck', {
      sessionId: event.sessionId,
    }).catch(() => {});

    // Forward frame to client with timestamp for latency calculation
    send(ws, {
      type: 'frame',
      data: event.data,          // base64 JPEG
      ts: Date.now(),            // client uses this for latency display
      metadata: event.metadata,  // { pageScaleFactor, offsetTop, deviceWidth, ... }
    });
  });

  console.log('[Screencast] Started');
}

/**
 * Stop the CDP screencast and remove the listener.
 */
async function stopScreencast() {
  if (!cdpSession) return;
  try {
    await cdpSession.send('Page.stopScreencast');
    cdpSession.removeAllListeners('Page.screencastFrame');
  } catch (e) {
    // Session may already be closed
  }
  console.log('[Screencast] Stopped');
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start the Docker container, wait for Chromium to be ready,
 * connect Puppeteer via CDP, and begin streaming frames.
 */
async function startBrowser(ws) {
  if (isRunning) {
    console.log('[Browser] Already running. Reattaching new client...');
    activeWs = ws; // Update to the new WebSocket connection
    
    // Stop the old stream and start a fresh one for the new page load
    await stopScreencast(); 
    await startScreencast(ws);
    
    // Tell the fresh frontend that we are already live!
    send(ws, { type: 'status', state: 'live', msg: 'Reconnected to active browser.' });
    
    // Send the current URL to the frontend so the URL bar updates
    if (page) {
      send(ws, { type: 'urlUpdate', url: page.url() });
    }
    return;
  }

  activeWs = ws;
  send(ws, { type: 'status', state: 'starting', msg: 'Spinning up Docker container...' });

  try {
    // 1. Start the Docker container
    console.log('[Docker] Starting container...');
    await new Promise((resolve, reject) => {
      exec(
        'docker run -d --rm --name bld-chromium -p 9222:9222 --shm-size=256mb bld-browser chromium --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --headless --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=* --window-size=1280,720 --user-data-dir=/tmp/chrome-data about:blank',
        (err, stdout, stderr) => {
          if (err) {
            if (stderr.includes('already in use')) {
              console.log('[Docker] Container already running, reusing it.');
              resolve();
            } else {
              reject(new Error(`Docker failed: ${stderr}`));
            }
          } else {
            console.log(`[Docker] Container started: ${stdout.trim()}`);
            resolve();
          }
        }
      );
    });

    // 2. Wait for Chromium's CDP endpoint to be reachable
    send(ws, { type: 'status', state: 'starting', msg: 'Waiting for Chromium to be ready...' });
    const { webSocketDebuggerUrl } = await waitForChromium();

    // 3. Connect Puppeteer to Chromium via CDP WebSocket
    send(ws, { type: 'status', state: 'starting', msg: 'Connecting to Chromium...' });
    browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
      defaultViewport: { width: 1280, height: 720 },
    });

    // 4. Get the default page (Chromium opens about:blank by default)
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // 5. Create a raw CDP session for screencast
    cdpSession = await page.createCDPSession();

    // 6. Handle browser crash / unexpected disconnect
    browser.on('disconnected', () => {
      console.log('[Browser] Disconnected unexpectedly');
      isRunning = false;
      send(activeWs, {
        type: 'status',
        state: 'error',
        msg: 'Browser disconnected unexpectedly. Click Start to reconnect.',
      });
      cleanup();
    });

    // 7. Start streaming frames
    isRunning = true;
    await startScreencast(ws);

    send(ws, {
      type: 'status',
      state: 'live',
      msg: 'Browser is live and streaming.',
    });

    console.log('[Browser] Ready and streaming');

  } catch (err) {
    console.error('[Browser] Start failed:', err.message);
    isRunning = false;
    await cleanup();
    send(ws, {
      type: 'status',
      state: 'error',
      msg: `Failed to start: ${err.message}`,
    });
  }
}

/**
 * Cleanly stop the screencast, disconnect Puppeteer, and kill the Docker container.
 */
async function stopBrowser(ws) {
  if (!isRunning) {
    send(ws, { type: 'status', state: 'stopped', msg: 'Browser was not running.' });
    return;
  }

  send(ws, { type: 'status', state: 'stopping', msg: 'Shutting down...' });
  isRunning = false;

  await cleanup();

  send(ws, { type: 'status', state: 'stopped', msg: 'Browser stopped.' });
  console.log('[Browser] Stopped cleanly');
}

/**
 * Internal cleanup — stops screencast, closes Puppeteer, kills Docker container.
 * Safe to call multiple times.
 */
async function cleanup() {
  try { await stopScreencast(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  try {
    execSync('docker stop bld-chromium 2>/dev/null || true');
    console.log('[Docker] Container stopped');
  } catch {}

  browser = null;
  page = null;
  cdpSession = null;
  frameCount = 0;
}

// ─── Input Handlers ───────────────────────────────────────────────────────────

const SPECIAL_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Control', 'Alt', 'Shift', 'Meta',
]);

// ─── Message Router ───────────────────────────────────────────────────────────

/**
 * Central handler for all incoming WebSocket messages from the client.
 */
// ─── Updated Message Router ───────────────────────────────────────────────────

async function handleMessage(ws, msg) {
  // 🐛 DEBUG LOG: Prints every single command EXCEPT mousemove to keep terminal clean
  if (msg.type !== 'mousemove') {
    console.log(`[WS] Received command: ${msg.type}`, msg);
  }

  if (msg.type === 'start') return await startBrowser(ws);
  if (msg.type === 'stop')  return await stopBrowser(ws);
  if (msg.type === 'ping')  return send(ws, { type: 'pong', ts: Date.now() });

  if (!page || !isRunning) {
    send(ws, { type: 'error', msg: 'Browser is not running. Click Start first.' });
    return;
  }

  try {
    switch (msg.type) {

      case 'navigate': {
        let url = msg.url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        console.log(`[Nav] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        send(ws, { type: 'navigated', url: page.url() });
        break;
      }

      case 'mousemove':
        await page.mouse.move(msg.x, msg.y);
        break;

      case 'click':
        await page.mouse.click(msg.x, msg.y, {
          button: msg.button === 2 ? 'right' : 'left',
          clickCount: msg.detail || 1,
        });
        break;

      case 'mousedown':
        await page.mouse.down({ button: msg.button === 2 ? 'right' : 'left' });
        break;

      case 'mouseup':
        await page.mouse.up({ button: msg.button === 2 ? 'right' : 'left' });
        break;

      case 'scroll':
        await page.mouse.wheel({ deltaX: msg.deltaX, deltaY: msg.deltaY });
        break;

      case 'keydown': {
        if (SPECIAL_KEYS.has(msg.key)) {
          await page.keyboard.down(msg.key);
        }
        break;
      }

      case 'keyup': {
        if (SPECIAL_KEYS.has(msg.key)) {
          await page.keyboard.up(msg.key);
        }
        break;
      }

      case 'keypress': {
        if (SPECIAL_KEYS.has(msg.key)) {
          await page.keyboard.press(msg.key);
        }
        else if (msg.ctrlKey || msg.metaKey) {
          const modifier = msg.metaKey ? 'Meta' : 'Control';
          await page.keyboard.down(modifier);
          await page.keyboard.press(msg.key.toUpperCase());
          await page.keyboard.up(modifier);
        }
        else if (msg.key.length === 1) {
          await page.keyboard.type(msg.key);
        }
        break;
      }

      case 'setQuality': {
        const quality = Math.max(10, Math.min(100, Number(msg.value)));
        screencastConfig = { ...screencastConfig, quality };
        await stopScreencast();
        cdpSession.removeAllListeners();
        await startScreencast(ws);
        console.log(`[Screencast] Quality set to ${quality}`);
        send(ws, { type: 'qualityChanged', value: quality });
        break;
      }

      case 'screenshot': {
        const png = await page.screenshot({ fullPage: false, encoding: 'base64' });
        send(ws, { type: 'screenshot', data: png, url: page.url() });
        console.log('[Screenshot] Captured');
        break;
      }

      case 'getUrl': {
        send(ws, { type: 'urlUpdate', url: page.url() });
        break;
      }

      default:
        console.warn(`[WS] Unknown message type: ${msg.type}`);
    }

  } catch (err) {
    console.error(`[Handler] Error on "${msg.type}":`, err.message);
    send(ws, { type: 'error', msg: err.message });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function getStats() {
  return { isRunning, frameCount };
}

// ─── Process cleanup ──────────────────────────────────────────────────────────

async function gracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal} — cleaning up...`);
  await cleanup();
  process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = { handleMessage, getStats, stopBrowser };