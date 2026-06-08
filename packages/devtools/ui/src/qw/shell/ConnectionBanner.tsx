/**
 * Connection-loss banner.
 *
 * Renders above the page body when the devtools WebSocket is
 * disconnected. The auto-reconnect loop in `useDevtoolsConnection`
 * already retries every 2s, so this banner is informational + a
 * manual "Retry now" affordance that bypasses the standard backoff.
 *
 * Stays visible while the WS is offline; disappears immediately once
 * the reconnect lands. Updates the "Xs ago" relative timestamp on a
 * 1s tick.
 */

import { useEffect, useState } from 'react'
import { Icon } from '@/qw/shell/Icon'
import { dispatchRuntime, useConnected, useDisconnectedAt } from '@/app/runtime/runtimeStore'

function formatSince(ms: number | null): string {
  if (ms == null) return 'just now'
  const diff = Math.max(0, Date.now() - ms)
  if (diff < 1000) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

export function ConnectionBanner() {
  const connected = useConnected()
  const disconnectedAt = useDisconnectedAt()
  // Tick once a second so the "Xs ago" label updates without re-rendering
  // the rest of the shell.
  const [, force] = useState(0)
  useEffect(() => {
    if (connected) return
    const id = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [connected])

  if (connected) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-shrink-0 items-center gap-3 px-8 py-2 text-[12.5px]"
      style={{
        background: 'var(--qw-warn-soft)',
        color: 'var(--qw-fg)',
        borderBottom: '1px solid var(--qw-border)',
      }}
    >
      <span
        aria-hidden
        className="animate-running-pulse inline-block rounded-full"
        style={{ width: 8, height: 8, background: 'var(--qw-warn)' }}
      />
      <span className="font-medium" style={{ color: 'var(--qw-warn)' }}>
        Disconnected from devtools server
      </span>
      <span style={{ color: 'var(--qw-fg-muted)' }}>
        · {disconnectedAt ? `last update ${formatSince(disconnectedAt)} · reconnecting…` : 'reconnecting…'}
      </span>
      <button
        type="button"
        onClick={() => dispatchRuntime({ type: 'REQUEST_RECONNECT' })}
        className="ml-auto inline-flex items-center gap-1.5 rounded-[5px] px-2 py-[3px] font-mono text-[11px] transition-colors hover:opacity-90"
        style={{
          background: 'var(--qw-bg)',
          color: 'var(--qw-fg)',
          border: '1px solid var(--qw-border)',
        }}
        title="Force an immediate reconnect attempt (bypasses the 2 s backoff)"
      >
        <Icon name="loop" size={11} color="var(--qw-warn)" />
        Retry now
      </button>
    </div>
  )
}
