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

// FinOps & Monitoring State
let inactivityTimer = null;
let statsInterval = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Current screencast settings
let screencastConfig = {
  format: 'jpeg',
  quality: 60,
  maxWidth: 1280,
  maxHeight: 720,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      console.error('[WS] Send error:', e.message);
    }
  }
}

async function waitForChromium(retries = 120) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[CDP] Attempt ${i + 1}`);
      const res = await fetch('http://127.0.0.1:9222/json/version', {
        signal: AbortSignal.timeout(1000)
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[CDP] Connected');
        return data;
      }
    } catch (err) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Chromium did not become ready.');
}

// Resets the auto-destruct timer on every user interaction
function resetInactivityTimer(ws) {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  
  inactivityTimer = setTimeout(async () => {
    console.log('[System] User inactive for 5 minutes. Shutting down container to save resources.');
    send(ws, { type: 'status', state: 'stopped', msg: 'Session paused due to inactivity.' });
    await stopBrowser(ws);
  }, IDLE_TIMEOUT_MS);
}

// ─── Screencast ───────────────────────────────────────────────────────────────

async function startScreencast(ws) {
  if (!cdpSession) return;

  await cdpSession.send('Page.startScreencast', screencastConfig);

  cdpSession.on('Page.screencastFrame', async (event) => {
    frameCount++;

    await cdpSession.send('Page.screencastFrameAck', {
      sessionId: event.sessionId,
    }).catch(() => {});

    if (ws && ws.readyState === 1) {
      try {
        const jpegBuffer = Buffer.from(event.data, 'base64');
        const tsBuffer = Buffer.alloc(8);
        tsBuffer.writeDoubleBE(Date.now(), 0);
        const binaryPacket = Buffer.concat([tsBuffer, jpegBuffer]);
        ws.send(binaryPacket, { binary: true });
      } catch (e) {
        console.error('[Binary Stream] Error packing frame:', e.message);
      }
    }
  });

  console.log('[Screencast] Started in Binary Mode');
}

async function stopScreencast() {
  if (!cdpSession) return;
  try {
    await cdpSession.send('Page.stopScreencast');
    cdpSession.removeAllListeners('Page.screencastFrame');
  } catch (e) {}
  console.log('[Screencast] Stopped');
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

async function startBrowser(ws) {
  if (isRunning) {
    console.log('[Browser] Already running. Reattaching new client...');
    activeWs = ws; 
    
    await stopScreencast(); 
    await startScreencast(ws);
    
    send(ws, { type: 'status', state: 'live', msg: 'Reconnected to active browser.' });
    
    if (page) {
      send(ws, { type: 'urlUpdate', url: page.url() });
    }
    return;
  }

  activeWs = ws;
  send(ws, { type: 'status', state: 'starting', msg: 'Spinning up Docker container...' });

  try {
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

    // Start Live Docker Telemetry
    statsInterval = setInterval(() => {
      if (!isRunning) return clearInterval(statsInterval);
      exec('docker stats bld-chromium --no-stream --format "{{.CPUPerc}}::{{.MemUsage}}"', (err, stdout) => {
        if (!err && stdout && activeWs) {
          const [cpu, mem] = stdout.trim().split('::');
          send(activeWs, { type: 'server_stats', cpu, mem });
        }
      });
    }, 2000);

    send(ws, { type: 'status', state: 'starting', msg: 'Waiting for Chromium to be ready...' });
    const { webSocketDebuggerUrl } = await waitForChromium();

    send(ws, { type: 'status', state: 'starting', msg: 'Connecting to Chromium...' });
    browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 }, // Crisp Resolution!
    });

    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

    // 🚀 Force all "New Tab" links to open in the current tab
    await page.evaluateOnNewDocument(() => {
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.target === '_blank') {
          link.target = '_self'; 
        }
      }, true);
    });

    // 🚀 Auto-sync the URL bar when the user clicks a native link
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && activeWs) {
        send(activeWs, { type: 'urlUpdate', url: frame.url() });
      }
    });

    cdpSession = await page.createCDPSession();
   
    // 🚀 NEW: Image-Based Start Screen (No fake URLs!)
    const startScreenHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            background-color: #0a0a0b;
            /* Put a cool tech/abstract image URL here! */
            background-image: url('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070&auto=format&fit=crop');
            background-size: cover;
            background-position: center;
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: monospace;
          }
          .overlay {
            background: rgba(10, 10, 11, 0.85);
            padding: 40px 60px;
            border-radius: 16px;
            border: 1px solid rgba(0, 229, 255, 0.2);
            text-align: center;
            backdrop-filter: blur(10px);
          }
          h1 { color: #ffffff; margin-bottom: 10px; font-size: 2rem; }
          p { color: #00e5ff; font-size: 1.2rem; margin: 0; }
        </style>
      </head>
      <body>
        <div class="overlay">
          <h1>BLD ENGINE ONLINE</h1>
          <p>Awaiting Navigation...</p>
        </div>
      </body>
      </html>
    `;
    
    // Inject the image and CSS directly into the blank page
    await page.setContent(startScreenHTML);
    
    // Send an EMPTY string back to React!
    // This makes your UI's URL bar blank so the user can just click and type.
    if (activeWs) {
      send(activeWs, { type: 'urlUpdate', url: '' });
    }

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

    isRunning = true;
    resetInactivityTimer(ws); // Start the AFK clock
    await startScreencast(ws);

    send(ws, { type: 'status', state: 'live', msg: 'Browser is live and streaming.' });
    console.log('[Browser] Ready and streaming');

  } catch (err) {
    console.error('[Browser] Start failed:', err.message);
    isRunning = false;
    await cleanup();
    send(ws, { type: 'status', state: 'error', msg: `Failed to start: ${err.message}` });
  }
}

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

async function cleanup() {
  if (statsInterval) clearInterval(statsInterval);
  if (inactivityTimer) clearTimeout(inactivityTimer);
  
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

async function handleMessage(ws, msg) {
  if (msg.type !== 'mousemove') {
    console.log(`[WS] Received command: ${msg.type}`, msg);
  }

  // Any incoming message resets the AFK timer
  if (isRunning) resetInactivityTimer(ws);

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
      
      // Native Back and Forward logic
      case 'go_back': {
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        send(ws, { type: 'urlUpdate', url: page.url() });
        break;
      }

      case 'go_forward': {
        await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
        send(ws, { type: 'urlUpdate', url: page.url() });
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