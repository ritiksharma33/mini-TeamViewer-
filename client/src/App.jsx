/**
 * App.jsx
 *
 * Root component. Owns all application state and wires together:
 * - WebSocket connection (via useWebSocket hook)
 * - Browser state machine (idle → starting → live → stopping → stopped)
 * - Frame rendering (passed to BrowserCanvas via ref)
 * - Performance metrics (FPS, latency, frame count)
 * - Action log
 * - Multi-Tab UI and Session Management
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

  // 🚀 Multi-Tab State
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

  // ── Quality & Metrics ─────────────────────────────────────────────────────
  const [quality, setQuality] = useState(60);
  const { fps, latency, frameCount, recordFrame } = useBrowserMetrics();
  
  // ── UI State ──────────────────────────────────────────────────────────────
  const { log, addEntry, clearLog } = useActionLog();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const canvasContainerRef = useRef(null);

  const isLive = browserState === 'live';

  // ── Handle incoming WebSocket messages ───────────────────────────────────

  useEffect(() => {
    if (!lastMessage) return;

    // ⚡️ OPTIMIZATION: Route binary stream packets directly to the canvas pipeline
    if (lastMessage instanceof Blob) {
      const handleBinaryPayload = async () => {
        try {
          const arrayBuffer = await lastMessage.arrayBuffer();
          const dataView = new DataView(arrayBuffer);
          
          // Read 8-byte Big-Endian double for server timestamp
          const serverTimestamp = dataView.getFloat64(0, false); 
          
          // Extract raw image bytes following the timestamp data offset
          const jpegBuffer = arrayBuffer.slice(8);
          const imageBlob = new Blob([jpegBuffer], { type: 'image/jpeg' });
          const objectUrl = URL.createObjectURL(imageBlob);

          const canvas = canvasContainerRef.current?.querySelector('canvas');
          if (canvas?.drawFrame) {
            canvas.drawFrame(objectUrl);
          }
          recordFrame(serverTimestamp);

          // Auto-revoke memory reference right after rendering loop completes
          setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
        } catch (err) {
          console.error('[Binary Stream] Error parsing frame:', err);
        }
      };

      handleBinaryPayload();
      return; // Stop execution here so it doesn't drop down to standard JSON logic
    }

    // ── Handle Standard JSON Messages ───────────────────────────────────────
    const msg = lastMessage;

    switch (msg.type) {

      case 'welcome':
        addEntry('system', 'Connected to server');
        break;

      case 'status':
        setBrowserState(msg.state);
        setStatusMsg(msg.msg || '');
        if (msg.state === 'live')    addEntry('system', 'Browser is live');
        if (msg.state === 'stopped') {
          addEntry('system', 'Browser stopped');
          setTabs([]); // Clear tabs on shutdown
          setActiveTabId(null);
        }
        if (msg.state === 'error') {
          addEntry('error', msg.msg || 'Unknown error');
          setTabs([]);
          setActiveTabId(null);
        }
        break;

      // 🚀 Handle Tab Updates from Server
      case 'tabs_update':
        setTabs(msg.tabs);
        setActiveTabId(msg.activeTabId);
        break;

      case 'navigated':
        setCurrentUrl(msg.url);
        addEntry('nav', `→ ${msg.url}`);
        break;

      case 'urlUpdate':
        setCurrentUrl(msg.url);
        break;

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

      case 'qualityChanged':
        addEntry('system', `Stream quality set to ${msg.value}%`);
        break;

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

  const handleGoBack = useCallback(() => {
    addEntry('nav', '← Going Back');
    send({ type: 'go_back' });
  }, [send, addEntry]);

  const handleGoForward = useCallback(() => {
    addEntry('nav', '→ Going Forward');
    send({ type: 'go_forward' });
  }, [send, addEntry]);

  // 🚀 Tab Actions
  const handleNewTab = useCallback(() => {
    addEntry('system', 'Opening new tab');
    send({ type: 'new_tab' });
  }, [send, addEntry]);

  const handleSwitchTab = useCallback((id) => {
    send({ type: 'switch_tab', id });
  }, [send]);

  const handleCloseTab = useCallback((id) => {
    addEntry('system', 'Closed tab');
    send({ type: 'close_tab', id });
  }, [send, addEntry]);

  const handleScreenshot = useCallback(() => {
    addEntry('screenshot', 'Screenshot requested...');
    send({ type: 'screenshot' });
  }, [send, addEntry]);

  const handleQualityChange = useCallback((val) => {
    setQuality(val);
    send({ type: 'setQuality', value: val });
  }, [send]);

  // Wrap send to also log actions
  const wrappedSend = useCallback((msg) => {
    send(msg);

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
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        quality={quality}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
      />

      {/* 🚀 The Tab Bar UI ───────────────────────────────────────────────── */}
      {isLive && tabs.length > 0 && (
        <div style={{ 
          display: 'flex', 
          background: 'var(--bg-surface)', 
          borderBottom: '1px solid var(--border)', 
          padding: '6px 12px 0', 
          gap: '4px', 
          overflowX: 'auto' 
        }}>
          {tabs.map((tabId, index) => (
            <div 
              key={tabId} 
              onClick={() => handleSwitchTab(tabId)}
              style={{
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '6px 14px', 
                cursor: 'pointer',
                background: activeTabId === tabId ? 'var(--bg-base)' : 'var(--bg-elevated)',
                color: activeTabId === tabId ? 'var(--accent)' : 'var(--text-secondary)',
                borderTopLeftRadius: '6px', 
                borderTopRightRadius: '6px', 
                fontSize: '12px', 
                fontFamily: 'var(--font-mono)',
                border: activeTabId === tabId ? '1px solid var(--border)' : '1px solid transparent',
                borderBottom: 'none'
              }}
            >
              Tab {index + 1}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  handleCloseTab(tabId); 
                }}
                title="Close Tab"
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'inherit', 
                  cursor: 'pointer', 
                  fontSize: '14px', 
                  padding: '0 4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button 
            onClick={handleNewTab}
            title="New Tab"
            style={{ 
              background: 'transparent', 
              border: '1px solid var(--border)', 
              color: 'var(--text-primary)', 
              borderRadius: '4px', 
              margin: '2px 0 2px 4px', 
              cursor: 'pointer', 
              padding: '0 10px', 
              height: '24px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)'
            }}
          >
            +
          </button>
        </div>
      )}

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