# 🌐 BLD Remote Browser Engine

A containerized remote browser system that allows users to launch, view, and control an isolated Chromium instance running inside Docker directly from a web browser.
# ✨ Features

## Core Browser Features

* Launch isolated Chromium instances inside Docker
* Real-time browser screen streaming
* Full mouse interaction support - Click, Right Click, Hover, Scroll, Drag
* Full keyboard support - Text input, Special keys, Shortcuts, Navigation keys
* URL navigation bar

# 🏗 Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Your Machine                            │
│                                                                 │
│  ┌──────────────┐   WebSocket    ┌──────────────────────────┐   │
│  │   React UI   │ ←───────────→  │     Node.js Server       │   │
│  │              │  Frames/Input  │    Express + ws          │   │
│  │              │                │                          │   │
│  │  Canvas      │                │  Puppeteer-Core          │   │
│  │  URL Bar     │                │  CDP Sessions            │   │
│  │  Metrics     │                │  Docker Lifecycle        │   │
│  │  Tabs        │                │  Binary Streaming        │   │
│  └──────────────┘                └──────────┬───────────────┘   │
│                                             │                   │
│                                             │ CDP               │
│                                             │                   │
│                                  ┌──────────▼───────────────┐   │
│                                  │     Docker Container     │   │
│                                  │                          │   │
│                                  │ Headless Chromium        │   │
│                                  │ Remote Debugging         │   │
│                                  │ Port 9222               │   │
│                                  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---
# 📁 Project Structure

```text
remote-browser-control/
├── docker/
│   └── Dockerfile
│
├── server/
│   ├── index.js
│   ├── browser.js
│   └── package.json
│
├── client/
│   ├── index.html
│   ├── vite.config.js
│   │
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       │
│       ├── hooks/
│       │   ├── useWebSocket.js
│       │   ├── useBrowserMetrics.js
│       │   └── useActionLog.js
│       │
│       └── components/
│           ├── BrowserCanvas.jsx
│           ├── ControlBar.jsx
│           ├── StatusBar.jsx
│           └── ActionLog.jsx
│
├── docker-compose.yml
└── README.md
```

---



## Advanced Features

### Multi-Tab Support

The system supports browser tab management through CDP target tracking.

Features include: Create tabs, Switch tabs, Close tabs, Active tab highlighting, Intercept `target="_blank"` links, Automatic tab registration

Each tab is mapped internally to its own CDP session and browser page.

---

### Binary WebSocket Streaming

The initial implementation streamed Base64 JPEG frames inside JSON payloads.

This was later optimized using a binary protocol:
* No Base64 overhead, Reduced payload size, Faster frame decoding on the client

This significantly improves streaming efficiency compared to JSON-based frame transport.

---

### Session Reattachment

Refreshing the frontend no longer destroys the browser session.

If:

* Docker container is already running
* Chromium is already connected

the backend automatically reattaches the new WebSocket connection to the existing session and resumes streaming.

This prevents users from becoming locked out of active browser instances.

---

### Live Browser Metrics

The dashboard displays: FPS, Frame latency, Browser URL, Connection status

allowing users to monitor stream performance in real time.

---

### Docker Telemetry

The backend continuously polls Docker statistics and streams: CPU usage, Memory usage

directly to the React dashboard.

This provides visibility into browser resource consumption.

---

### FinOps Auto Shutdown

To prevent wasted compute resources, idle browser sessions are automatically terminated after prolonged inactivity.

Benefits: Reduced resource usage, Better cloud cost efficiency, Automatic cleanup

---

### Smart Logging System

High-frequency events such as: Mouse movement, Scroll events

can flood terminal logs.

A custom logging wrapper suppresses repetitive event spam while preserving meaningful actions like: Clicks, Navigations, Tab operations, Session lifecycle events

This keeps infrastructure logs readable.

---



# 🛠 Technology Stack

## Frontend

* React
* Vite
* HTML5 Canvas

## Backend

* Node.js
* Express
* WebSocket (`ws`)

## Browser Automation

* Puppeteer-Core
* Chrome DevTools Protocol (CDP)

## Infrastructure

* Docker, Chromium

---

# 🤔 Why This Architecture?

## Why CDP Instead of VNC?

Traditional remote browser systems often use:

```text
Chromium
   ↓
Xvfb
   ↓
x11vnc
   ↓
noVNC
   ↓
Browser
```

This introduces multiple layers and additional latency.

Instead, this project uses:

```text
Chromium
   ↓
Chrome DevTools Protocol
   ↓
Node.js
   ↓
WebSocket
   ↓
React
```

Benefits:

* Fewer moving parts
* Direct browser control
* Lower overhead
* Native Chromium integration
* Easier event dispatching

---

## Why Puppeteer-Core?

Chromium already runs inside Docker.

Using standard Puppeteer would download another browser binary.

`puppeteer-core` provides:

* Smaller installation size
* Direct CDP access
* Better control over external Chromium instances

---

## Why Binary Streaming?

The first implementation used:

```text
JPEG
↓
Base64
↓
JSON
↓
WebSocket
```

This introduced:

* Base64 overhead
* Larger payloads
* Additional serialization

The optimized pipeline uses:

```text
JPEG
↓
Binary Buffer
↓
WebSocket
```

Benefits:

* Smaller payloads
* Faster decoding
* Reduced memory pressure
* Better streaming performance

---

# 🚀 Getting Started

## Prerequisites

### Docker

Verify Docker is running:

```bash
docker ps
```

### Node.js

Verify Node installation:

```bash
node --version
```

Node 18+ recommended.

---

## Installation

### 1. Build Docker Image

```bash
docker build -t bld-browser ./docker
```

### 2. Start Backend

```bash
cd server
npm install
node index.js
```

### 3. Start Frontend

```bash
cd client
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Click **START** to launch a browser instance.

---

# 🧠 Engineering Challenges & Learnings

Building a remote browser turned out to be significantly more complex than simply connecting Puppeteer to Chromium.

Most challenges emerged from interactions between:

* Docker
* Chromium
* CDP
* WebSockets
* React state
* Operating system networking

Below are the major issues encountered and how they were solved.

---

## 1. Docker Shared Memory Crashes

### Problem

Chromium repeatedly crashed inside Docker.

### Cause

Docker allocates limited shared memory by default.

Chromium heavily relies on `/dev/shm`.

### Solution

Added:

```bash
--disable-dev-shm-usage
```

and increased Docker shared memory allocation.

### Learning

Infrastructure-level constraints can silently break applications.

---

## 2. IPv6 Localhost Trap

### Problem

Node fetch requests failed when connecting to Chromium.

### Cause

Node preferred IPv6 (`::1`) while Docker exposed ports through IPv4.

### Solution

Replaced:

```text
localhost
```

with:

```text
127.0.0.1
```

for all Chromium connections.

### Learning

Networking assumptions often fail across container boundaries.

---

## 3. Chromium Headless Security Restrictions

### Problem

CDP connections were refused despite Chromium appearing healthy.

### Cause

New Chromium headless mode restricted remote debugging access.

### Solution

Used:

```bash
--headless
--remote-allow-origins=*
```

instead of relying on the newer headless mode.

### Learning

Browser security defaults can interfere with automation workflows.

---

## 4. CDP Screencast ACK Requirement

### Problem

Only the first screencast frame arrived.

### Cause

Chromium requires explicit acknowledgement for each frame.

### Solution

After processing every frame:

```javascript
Page.screencastFrameAck
```

is sent back.

### Learning

Many CDP APIs require protocol-level bookkeeping.

---

## 5. Coordinate Scaling Problems

### Problem

Mouse clicks landed in incorrect locations.

### Cause

Canvas dimensions differed from Chromium viewport dimensions.

### Solution

Mouse coordinates are scaled before dispatching:

```javascript
browserX = canvasX * scaleFactor
browserY = canvasY * scaleFactor
```

### Learning

Coordinate systems rarely align automatically.

---

## 6. Keyboard Input Hijacking

### Problem

Typing in the URL bar controlled the remote browser.

### Cause

Global keyboard listeners intercepted all key events.

### Solution

Ignore events originating from:

```javascript
INPUT
TEXTAREA
```

elements.

### Learning

Focus management is critical in interactive applications.

---

## 7. Page Refresh Deadlock

### Problem

Refreshing the frontend caused the UI to lose connection with a running browser.

### Cause

React state reset while backend state persisted.

### Solution

Implemented session reattachment and state synchronization.

### Learning

Frontend and backend state lifecycles must be designed together.

---

## 8. Docker Filesystem Asset Issues

### Problem

Custom browser backgrounds failed to load.

### Cause

The browser ran inside an isolated container.

### Solution

Images are loaded through Node.js, converted to Base64, and injected directly into the browser.

### Learning

Containers isolate filesystems by design.

---

## 9. Terminal Log Flooding

### Problem

Mousemove and scroll events overwhelmed logs.

### Cause

Thousands of events were emitted every minute.

### Solution

Built a smart log suppression system.

### Learning

Observability must remain useful under load.

---

## 10. Multi-Tab Routing Complexity

### Problem

Managing multiple tabs required tracking active pages and CDP sessions.

### Solution

Created internal mappings:

```javascript
Map<tabId, page>
Map<tabId, cdpSession>
```

and implemented tab lifecycle management.

### Learning

Browser state management becomes significantly more complex when tabs are introduced.

---

## 11. Binary Streaming Implementation

### Problem

JSON-based frame delivery became inefficient as frame frequency increased.

### Solution

Migrated to binary frame transport.

### Learning

Serialization overhead becomes significant in real-time systems.

---

## 12. Container Cleanup and Resource Leaks

### Problem

Unexpected server exits could leave Docker containers running.

### Solution

Added cleanup handlers for:

```text
SIGINT
SIGTERM
```

and browser shutdown events.

### Learning

Resource lifecycle management is just as important as feature development.

---

# 📈 What I Learned

This project provided hands-on experience with:

* Chrome DevTools Protocol
* Browser internals
* Docker container lifecycle management
* WebSocket streaming systems
* Binary protocol design
* Frontend/backend synchronization
* Resource monitoring
* Multi-tab browser orchestration
* Real-time performance optimization
* Systems debugging

More importantly, it highlighted that production engineering often involves debugging infrastructure, networking, and lifecycle issues rather than simply writing application code.

---

# 🔮 Future Improvements

## WebRTC Streaming

Current implementation uses JPEG frame streaming over WebSockets.

A WebRTC pipeline would provide:

* Hardware acceleration
* Better congestion control
* Lower latency
* Audio support
* Adaptive bitrate streaming

---

## Container Pooling

Maintain pre-warmed Chromium containers.

Benefits:

* Faster startup
* Reduced cold starts
* Improved scalability

---

## Session Recording & Replay

Store:

* Clicks
* Keystrokes
* Navigation events
* Timestamps

Potential use cases:

* Browser automation
* User session replay
* QA testing
* Audit trails

---

## Multi-Tenant Architecture

Move from:

```text
1 User → 1 Browser
```

to:

```text
N Users → N Isolated Containers
```

with automatic provisioning and lifecycle management.

---
