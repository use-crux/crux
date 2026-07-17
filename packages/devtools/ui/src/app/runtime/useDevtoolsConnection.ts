/**
 * WebSocket lifecycle management for devtools.
 *
 * Handles connect, reconnect with delay, and cleanup.
 * No state management — delegates all messages to callbacks.
 *
 * @module
 */

import { useEffect, useRef } from "react";

const RECONNECT_DELAY = 2000;

export interface UseDevtoolsConnectionOptions {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Called for each incoming WebSocket message. */
  onMessage: (event: MessageEvent) => void;
  /** Called when the WebSocket connection opens. */
  onConnected: () => void;
  /** Called when the WebSocket connection closes. */
  onDisconnected: () => void;
  /** Bumped to force-recreate the socket immediately, bypassing the
   *  standard 2s backoff. Used by the "Retry now" affordance in the
   *  connection banner. Default `0`. */
  retrySignal?: number;
}

/**
 * Manages a WebSocket connection with automatic reconnection.
 *
 * Callbacks are stored in refs to avoid triggering reconnect loops
 * when parent re-renders with new function references. `retrySignal`
 * is intentionally read fresh on each render so a bump triggers an
 * immediate reconnect.
 */
export function useDevtoolsConnection(
  options: UseDevtoolsConnectionOptions,
): void {
  const urlRef = useRef(options.url);
  const onMessageRef = useRef(options.onMessage);
  const onConnectedRef = useRef(options.onConnected);
  const onDisconnectedRef = useRef(options.onDisconnected);

  // Keep refs up to date
  urlRef.current = options.url;
  onMessageRef.current = options.onMessage;
  onConnectedRef.current = options.onConnected;
  onDisconnectedRef.current = options.onDisconnected;

  const retrySignal = options.retrySignal ?? 0;

  useEffect(() => {
    let wsRef: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (wsRef?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(urlRef.current);
      wsRef = ws;

      ws.onopen = () => {
        onConnectedRef.current();
      };

      ws.onmessage = (event) => {
        onMessageRef.current(event);
      };

      ws.onclose = () => {
        wsRef = null;
        onDisconnectedRef.current();
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef?.close();
    };
    // `retrySignal` in the dep array causes the effect to tear down the
    // existing socket and call `connect()` again immediately — that's
    // the "Retry now" path. The other deps are intentionally stable
    // via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrySignal]);
}
