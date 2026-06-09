/**
 * browser.js
 * Multi-Tab Cloud Browser Engine
 */

const { exec, execSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const crypto = require('crypto'); // Used to generate unique Tab IDs
const fs = require('fs');         // Used to read the local image
const path = require('path');     // Used to resolve the image path safely

// ─── State ────────────────────────────────────────────────────────────────────

let browser = null;       
let tabs = new Map();     // 🚀 Stores all open tabs: Map<tabId, { page, cdpSession }>
let activeTabId = null;   // 🚀 Tracks which tab is currently visible
let isRunning = false;    
let activeWs = null;      
let frameCount = 0;       

let inactivityTimer = null;
let statsInterval = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let screencastConfig = { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 720 };

// ─── Start Screen & Base64 Image Injection ────────────────────────────────────

const imagePath = path.join(__dirname, 'Lose_Yourself.jpg');
let backgroundImageData = '';

try {
  // Read the local image and convert it to a Base64 data string
  const imageBuffer = fs.readFileSync(imagePath);
  backgroundImageData = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
} catch (err) {
  console.error('[System] Could not load background image:', err.message);
}

// The custom sleek dashboard HTML
const startScreenHTML = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body { 
        margin: 0; 
        background-color: #0a0a0b; 
        background-image: url('${backgroundImageData}'); 
        background-size: cover; 
        background-position: center; 
        height: 80vh; 
        overflow: hidden; /* 🚀 FIX 1: strictly prevents any scrollbars */
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        justify-content: center; 
        font-family: monospace; 
      }
      .overlay { 
        background: rgba(10, 10, 11, 0.85); 
        padding: 24px 40px; /* 🚀 FIX 2: smaller padding (was 40px 60px) */
        border-radius: 12px; 
        border: 1px solid rgba(0, 229, 255, 0.2); 
        text-align: center; 
        backdrop-filter: blur(10px); 
      }
      h1 { 
        color: #ffffff; 
        margin-bottom: 8px; 
        font-size: 2.5rem; 
      }
      p { 
        color: #00e5ff; 
        font-size: 1.2rem; 
        margin: 0; 
      }
    </style>
  </head>
  <body>
    <div class="overlay">
      <h1>ENGINE ONLINE</h1>
      <p>Awaiting Navigation...</p>
    </div>
  </body>
  </html>
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(payload)); } catch (e) {}
  }
}

async function waitForChromium(retries = 120) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return await res.json();
    } catch (err) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Chromium did not become ready.');
}

function resetInactivityTimer(ws) {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(async () => {
    console.log('[System] Session paused due to inactivity. Cleaning up Docker.');
    send(ws, { type: 'status', state: 'stopped', msg: 'Session paused due to inactivity.' });
    await stopBrowser(ws);
  }, IDLE_TIMEOUT_MS);
}

// 🚀 Helper to setup a new tab and its listeners
async function setupNewTab(newPage) {
  const tabId = crypto.randomUUID();
  await newPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

  await newPage.evaluateOnNewDocument(() => {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.target === '_blank') link.target = '_self'; 
    }, true);
  });

  newPage.on('framenavigated', (frame) => {
    if (frame === newPage.mainFrame() && activeWs && activeTabId === tabId) {
      send(activeWs, { type: 'urlUpdate', url: frame.url() });
    }
  });

  const cdp = await newPage.createCDPSession();
  tabs.set(tabId, { page: newPage, cdpSession: cdp });
  return tabId;
}

// ─── Screencast ───────────────────────────────────────────────────────────────

async function startScreencast(ws) {
  const active = tabs.get(activeTabId);
  if (!active || !active.cdpSession) return;
  const cdp = active.cdpSession;

  await cdp.send('Page.startScreencast', screencastConfig);

  cdp.on('Page.screencastFrame', async (event) => {
    frameCount++;
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});

    if (ws && ws.readyState === 1) {
      try {
        const jpegBuffer = Buffer.from(event.data, 'base64');
        const tsBuffer = Buffer.alloc(8);
        tsBuffer.writeDoubleBE(Date.now(), 0);
        ws.send(Buffer.concat([tsBuffer, jpegBuffer]), { binary: true });
      } catch (e) {}
    }
  });
}

async function stopScreencast() {
  const active = tabs.get(activeTabId);
  if (!active || !active.cdpSession) return;
  try {
    await active.cdpSession.send('Page.stopScreencast');
    active.cdpSession.removeAllListeners('Page.screencastFrame');
  } catch (e) {}
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

async function startBrowser(ws) {
  if (isRunning) {
    activeWs = ws; 
    await stopScreencast(); 
    await startScreencast(ws);
    send(ws, { type: 'status', state: 'live', msg: 'Reconnected to active browser.' });
    send(ws, { type: 'tabs_update', tabs: Array.from(tabs.keys()), activeTabId });
    if (tabs.has(activeTabId)) send(ws, { type: 'urlUpdate', url: tabs.get(activeTabId).page.url() });
    return;
  }

  activeWs = ws;
  send(ws, { type: 'status', state: 'starting', msg: 'Spinning up container...' });

  try {
    console.log('\n[Docker] Allocating container resources...');
    await new Promise((resolve, reject) => {
      exec('docker run -d --rm --name bld-chromium -p 9222:9222 --shm-size=256mb bld-browser chromium --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --headless --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=* --window-size=1280,720 --user-data-dir=/tmp/chrome-data about:blank',
        (err, stdout, stderr) => err && !stderr.includes('already in use') ? reject(err) : resolve()
      );
    });
    console.log('[Docker] Container running successfully.');

    statsInterval = setInterval(() => {
      if (!isRunning) return clearInterval(statsInterval);
      exec('docker stats bld-chromium --no-stream --format "{{.CPUPerc}}::{{.MemUsage}}"', (err, stdout) => {
        if (!err && stdout && activeWs) send(activeWs, { type: 'server_stats', cpu: stdout.split('::')[0], mem: stdout.split('::')[1].trim() });
      });
    }, 2000);

    console.log('[CDP] Establishing secure connection to Chromium...');
    const { webSocketDebuggerUrl } = await waitForChromium();
    browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl, defaultViewport: null });

    const pages = await browser.pages();
    activeTabId = await setupNewTab(pages[0] || await browser.newPage());
    
    await tabs.get(activeTabId).page.setContent(startScreenHTML);
    send(ws, { type: 'urlUpdate', url: '' });

    // 🚀 Send the initial tab list to React
    send(ws, { type: 'tabs_update', tabs: Array.from(tabs.keys()), activeTabId });

    browser.on('disconnected', () => { isRunning = false; cleanup(); });

    isRunning = true;
    resetInactivityTimer(ws);
    await startScreencast(ws);
    send(ws, { type: 'status', state: 'live', msg: 'Browser is live.' });
    console.log('[System] Multi-tab routing engine online and streaming.');

  } catch (err) {
    console.error('[Error] Failed to initialize container:', err.message);
    isRunning = false;
    await cleanup();
    send(ws, { type: 'status', state: 'error', msg: `Failed to start: ${err.message}` });
  }
}

async function stopBrowser(ws) {
  if (!isRunning) return;
  isRunning = false;
  console.log('[System] Shutting down session...');
  await cleanup();
  send(ws, { type: 'status', state: 'stopped', msg: 'Browser stopped.' });
}

async function cleanup() {
  if (statsInterval) clearInterval(statsInterval);
  if (inactivityTimer) clearTimeout(inactivityTimer);
  try { await stopScreencast(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  try { 
    console.log('[Docker] Terminating container bld-chromium...');
    execSync('docker stop bld-chromium 2>/dev/null || true'); 
    console.log('[Docker] Container destroyed cleanly.');
  } catch {}
  browser = null; tabs.clear(); activeTabId = null; frameCount = 0;
}

// ─── Message Router ───────────────────────────────────────────────────────────
// ─── Message Router ───────────────────────────────────────────────────────────

const SPECIAL_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Control', 'Alt', 'Shift', 'Meta']);

// 🚀 NEW: Smart Logger State Variables
let lastLogType = null;
let consecutiveLogCount = 0;
const MAX_CONSECUTIVE_LOGS = 4;

async function handleMessage(ws, msg) {
  // 🚀 The Smart Logger Logic
  const SPAM_EVENTS = ['mousemove', 'scroll', 'ping', 'server_stats', 'mousedown', 'mouseup'];
  
  if (SPAM_EVENTS.includes(msg.type)) {
    if (lastLogType === msg.type) {
      consecutiveLogCount++;
      if (consecutiveLogCount <= MAX_CONSECUTIVE_LOGS) {
        console.log(`[Router] Executing command: ${msg.type.toUpperCase()}`);
      } else if (consecutiveLogCount === MAX_CONSECUTIVE_LOGS + 1) {
        // Print a subtle indicator that the rest are being muted
        console.log(`[Router] ... further ${msg.type.toUpperCase()} commands muted for clean terminal.`);
      }
    } else {
      // It's a spam event, but a DIFFERENT one from the last. Reset and log.
      lastLogType = msg.type;
      consecutiveLogCount = 1;
      console.log(`[Router] Executing command: ${msg.type.toUpperCase()}`);
    }
  } else {
    // It's a high-value event (like NAVIGATE or START). Log it and reset the spam counter!
    lastLogType = msg.type;
    consecutiveLogCount = 1;
    console.log(`[Router] Executing command: ${msg.type.toUpperCase()}`);
  }

  // ... [The rest of your handleMessage function stays EXACTLY the same below this]
  if (isRunning) resetInactivityTimer(ws);
  if (msg.type === 'start') return await startBrowser(ws);
  if (msg.type === 'stop')  return await stopBrowser(ws);
  
  const active = tabs.get(activeTabId);
  const page = active ? active.page : null;
  if (!page && !['new_tab'].includes(msg.type)) return;


  try {
    switch (msg.type) {
      
      // 🚀 TAB MANAGEMENT COMMANDS
      case 'new_tab': {
        const newPage = await browser.newPage();
        const newId = await setupNewTab(newPage);
        await stopScreencast();
        activeTabId = newId;
        await newPage.setContent(startScreenHTML);
        await startScreencast(ws);
        send(ws, { type: 'tabs_update', tabs: Array.from(tabs.keys()), activeTabId });
        send(ws, { type: 'urlUpdate', url: '' });
        break;
      }
      case 'switch_tab': {
        if (tabs.has(msg.id) && activeTabId !== msg.id) {
          await stopScreencast();
          activeTabId = msg.id;
          await startScreencast(ws);
          send(ws, { type: 'tabs_update', tabs: Array.from(tabs.keys()), activeTabId });
          const url = tabs.get(msg.id).page.url();
          send(ws, { type: 'urlUpdate', url: url.includes('about:blank') ? '' : url });
        }
        break;
      }
      case 'close_tab': {
        if (!tabs.has(msg.id)) break;
        await tabs.get(msg.id).page.close();
        tabs.delete(msg.id);
        
        if (tabs.size === 0) {
          await stopBrowser(ws);
          break;
        }
        if (activeTabId === msg.id) {
          activeTabId = Array.from(tabs.keys()).pop(); // Switch to last open tab
          await startScreencast(ws);
          send(ws, { type: 'urlUpdate', url: tabs.get(activeTabId).page.url() });
        }
        send(ws, { type: 'tabs_update', tabs: Array.from(tabs.keys()), activeTabId });
        break;
      }

      // STANDARD BROWSER COMMANDS (Routed to active tab)
      case 'navigate': {
        let url = msg.url.trim();
        if (!url.startsWith('http')) url = 'https://' + url;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        send(ws, { type: 'urlUpdate', url: page.url() });
        break;
      }
      case 'go_back': await page.goBack(); send(ws, { type: 'urlUpdate', url: page.url() }); break;
      case 'go_forward': await page.goForward(); send(ws, { type: 'urlUpdate', url: page.url() }); break;
      case 'mousemove': await page.mouse.move(msg.x, msg.y); break;
      case 'click': await page.mouse.click(msg.x, msg.y, { button: msg.button === 2 ? 'right' : 'left' }); break;
      case 'mousedown': await page.mouse.down({ button: msg.button === 2 ? 'right' : 'left' }); break;
      case 'mouseup': await page.mouse.up({ button: msg.button === 2 ? 'right' : 'left' }); break;
      case 'scroll': await page.mouse.wheel({ deltaX: msg.deltaX, deltaY: msg.deltaY }); break;
      case 'keydown': if (SPECIAL_KEYS.has(msg.key)) await page.keyboard.down(msg.key); break;
      case 'keyup': if (SPECIAL_KEYS.has(msg.key)) await page.keyboard.up(msg.key); break;
      case 'keypress': {
        if (SPECIAL_KEYS.has(msg.key)) await page.keyboard.press(msg.key);
        else if (msg.ctrlKey || msg.metaKey) {
          const mod = msg.metaKey ? 'Meta' : 'Control';
          await page.keyboard.down(mod); await page.keyboard.press(msg.key.toUpperCase()); await page.keyboard.up(mod);
        } else if (msg.key.length === 1) await page.keyboard.type(msg.key);
        break;
      }
    }
  } catch (err) {
    send(ws, { type: 'error', msg: err.message });
  }
}

module.exports = { handleMessage, stopBrowser };