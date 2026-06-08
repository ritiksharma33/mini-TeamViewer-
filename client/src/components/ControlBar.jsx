/**
 * ControlBar.jsx
 *
 * The browser toolbar — sits between the status bar and the canvas.
 * Contains:
 *   - Start / Stop button
 *   - URL bar (imported)
 *   - Quality slider
 *   - Screenshot button
 *   - Sidebar toggle
 */

import { useState, useCallback } from 'react';
import { URLBar } from './URLBar.jsx';

function IconButton({ title, onClick, disabled, children, variant = 'ghost' }) {
  const [hover, setHover] = useState(false);

  const variantStyles = {
    ghost: {
      background: hover ? 'var(--bg-elevated)' : 'transparent',
      border: '1px solid transparent',
      color: disabled ? 'var(--text-tertiary)' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
    },
    danger: {
      background: hover ? 'var(--red-dim)' : 'transparent',
      border: `1px solid ${hover ? 'var(--red)' : 'transparent'}`,
      color: disabled ? 'var(--text-tertiary)' : 'var(--red)',
    },
    primary: {
      background: hover ? 'rgba(0,229,255,0.2)' : 'var(--accent-dim)',
      border: '1px solid var(--accent)',
      color: 'var(--accent)',
    },
  };

  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: '32px',
        minWidth: '32px',
        padding: '0 8px',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        letterSpacing: '0.05em',
        transition: 'all var(--transition)',
        flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
        ...variantStyles[variant],
      }}
    >
      {children}
    </button>
  );
}

export function ControlBar({
  browserState,
  currentUrl,
  onStart,
  onStop,
  onNavigate,
  onScreenshot,
  onQualityChange,
  quality,
  sidebarOpen,
  onToggleSidebar,
}) {
  const isLive     = browserState === 'live';
  const isStarting = browserState === 'starting' || browserState === 'stopping';
  const isIdle     = browserState === 'idle' || browserState === 'stopped' || browserState === 'error';

  const [showQuality, setShowQuality] = useState(false);

  const handleStartStop = useCallback(() => {
    if (isLive)     return onStop();
    if (isStarting) return;
    onStart();
  }, [isLive, isStarting, onStart, onStop]);

  return (
    <div style={{
      height: '48px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      paddingInline: '12px',
      gap: '8px',
      flexShrink: 0,
    }}>

      {/* Start / Stop */}
      <IconButton
        title={isLive ? 'Stop browser' : 'Start browser'}
        onClick={handleStartStop}
        disabled={isStarting}
        variant={isLive ? 'danger' : 'primary'}
      >
        {isLive ? (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
            STOP
          </>
        ) : isStarting ? (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            ...
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            START
          </>
        )}
      </IconButton>

      {/* Separator */}
      <div style={{ width: '1px', height: '20px', background: 'var(--border)', flexShrink: 0 }} />

      {/* URL Bar */}
      <URLBar
        currentUrl={currentUrl}
        onNavigate={onNavigate}
        isLive={isLive}
      />

      {/* Separator */}
      <div style={{ width: '1px', height: '20px', background: 'var(--border)', flexShrink: 0 }} />

      {/* Screenshot */}
      <IconButton
        title="Take screenshot (downloads PNG)"
        onClick={onScreenshot}
        disabled={!isLive}
        variant="ghost"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </IconButton>

      {/* Quality toggle */}
      <div style={{ position: 'relative' }}>
        <IconButton
          title="Stream quality settings"
          onClick={() => setShowQuality(v => !v)}
          disabled={!isLive}
          variant="ghost"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{quality}%</span>
        </IconButton>

        {/* Quality dropdown */}
        {showQuality && isLive && (
          <div style={{
            position: 'absolute',
            top: '36px',
            right: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            zIndex: 100,
            minWidth: '220px',
            animation: 'fade-in 100ms ease',
          }}>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Stream quality</span>
              <span style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 600 }}>{quality}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={quality}
              onChange={(e) => onQualityChange(Number(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--accent)',
                cursor: 'pointer',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Low (fast)</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>High (slow)</span>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar toggle */}
      <IconButton
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onClick={onToggleSidebar}
        variant="ghost"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
      </IconButton>
    </div>
  );
}

export default ControlBar;
