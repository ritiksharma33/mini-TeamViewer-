/**
 * useBrowserMetrics.js
 *
 * Tracks real-time performance metrics for the browser stream:
 *   - FPS (frames per second, measured client-side)
 *   - Latency (round-trip time per frame in milliseconds)
 *   - Total frames received
 *
 * Usage:
 *   const { fps, latency, frameCount, recordFrame } = useBrowserMetrics();
 *   // Call recordFrame(serverTimestamp) for each received frame
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export function useBrowserMetrics() {
  const [fps,        setFps]        = useState(0);
  const [latency,    setLatency]    = useState(0);
  const [frameCount, setFrameCount] = useState(0);

  const frameTimestamps = useRef([]);  // Ring buffer of recent frame times (for FPS)
  const totalFrames     = useRef(0);
  const latencyBuffer   = useRef([]);  // Last 10 latencies for smoothing

  // Every second, compute FPS from how many frames arrived in the last 1000ms
  useEffect(() => {
    const interval = setInterval(() => {
      const now = performance.now();
      const cutoff = now - 1000;
      // Keep only timestamps from the last second
      frameTimestamps.current = frameTimestamps.current.filter(t => t > cutoff);
      setFps(frameTimestamps.current.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  /**
   * Call this every time a new frame arrives from the server.
   * @param {number} serverTs - The Date.now() timestamp embedded in the frame by the server
   */
  const recordFrame = useCallback((serverTs) => {
    const now = performance.now();

    // Record timestamp for FPS calculation
    frameTimestamps.current.push(now);

    // Calculate and smooth latency
    if (serverTs) {
      const lat = Date.now() - serverTs;
      latencyBuffer.current.push(lat);
      if (latencyBuffer.current.length > 10) latencyBuffer.current.shift();
      const avg = latencyBuffer.current.reduce((a, b) => a + b, 0) / latencyBuffer.current.length;
      setLatency(Math.round(avg));
    }

    // Total frame counter
    totalFrames.current++;
    // Update total counter every 10 frames to avoid too many re-renders
    if (totalFrames.current % 10 === 0) {
      setFrameCount(totalFrames.current);
    }
  }, []);

  return { fps, latency, frameCount, recordFrame };
}
