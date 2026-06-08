/**
 * StatusBar.jsx
 *
 * Top status strip showing:
 *   - WS connection status (connected / connecting / error)
 *   - Browser state (idle / starting / live / stopped / error)
 *   - Live FPS counter
 *   - Live latency (ms)
 *   - Frame count
 */

import { useMemo } from 'react';

const STATE_CONFIG = {
  idle:        { label: 'IDLE',       color: 'var(--text-tertiary)', dot: 'var(--border-bright)' },
  starting:    { label: 'STARTING',   color: 'var(--amber)',         dot: 'var(--amber)' },
  live:        { label: 'LIVE',       color: 'var(--green)',         dot: 'var(--green)' },
  stopping:    { label: 'STOPPING',   color: 'var(--amber)',         dot: 'var(--amber)' },
  stopped:     { label: 'STOPPED',    color: 'var(--text-tertiary)', dot: 'var(--border-bright)' },
  error:       { label: 'ERROR',      color: 'var(--red)',           dot: 'var(--red)' },
};

const WS_CONFIG = {
  idle:         { label: 'IDLE',         color: 'var(--text-tertiary)' },
  connecting:   { label: 'CONNECTING',   color: 'var(--amber)' },
  connected:    { label: 'CONNECTED',    color: 'var(--green)' },
  disconnected: { label: 'DISCONNECTED', color: 'var(--red)' },
  error:        { label: 'ERROR',        color: 'var(--red)' },
};

function Metric({ label, value, unit, highlight }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
      <span style={{ color: 'var(--text-tertiary)', fontSize: '10px', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <span style={{
        color: highlight ? 'var(--accent)' : 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        fontWeight: 500,
        minWidth: '28px',
        textAlign: 'right',
      }}>
        {value}
      </span>
      {unit && (
        <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{unit}</span>
      )}
    </div>
  );
}

export function StatusBar({ browserState, wsStatus, fps, latency, frameCount, statusMsg, retryCount }) {
  const browser = STATE_CONFIG[browserState] || STATE_CONFIG.idle;
  const ws      = WS_CONFIG[wsStatus]        || WS_CONFIG.idle;
  const isLive  = browserState === 'live';

  const latencyColor = useMemo(() => {
    if (!isLive) return 'var(--text-tertiary)';
    if (latency < 80)  return 'var(--green)';
    if (latency < 150) return 'var(--amber)';
    return 'var(--red)';
  }, [latency, isLive]);

  return (
    <div style={{
      height: '32px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      paddingInline: '16px',
      gap: '20px',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      flexShrink: 0,
    }}>

      {/* Browser state badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: browser.dot,
          animation: isLive ? 'pulse-dot 2s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }} />
        <span style={{ color: browser.color, letterSpacing: '0.08em', fontWeight: 600 }}>
          {browser.label}
        </span>
        {statusMsg && (
          <span style={{ color: 'var(--text-tertiary)', fontSize: '10px', marginLeft: '4px' }}>
            — {statusMsg}
          </span>
        )}
        {retryCount > 0 && wsStatus !== 'connected' && (
          <span style={{ color: 'var(--amber)', fontSize: '10px' }}>
            (retry {retryCount}/5)
          </span>
        )}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '14px', background: 'var(--border)', flexShrink: 0 }} />

      {/* WS status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>WS</span>
        <span style={{ color: ws.color, fontSize: '10px', letterSpacing: '0.05em' }}>
          {ws.label}
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Metrics — only interesting when live */}
      {isLive && (
        <>
          <Metric label="FPS"     value={fps}        unit="fps" highlight={fps > 15} />
          <div style={{ width: '1px', height: '14px', background: 'var(--border)' }} />
          <Metric
            label="LAT"
            value={latency}
            unit="ms"
          />
          <div style={{ width: '1px', height: '14px', background: 'var(--border)' }} />
          <Metric label="FRAMES"  value={frameCount.toLocaleString()} />
        </>
      )}

      {/* Version tag */}
      <span style={{ color: 'var(--text-tertiary)', fontSize: '10px', marginLeft: '8px' }}>
        BLD/assignment
      </span>
    </div>
  );
}

export default StatusBar;
