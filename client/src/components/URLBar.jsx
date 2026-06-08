/**
 * URLBar.jsx
 *
 * Browser-style address bar. Sends a 'navigate' message on Enter.
 * Syncs displayed URL whenever the server reports a URL change.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export function URLBar({ currentUrl, onNavigate, isLive }) {
  const [inputVal, setInputVal] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  // When the server reports a URL change (e.g. link click inside the browser),
  // update the displayed URL — but only if the user isn't currently typing
  useEffect(() => {
    if (!isFocused && currentUrl) {
      setInputVal(currentUrl);
    }
  }, [currentUrl, isFocused]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!isLive || !inputVal.trim()) return;
    onNavigate(inputVal.trim());
    inputRef.current?.blur();
  }, [isLive, inputVal, onNavigate]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    // Select all text on focus — matches browser behavior
    inputRef.current?.select();
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: 1,
      }}
    >
      {/* Protocol indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
      }}>
        {/* Lock / globe icon based on URL protocol */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={currentUrl?.startsWith('https://') ? 'var(--green)' : 'var(--text-tertiary)'}
          strokeWidth="2"
          style={{ flexShrink: 0 }}
        >
          {currentUrl?.startsWith('https://') ? (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </>
          ) : (
            <circle cx="12" cy="12" r="10"/>
          )}
        </svg>
      </div>

      {/* URL input */}
      <input
        ref={inputRef}
        type="text"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={isLive ? 'Enter URL and press Enter...' : 'Start browser first'}
        disabled={!isLive}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        style={{
          flex: 1,
          height: '32px',
          background: 'var(--bg-base)',
          border: `1px solid ${isFocused ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          padding: '0 10px',
          outline: 'none',
          transition: 'border-color var(--transition)',
          opacity: isLive ? 1 : 0.5,
        }}
      />

      {/* Go button */}
      <button
        type="submit"
        disabled={!isLive}
        title="Navigate (Enter)"
        style={{
          height: '32px',
          padding: '0 12px',
          background: isLive ? 'var(--accent-dim)' : 'transparent',
          border: `1px solid ${isLive ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          color: isLive ? 'var(--accent)' : 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          cursor: isLive ? 'pointer' : 'not-allowed',
          transition: 'all var(--transition)',
          flexShrink: 0,
          letterSpacing: '0.05em',
        }}
      >
        GO
      </button>
    </form>
  );
}

export default URLBar;
