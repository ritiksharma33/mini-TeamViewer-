/**
 * BrowserCanvas.jsx
 *
 * The heart of the UI — an HTML5 <canvas> that:
 * 1. Renders every JPEG frame received from the server
 * 2. Captures all mouse and keyboard events
 * 3. Scales coordinates correctly between the displayed canvas
 * size and the actual Chromium viewport (1280×720)
 *
 * Coordinate scaling is critical — if you don't scale, clicking on
 * the left half of the canvas will click the left quarter in Chromium.
 * Formula: chromiumX = eventX * (1280 / canvasDisplayWidth)
 */

import { useRef, useEffect, useCallback, useState } from 'react';

// Chromium viewport size — must match the server-side page.setViewport() call
const CHROMIUM_W = 1280;
const CHROMIUM_H = 720;

// Throttle mouse move events — Chromium can't process 60+ moves/sec usefully
const MOUSEMOVE_THROTTLE_MS = 32; // ~30 fps for mouse movement

export function BrowserCanvas({ send, isLive, onFrame, style }) {
  const canvasRef       = useRef(null);
  const lastMoveTime    = useRef(0);
  const isFocused       = useRef(false);
  const [showCursor, setShowCursor] = useState(false);

  // ── Draw incoming frames ─────────────────────────────────────────────────

  // Exposed as a ref so the parent can call it without re-rendering this component
  const drawFrame = useCallback((base64Jpeg) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (onFrame) onFrame();
    };
    img.src = 'data:image/jpeg;base64,' + base64Jpeg;
  }, [onFrame]);

  // Expose drawFrame to parent via a ref callback on the canvas element
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.drawFrame = drawFrame;
    }
  }, [drawFrame]);

  // ── Coordinate scaling ───────────────────────────────────────────────────

  const getScaledCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (CHROMIUM_W / rect.width)),
      y: Math.round((e.clientY - rect.top)  * (CHROMIUM_H / rect.height)),
    };
  }, []);

  // ── Mouse handlers ───────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e) => {
    if (!isLive) return;
    const now = Date.now();
    if (now - lastMoveTime.current < MOUSEMOVE_THROTTLE_MS) return;
    lastMoveTime.current = now;
    send({ type: 'mousemove', ...getScaledCoords(e) });
  }, [isLive, send, getScaledCoords]);

  const handleClick = useCallback((e) => {
    if (!isLive) return;
    canvasRef.current?.focus();
    send({ type: 'click', ...getScaledCoords(e), button: e.button });
  }, [isLive, send, getScaledCoords]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    if (!isLive) return;
    send({ type: 'click', ...getScaledCoords(e), button: 2 });
  }, [isLive, send, getScaledCoords]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!isLive) return;
    send({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
  }, [isLive, send]);

  const handleMouseEnter = useCallback(() => setShowCursor(true),  []);
  const handleMouseLeave = useCallback(() => setShowCursor(false), []);

  // ── Keyboard handlers ────────────────────────────────────────────────────
  // We attach to window so keyboard input works without the canvas needing
  // explicit focus — a better UX since the canvas isn't a form element.

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isLive) return;

      // 🛑 THE FIX: Ignore keystrokes if the user is typing in an input field (like the URL bar)
      // This allows you to type normally without the canvas stealing the keys
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }

      // Don't interfere with browser devtools and page refresh shortcuts
      // but block most others so they go to Chromium instead
      const PASS_THROUGH = ['F5', 'F12'];
      if (PASS_THROUGH.includes(e.key)) return;

      // Block Ctrl+W (close tab), Ctrl+T (new tab) etc. from affecting host browser
      if ((e.ctrlKey || e.metaKey) && ['w', 't', 'n'].includes(e.key.toLowerCase())) {
        // Let these pass through — they affect the host page
        return;
      }

      e.preventDefault();
      send({
        type:     'keypress',
        key:      e.key,
        code:     e.code,
        ctrlKey:  e.ctrlKey,
        altKey:   e.altKey,
        shiftKey: e.shiftKey,
        metaKey:  e.metaKey,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLive, send]);

  // ── Wheel event (non-passive, so we can preventDefault) ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', lineHeight: 0, ...style }}>
      <canvas
        ref={canvasRef}
        width={CHROMIUM_W}
        height={CHROMIUM_H}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        tabIndex={0}
        aria-label="Remote browser viewport — interact with the remote browser here"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          cursor: isLive ? (showCursor ? 'crosshair' : 'default') : 'not-allowed',
          outline: 'none',
          // Subtle glow when live
          boxShadow: isLive
            ? '0 0 0 1px var(--border), 0 0 20px rgba(0,229,255,0.05)'
            : '0 0 0 1px var(--border)',
        }}
      />

      {/* Overlay shown when browser is not yet live */}
      {!isLive && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(10,10,11,0.92)',
          gap: '12px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '1.5px solid var(--border-bright)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            Click <strong style={{ color: 'var(--text-secondary)' }}>Start Browser</strong> to begin
          </p>
        </div>
      )}
    </div>
  );
}

export default BrowserCanvas;