/**
 * ActionLog.jsx
 *
 * Sidebar panel showing a live, scrolling log of every user action
 * (clicks, navigations, keypresses, screenshots, system events).
 *
 * Design choice: fixed width sidebar, entries animate in from the right,
 * color-coded by action type, newest entries at the top.
 */

import { useRef, useEffect } from 'react';

const TYPE_STYLES = {
  nav:        { color: 'var(--accent)',          icon: '→' },
  click:      { color: 'var(--text-primary)',    icon: '↖' },
  key:        { color: 'var(--text-secondary)',  icon: '⌨' },
  scroll:     { color: 'var(--text-tertiary)',   icon: '↕' },
  screenshot: { color: 'var(--amber)',           icon: '⬡' },
  system:     { color: 'var(--text-tertiary)',   icon: '◆' },
  error:      { color: 'var(--red)',             icon: '✕' },
};

function LogEntry({ entry, isNew }) {
  const style = TYPE_STYLES[entry.type] || TYPE_STYLES.system;

  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      padding: '6px 0',
      borderBottom: '1px solid var(--border)',
      animation: isNew ? 'slide-in-right 150ms ease' : 'none',
      alignItems: 'flex-start',
    }}>
      {/* Type icon */}
      <span style={{
        color: style.color,
        fontSize: '11px',
        flexShrink: 0,
        width: '14px',
        textAlign: 'center',
        marginTop: '1px',
        fontFamily: 'var(--font-mono)',
      }}>
        {style.icon}
      </span>

      {/* Description */}
      <span style={{
        color: 'var(--text-secondary)',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        flex: 1,
        lineHeight: 1.5,
        wordBreak: 'break-all',
      }}>
        {entry.description}
      </span>

      {/* Timestamp */}
      <span style={{
        color: 'var(--text-tertiary)',
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        flexShrink: 0,
        marginTop: '1px',
      }}>
        {entry.timestamp}
      </span>
    </div>
  );
}

export function ActionLog({ log, onClear }) {
  const scrollRef = useRef(null);

  // Scroll to top on new entry (newest at top, so no scroll needed — but
  // if you flip to bottom-up, this ensures visibility)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [log.length]);

  return (
    <div style={{
      width: '280px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingInline: '12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: log.length > 0 ? 'var(--green)' : 'var(--border-bright)',
          }} />
          <span style={{
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.08em',
          }}>
            ACTION LOG
          </span>
          <span style={{
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            borderRadius: '3px',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            padding: '0 4px',
          }}>
            {log.length}
          </span>
        </div>

        {/* Clear button */}
        {log.length > 0 && (
          <button
            onClick={onClear}
            title="Clear log"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              padding: '2px 4px',
              borderRadius: 'var(--radius-sm)',
              transition: 'color var(--transition)',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--red)'}
            onMouseLeave={e => e.target.style.color = 'var(--text-tertiary)'}
          >
            CLEAR
          </button>
        )}
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 12px',
        }}
      >
        {log.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '80px',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
          }}>
            No actions yet
          </div>
        ) : (
          log.map((entry, i) => (
            <LogEntry key={entry.id} entry={entry} isNew={i === 0} />
          ))
        )}
      </div>

      {/* Legend */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '8px 12px',
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        {Object.entries(TYPE_STYLES).slice(0, 4).map(([type, s]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: s.color, fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              {s.icon}
            </span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              {type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActionLog;
