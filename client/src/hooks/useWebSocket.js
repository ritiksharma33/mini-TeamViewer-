/**
 * useWebSocket.js
 *
 * Custom React hook that manages a WebSocket connection to the backend.
 *
 * Features:
 * - Auto-reconnect on disconnect (up to maxRetries attempts)
 * - Exposes a type-safe send() function
 * - Tracks connection status and the last received message
 * - Counts reconnect attempts for UI display
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = `ws://${window.location.hostname}:3001`;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

/**
 * @typedef {'idle'|'connecting'|'connected'|'disconnected'|'error'} WsStatus
 */

/**
 * @returns {{
 * send: (msg: object) => void,
 * lastMessage: object|Blob|null,
 * status: WsStatus,
 * retryCount: number,
 * }}
 */
export function useWebSocket() {
  const wsRef        = useRef(null);
  const retryTimer   = useRef(null);
  const retryCount   = useRef(0);
  const isMounted    = useRef(true);

  const [lastMessage, setLastMessage] = useState(null);
  const [status,      setStatus]      = useState('idle');
  const [retries,     setRetries]     = useState(0);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    setStatus('connecting');
    console.log(`[WS] Connecting to ${WS_URL} (attempt ${retryCount.current + 1})`);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMounted.current) return;
      console.log('[WS] Connected');
      retryCount.current = 0;
      setRetries(0);
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      if (!isMounted.current) return;
      
      // ⚡️ FIX: If the message is raw binary data, skip JSON parsing entirely
      if (event.data instanceof Blob) {
        setLastMessage(event.data);
        return;
      }

      try {
        const msg = JSON.parse(event.data);
        setLastMessage(msg);
      } catch {
        console.error('[WS] Failed to parse message');
      }
    };

    ws.onclose = (event) => {
      if (!isMounted.current) return;
      console.log(`[WS] Closed (code: ${event.code})`);
      setStatus('disconnected');

      // Auto-reconnect unless we've hit the limit or it was a clean close
      if (retryCount.current < MAX_RETRIES) {
        retryCount.current++;
        setRetries(retryCount.current);
        console.log(`[WS] Reconnecting in ${RETRY_DELAY_MS}ms...`);
        retryTimer.current = setTimeout(connect, RETRY_DELAY_MS);
      } else {
        setStatus('error');
        console.error('[WS] Max retries reached');
      }
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      // onclose will fire after onerror, which handles retry logic
    };
  }, []);

  useEffect(() => {
    isMounted.current = true;
    connect();

    return () => {
      isMounted.current = false;
      clearTimeout(retryTimer.current);
      if (wsRef.current) {
        // Code 1000 = normal closure — suppresses auto-reconnect
        wsRef.current.close(1000);
      }
    };
  }, [connect]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn('[WS] Cannot send — socket not open:', msg.type);
    }
  }, []);

  return { send, lastMessage, status, retryCount: retries };
}