/**
 * App.jsx
 *
 * Root component. Owns all application state and wires together:
 *   - WebSocket connection (via useWebSocket hook)
 *   - Browser state machine (idle → starting → live → stopping → stopped)
 *   - Frame rendering (passed to BrowserCanvas via ref)
 *   - Performance metrics (FPS, latency, frame count)
 *   - Action log
 *   - All UI panels
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { useWebSocket }       from './hooks/useWebSocket.js';
import { useBrowserMetrics }  from './hooks/useBrowserMetrics.js';
import { useActionLog }       from './hooks/useActionLog.js';

import { StatusBar }    from './components/StatusBar.jsx';
import { ControlBar }   from './components/ControlBar.jsx';
import { BrowserCanvas } from './components/BrowserCanvas.jsx';
import { ActionLog }    from './components/ActionLog.jsx';

export default function App() {
  // ── WebSocket ─────────────────────────────────────────────────────────────
  const { send, lastMessage, status: wsStatus, retryCount } = useWebSocket();

  // ── Browser state ─────────────────────────────────────────────────────────
  const [browserState, setBrowserState] = useState('idle');
  const [statusMsg,    setStatusMsg]    = useState('');
  const [currentUrl,   setCurrentUrl]   = useState('');

  // ── Quality ───────────────────────────────────────────────────────────────
  const [quality, setQuality] = useState(60);

  // ── Metrics ───────────────────────────────────────────────────────────────
  const { fps, latency, frameCount, recordFrame } = useBrowserMetrics();

  // ── Action log ────────────────────────────────────────────────────────────
  const { log, addEntry, clearLog } = useActionLog();

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Canvas ref (to call drawFrame imperatively) ───────────────────────────
  const canvasContainerRef = useRef(null);

  const isLive = browserState === 'live';

  // ── Handle incoming WebSocket messages ───────────────────────────────────

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage;

    switch (msg.type) {

      // ── Connection welcome ───────────────────────────────────────────────
      case 'welcome':
        addEntry('system', 'Connected to server');
        break;

      // ── Browser status updates ───────────────────────────────────────────
      case 'status':
        setBrowserState(msg.state);
        setStatusMsg(msg.msg || '');
        if (msg.state === 'live')    addEntry('system', 'Browser is live');
        if (msg.state === 'stopped') addEntry('system', 'Browser stopped');
        if (msg.state === 'error')   addEntry('error', msg.msg || 'Unknown error');
        break;

      // ── Incoming video frame ─────────────────────────────────────────────
      case 'frame': {
        // Draw the frame directly to the canvas without going through React state
        // (state updates cause re-renders; we need 30+ fps without that overhead)
        const canvas = canvasContainerRef.current?.querySelector('canvas');
        if (canvas?.drawFrame) {
          canvas.drawFrame(msg.data);
        }
        recordFrame(msg.ts);
        break;
      }

      // ── Navigation completed ─────────────────────────────────────────────
      case 'navigated':
        setCurrentUrl(msg.url);
        addEntry('nav', `→ ${msg.url}`);
        break;

      // ── URL update (e.g. from link clicks inside the browser) ───────────
      case 'urlUpdate':
        setCurrentUrl(msg.url);
        break;

      // ── Screenshot ready ─────────────────────────────────────────────────
      case 'screenshot': {
        const a = document.createElement('a');
        a.href = 'data:image/png;base64,' + msg.data;
        a.download = `screenshot-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        addEntry('screenshot', `Screenshot saved — ${msg.url || 'current page'}`);
        break;
      }

      // ── Quality changed confirmed ────────────────────────────────────────
      case 'qualityChanged':
        addEntry('system', `Stream quality set to ${msg.value}%`);
        break;

      // ── Server-side error ────────────────────────────────────────────────
      case 'error':
        addEntry('error', msg.msg || 'Unknown server error');
        break;

      default:
        break;
    }
  }, [lastMessage, addEntry, recordFrame]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    setBrowserState('starting');
    setStatusMsg('Spinning up Docker container...');
    setCurrentUrl('');
    addEntry('system', 'Starting browser...');
    send({ type: 'start' });
  }, [send, addEntry]);

  const handleStop = useCallback(() => {
    setBrowserState('stopping');
    setStatusMsg('Shutting down...');
    addEntry('system', 'Stopping browser...');
    send({ type: 'stop' });
  }, [send, addEntry]);

  const handleNavigate = useCallback((url) => {
    let normalized = url.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    setCurrentUrl(normalized);
    addEntry('nav', `→ ${normalized}`);
    send({ type: 'navigate', url: normalized });
  }, [send, addEntry]);

  const handleScreenshot = useCallback(() => {
    addEntry('screenshot', 'Screenshot requested...');
    send({ type: 'screenshot' });
  }, [send, addEntry]);

  const handleQualityChange = useCallback((val) => {
    setQuality(val);
    send({ type: 'setQuality', value: val });
  }, [send]);

  // Log mouse clicks in the action log
  const handleCanvasClick = useCallback((x, y) => {
    addEntry('click', `Click at (${x}, ${y})`);
  }, [addEntry]);

  // Wrap send to also log actions
  const wrappedSend = useCallback((msg) => {
    send(msg);

    // Add certain events to the action log
    switch (msg.type) {
      case 'click':
        addEntry('click', `Click at (${msg.x}, ${msg.y})`);
        break;
      case 'keypress':
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(msg.key)) {
          addEntry('key', `Key: ${msg.key}`);
        }
        break;
      case 'scroll':
        addEntry('scroll', `Scroll (${Math.round(msg.deltaX)}, ${Math.round(msg.deltaY)})`);
        break;
      default:
        break;
    }
  }, [send, addEntry]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--bg-base)',
    }}>

      {/* ── Top status strip ─────────────────────────────────────────────── */}
      <StatusBar
        browserState={browserState}
        wsStatus={wsStatus}
        fps={fps}
        latency={latency}
        frameCount={frameCount}
        statusMsg={statusMsg}
        retryCount={retryCount}
      />

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <ControlBar
        browserState={browserState}
        currentUrl={currentUrl}
        onStart={handleStart}
        onStop={handleStop}
        onNavigate={handleNavigate}
        onScreenshot={handleScreenshot}
        onQualityChange={handleQualityChange}
        quality={quality}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
      />

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* ── Browser viewport ─────────────────────────────────────────── */}
        <div
          ref={canvasContainerRef}
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            background: 'var(--bg-base)',
            padding: '16px',
            minWidth: 0,
          }}
        >
          <BrowserCanvas
            send={wrappedSend}
            isLive={isLive}
            style={{
              maxWidth: '1280px',
              width: '100%',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          />
        </div>

        {/* ── Action log sidebar ────────────────────────────────────────── */}
        {sidebarOpen && (
          <ActionLog log={log} onClear={clearLog} />
        )}
      </div>
    </div>
  );
}
