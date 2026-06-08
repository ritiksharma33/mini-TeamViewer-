# Remote Browser Control — BLD Assignment

A mini TeamViewer for the browser. Spin up a headless Chromium instance inside Docker,
stream its screen to a web UI in real time, and control it with your mouse and keyboard.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Machine                            │
│                                                                 │
│  ┌──────────────┐   WebSocket    ┌──────────────────────────┐  │
│  │   React UI   │ ←───────────→  │   Node.js Server         │  │
│  │  (port 5173) │   frames +     │   Express + ws           │  │
│  │              │   input events │   (port 3001)            │  │
│  │  • Canvas    │                │                          │  │
│  │  • URL bar   │                │  ┌────────────────────┐  │  │
│  │  • Controls  │                │  │  Puppeteer (CDP)   │  │  │
│  │  • Action log│                │  │  Page.startScreen  │  │  │
│  └──────────────┘                │  │  cast()            │  │  │
│                                  │  └────────┬───────────┘  │  │
│                                  └───────────┼──────────────┘  │
│                                              │ Chrome DevTools  │
│                                              │ Protocol (CDP)   │
│                                              │ port 9222        │
│                                  ┌───────────▼──────────────┐  │
│                                  │   Docker Container        │  │
│                                  │   debian:bullseye-slim    │  │
│                                  │   Chromium --headless     │  │
│                                  │   --remote-debugging-     │  │
│                                  │   port=9222               │  │
│                                  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Why this architecture?

**CDP Screencast over WebSocket (not VNC/noVNC):**
Chrome's DevTools Protocol has a native `Page.startScreencast` command that emits
JPEG-encoded frames directly. This is lighter than standing up a full VNC stack
(Xvfb + x11vnc + noVNC proxy) and gives us fine-grained control over quality and framerate.

**Puppeteer-core as CDP client:**
Puppeteer's CDP session API lets us issue raw CDP commands (`Page.startScreencast`,
`Input.dispatchMouseEvent`) with a well-maintained typed interface. We use
`puppeteer-core` (no bundled Chrome) since Chromium lives in Docker.

**WebSocket for streaming:**
Bi-directional. Frames flow server → client; input events flow client → server.
A single persistent connection handles both directions.

---

## Prerequisites

- **Docker Desktop** — running (verify: `docker ps`)
- **Node.js 18+** — (verify: `node --version`)

---

## Run (3 commands)

```bash
# 1. Build the Docker image (one-time, ~2 min)
docker build -t bld-browser ./docker

# 2. Start the backend
cd server && npm install && node index.js

# 3. In a new terminal — start the frontend
cd client && npm install && npm run dev
```

Open **http://localhost:5173**, click **START**, and the browser appears.

---

## Features

| Feature | Description |
|---------|-------------|
| **Live stream** | Chromium screen streams at ~20-30 FPS via CDP screencast |
| **Full mouse control** | Click, right-click, scroll, hover — all forwarded via CDP |
| **Full keyboard** | All keys including special keys (Enter, Backspace, arrows, Ctrl combos) |
| **URL bar** | Navigate from the UI — auto-prefixes `https://` if missing |
| **Quality slider** | Adjust JPEG quality 10-100% live — trades latency for fidelity |
| **FPS counter** | Real-time frames-per-second measured client-side |
| **Latency display** | Round-trip frame latency (server timestamp → client render) |
| **Screenshot** | Captures current viewport, downloads as PNG |
| **Action log** | Scrolling sidebar of every click, keypress, navigation, system event |
| **Auto-reconnect** | WebSocket reconnects up to 5× on disconnect with 2s delay |
| **Clean shutdown** | Docker container is always stopped on server exit (SIGINT/SIGTERM) |

---

## What I learned / Why this is hard

Working on this made clear exactly why AI alone can't build production systems:

1. **The Docker shm problem** — Chromium silently crashes inside Docker without
   `--disable-dev-shm-usage` or `shm_size: 256mb`. No error message. You have to
   know this from experience or learn it the hard way.

2. **CDP screencast ≠ obvious** — `Page.startScreencast` exists but isn't exposed
   in Puppeteer's high-level API. You have to drop to a raw CDP session via
   `page.createCDPSession()`. The frame ACK (`Page.screencastFrameAck`) is required
   or Chromium stops sending frames after the first one.

3. **Coordinate scaling** — Canvas is displayed at CSS width but Chromium is 1280px.
   Every mouse coordinate must be multiplied by `1280 / canvas.getBoundingClientRect().width`.
   Miss this and clicking on the left half clicks the wrong quarter.

4. **Keyboard event capture** — `e.preventDefault()` in a `keydown` listener blocks
   browser shortcuts. Without it, Ctrl+L hijacks the browser address bar instead of
   going to Chromium.

---

## Known Limitations

- **No multi-tab support** — CDP screencast is per-page. Supporting multiple tabs
  would require a separate CDP session per tab and a tab switcher in the UI.
- **Single client only** — the server tracks one active WebSocket client and one
  browser instance. Multiple users would need session isolation.
- **No audio** — CDP screencast is video only.
- **JPEG compression artifacts** — at low quality settings the stream is visually
  degraded. WebRTC would solve this with hardware-accelerated encoding.

---

## If I Had More Time

**1. WebRTC instead of base64-over-WebSocket**
The current approach encodes each frame as base64 (+33% size overhead) and sends it
as a JSON string. WebRTC's `MediaStream` API would give us hardware-accelerated H.264
encoding, binary frame delivery, and proper congestion control — cutting latency by
~40-60% and removing the base64 overhead entirely.

**2. Multi-tab support**
Create a `Map<tabId, { page, cdpSession }>` on the server. The UI shows a tab strip;
switching tabs sends `{ type: 'switchTab', tabId }` which stops the current screencast
and starts one on the new page. New tabs: `browser.newPage()`.

**3. Session recording and replay**
The action log already serializes every user action. With timestamps, this becomes a
replay script. Store the log as JSON, replay it server-side with Puppeteer — this is
essentially automated browser testing built on top of the same infrastructure.

---

## Project Structure

```
remote-browser-control/
├── docker/
│   └── Dockerfile          # Chromium in debian:bullseye-slim
├── server/
│   ├── index.js            # Express + WebSocket server
│   ├── browser.js          # CDP bridge (Puppeteer + Docker lifecycle)
│   └── package.json
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx             # Root — state + message routing
│       ├── index.css           # Global styles + design tokens
│       ├── main.jsx
│       ├── hooks/
│       │   ├── useWebSocket.js       # WS connection + auto-reconnect
│       │   ├── useBrowserMetrics.js  # FPS + latency tracking
│       │   └── useActionLog.js       # Scrolling action history
│       └── components/
│           ├── BrowserCanvas.jsx  # <canvas> renderer + input capture
│           ├── ControlBar.jsx     # Start/Stop, URL bar, quality, screenshot
│           ├── StatusBar.jsx      # Status strip with live metrics
│           └── ActionLog.jsx      # Sidebar action log panel
├── docker-compose.yml
└── README.md
```
