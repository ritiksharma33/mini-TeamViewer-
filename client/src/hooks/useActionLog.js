/**
 * useActionLog.js
 *
 * Maintains a capped list of the last N user actions (clicks, navigations,
 * keypresses, etc.) for display in the sidebar action log panel.
 *
 * Each entry: { id, type, description, timestamp }
 */

import { useState, useCallback, useRef } from 'react';

const MAX_LOG_ENTRIES = 50;

let idCounter = 0;

export function useActionLog() {
  const [log, setLog] = useState([]);
  const logRef = useRef([]);

  const addEntry = useCallback((type, description) => {
    const entry = {
      id: ++idCounter,
      type,          // 'nav' | 'click' | 'key' | 'scroll' | 'system' | 'screenshot'
      description,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    const next = [entry, ...logRef.current].slice(0, MAX_LOG_ENTRIES);
    logRef.current = next;
    setLog(next);
  }, []);

  const clearLog = useCallback(() => {
    logRef.current = [];
    setLog([]);
  }, []);

  return { log, addEntry, clearLog };
}
