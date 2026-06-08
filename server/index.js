/**
 * index.js
 * Express HTTP server + WebSocket server.
 *
 * Responsibilities:
 *   - Serve the built React frontend (client/dist) as static files
 *   - Handle WebSocket connections from the browser UI
 *   - Route all WebSocket messages to browser.js handlers
 *   - Expose /api/health endpoint for debugging
 */

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const cors    = require('cors');
const path    = require('path');

const { handleMessage, getStats } = require('./browser');

// ─── Server setup ─────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

// Serve the built React app (run `npm run build` in /client first)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// Health check endpoint — useful for debugging
app.get('/api/health', (req, res) => {
  const stats = getStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    browser: stats,
  });
});

// Catch-all: serve React index.html for any non-API route (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── HTTP + WS server ─────────────────────────────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${clientIp}`);

  // Send a welcome message so the client knows the server is healthy
  ws.send(JSON.stringify({
    type: 'welcome',
    msg: 'Connected to remote browser server',
    ts: Date.now(),
  }));

  // ── Incoming messages ──────────────────────────────────────────────────────
  ws.on('message', async (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      console.error('[WS] Received non-JSON message');
      return;
    }

    // Log all messages except the high-frequency ones
    if (!['mousemove', 'frame'].includes(msg.type)) {
      console.log(`[WS] ← ${msg.type}`, msg.type === 'navigate' ? msg.url : '');
    }

    await handleMessage(ws, msg);
  });

  // ── Connection closed ──────────────────────────────────────────────────────
  ws.on('close', (code, reason) => {
    console.log(`[WS] Client disconnected (code: ${code})`);
  });

  // ── Connection error ───────────────────────────────────────────────────────
  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });

  // ── Keep-alive ping every 30s ──────────────────────────────────────────────
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30_000);
});

// ─── Start listening ──────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║     Remote Browser Control — BLD Assignment   ║
╠═══════════════════════════════════════════════╣
║  Server:    http://localhost:${PORT}              ║
║  Health:    http://localhost:${PORT}/api/health   ║
║  WebSocket: ws://localhost:${PORT}                ║
╚═══════════════════════════════════════════════╝
  `);
});
