/**
 * Live streaming output renderer.
 *
 * While a trace is streaming (`trace.streamProgress.chunks` populated)
 * we want each delta-batch visible as it arrives, with a distinct color
 * highlight per chunk so the user can see where one delta ends and the
 * next begins. A blinking cursor signals "still receiving".
 *
 * Colors rotate through a 10-stop palette (carried over from the
 * original devtools); each color is a translucent fill so the
 * underlying text stays readable.
 */

import { useEffect, useRef } from 'react'

const CHUNK_COLORS = [
  'rgba(245, 158, 11, 0.18)', // amber
  'rgba(56, 189, 248, 0.18)', // sky
  'rgba(16, 185, 129, 0.18)', // emerald
  'rgba(139, 92, 246, 0.18)', // violet
  'rgba(244, 63, 94, 0.18)', // rose
  'rgba(34, 211, 238, 0.18)', // cyan
  'rgba(249, 115, 22, 0.18)', // orange
  'rgba(20, 184, 166, 0.18)', // teal
  'rgba(99, 102, 241, 0.18)', // indigo
  'rgba(236, 72, 153, 0.18)', // pink
]

interface StreamingChunksProps {
  chunks: readonly string[]
  isStreaming: boolean
  maxHeight?: number
}

export function StreamingChunks({ chunks, isStreaming, maxHeight = 384 }: StreamingChunksProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom as new chunks arrive
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chunks.length])

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto rounded-[6px]"
      style={{
        maxHeight,
        background: 'var(--qw-bg)',
        border: '1px solid var(--qw-border)',
      }}
    >
      <pre
        className="m-0 whitespace-pre-wrap px-3.5 py-3 text-[12px] leading-[1.6]"
        style={{ fontFamily: 'var(--qw-mono)', color: 'var(--qw-fg)' }}
      >
        <TokenizedText chunks={chunks} />
        {isStreaming && (
          <span
            className="ml-0.5 inline-block align-middle"
            style={{
              width: 2,
              height: 14,
              background: 'var(--qw-crux)',
              animation: 'running-pulse 1.2s ease-in-out infinite',
            }}
          />
        )}
      </pre>
    </div>
  )
}

export function TokenizedText({
  text,
  chunks,
  showTokenIndex = false,
}: {
  text?: string
  chunks?: readonly string[]
  showTokenIndex?: boolean
}) {
  const sourceChunks = chunks ?? (text != null ? [text] : [])
  let tokenIndex = 0
  return (
    <>
      {sourceChunks.map((chunk, chunkIndex) =>
        tokenizeText(chunk).map((part, partIndex) => {
          if (/^\s+$/.test(part)) return <span key={`${chunkIndex}:${partIndex}`}>{part}</span>
          tokenIndex += 1
          const color = tokenColor(tokenIndex, chunkIndex)
          return (
            <span
              key={`${chunkIndex}:${partIndex}`}
              className="rounded-[2px] px-[1px]"
              title={showTokenIndex ? `token ${tokenIndex}` : undefined}
              style={{
                background: color,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
              }}
            >
              {part}
            </span>
          )
        }),
      )}
    </>
  )
}

export function tokenizedTextCount(text?: string, chunks?: readonly string[]): number {
  const source = chunks ?? (text != null ? [text] : [])
  return source.reduce((count, chunk) => count + tokenizeText(chunk).filter((part) => !/^\s+$/.test(part)).length, 0)
}

function tokenColor(tokenIndex: number, chunkIndex: number): string {
  const hue = (tokenIndex * 137.508 + chunkIndex * 31) % 360
  return `hsla(${hue.toFixed(1)}, 78%, 58%, 0.22)`
}

function tokenizeText(text: string): string[] {
  return text.match(/(\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_])/gu) ?? []
}

/**
 * Header strip showing live stream metrics: TTFT · chunks · bytes · t/s.
 * Mirrors the original devtools' "Streaming progress" card but in the
 * QW design language.
 */
export function StreamingMeta({
  chunksReceived,
  textLength,
  ttftMs,
  tokensPerSecond,
  elapsedMs,
}: {
  chunksReceived: number
  textLength?: number
  ttftMs?: number
  tokensPerSecond?: number
  elapsedMs?: number
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[6px] px-3 py-2 font-mono text-[11px]"
      style={{
        background: 'var(--qw-crux-soft)',
        border: '1px solid var(--qw-crux-line)',
        color: 'var(--qw-fg)',
      }}
    >
      <span
        className="inline-flex size-1.5 rounded-full"
        style={{
          background: 'var(--qw-crux)',
          animation: 'running-pulse 1.2s ease-in-out infinite',
        }}
      />
      <span style={{ color: 'var(--qw-crux)', fontWeight: 600 }}>streaming</span>
      <span style={{ color: 'var(--qw-fg-muted)' }}>
        {chunksReceived} chunk{chunksReceived === 1 ? '' : 's'}
      </span>
      {textLength != null && <span style={{ color: 'var(--qw-fg-muted)' }}>· {textLength.toLocaleString()} chars</span>}
      {ttftMs != null && <span style={{ color: 'var(--qw-fg-muted)' }}>· TTFT {ttftMs}ms</span>}
      {tokensPerSecond != null && (
        <span style={{ color: 'var(--qw-fg-muted)' }}>· {tokensPerSecond.toFixed(1)} t/s</span>
      )}
      {elapsedMs != null && (
        <span style={{ color: 'var(--qw-fg-muted)' }}>· {(elapsedMs / 1000).toFixed(1)}s elapsed</span>
      )}
    </div>
  )
}

export function hasLiveStream(trace: { streamProgress?: { chunks: readonly string[] } | null }): boolean {
  return (trace.streamProgress?.chunks?.length ?? 0) > 0
}
