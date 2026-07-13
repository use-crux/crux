import { Streamdown } from 'streamdown'
import { JsonTree } from '@/shared/components/JsonTree'
import { Icon } from '@/qw/shell/Icon'
import { canonicalKind, kindColor, kindIcon, parseMaybeJson } from '@/features/run-detail/lib/replay-format'
import type { ReplayEventInput, ReplayEventPayload } from '@/features/run-detail/types'

export function ReplayEventRow({ event: e, dim }: { event: ReplayEventInput; dim?: boolean }) {
  const canon = canonicalKind(e.kind)
  const color = kindColor(e.kind)
  const useSerif = canon === 'generate' || canon === 'output' || canon === 'input'
  const icon = kindIcon(e.kind)
  const kindLabel = canon || e.kind

  return (
    <div className="relative grid gap-0" style={{ gridTemplateColumns: '92px 36px 1fr', opacity: dim ? 0.55 : 1 }}>
      <div className="pt-3.5 pr-3 text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {e.t}
      </div>
      <div className="relative flex justify-center">
        <div className="absolute inset-y-0 w-px" style={{ background: 'var(--qw-border)' }} />
        <div
          className="absolute top-3 flex size-[18px] items-center justify-center rounded-full"
          style={{
            background: color,
            border: '2px solid var(--qw-bg)',
            boxShadow: `0 0 0 1px ${color}33`,
          }}
        >
          {icon && <Icon name={icon} size={10} color="var(--qw-bg)" strokeWidth={2} />}
        </div>
      </div>
      <div className="pb-4 pt-1.5">
        <div className="mb-1.5 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.06em]"
            style={{
              color,
              background: 'var(--qw-bg)',
              boxShadow: `inset 0 0 0 1px ${color}`,
            }}
          >
            {icon && <Icon name={icon} size={9} color={color} strokeWidth={2} />}
            {kindLabel}
          </span>
          <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--qw-fg)' }}>
            {e.who}
          </span>
          {e.meta && (
            <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {e.meta}
            </span>
          )}
        </div>
        <EventBody event={e} useSerif={useSerif} color={color} />
      </div>
    </div>
  )
}

function EventBody({ event: e, useSerif, color }: { event: ReplayEventInput; useSerif: boolean; color: string }) {
  const canon = canonicalKind(e.kind)
  const isUser = e.who === 'user' || canon === 'input'
  const isMarkdownish = canon === 'generate' || canon === 'output'
  const inlineJson = parseMaybeJson(e.what)
  const renderBody = e.body != null ? e.body : inlineJson
  const notesTone = e.notesTone ?? 'warn'
  const noteColor =
    notesTone === 'danger'
      ? 'var(--qw-danger)'
      : notesTone === 'ok'
        ? 'var(--qw-ok)'
        : notesTone === 'muted'
          ? 'var(--qw-fg-muted)'
          : 'var(--qw-warn)'
  const noteGlyph = notesTone === 'danger' ? '✕' : notesTone === 'ok' ? '✓' : notesTone === 'muted' ? '·' : '⚠'

  return (
    <div
      className="rounded-[10px] px-3.5 py-3 leading-[1.55]"
      style={{
        background: isUser ? 'var(--qw-bg-muted)' : 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        borderLeft: `2px solid ${color}`,
        fontSize: isUser ? 14 : 13,
        fontFamily: (useSerif || isUser) && !inlineJson && !renderBody ? 'var(--qw-serif)' : undefined,
      }}
    >
      {!inlineJson && (
        <div className="whitespace-pre-wrap break-words">
          {isMarkdownish ? <Streamdown>{e.what}</Streamdown> : <RichHeadline text={e.what} />}
        </div>
      )}
      {e.detail && (
        <div className="mt-2 text-[12px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)' }}>
          {e.detail}
        </div>
      )}
      {e.payload ? (
        <KindPayload payload={e.payload} color={color} />
      ) : renderBody != null ? (
        <BodyRenderer kind={e.kind} body={renderBody} />
      ) : null}
      {e.notes && (
        <div className="mt-2 font-mono text-[11px]" style={{ color: noteColor }}>
          {noteGlyph} {e.notes}
        </div>
      )}
    </div>
  )
}

function RichHeadline({ text }: { text: string }) {
  if (!text.includes(' · ') && !text.includes(' → ')) {
    return <span>{text}</span>
  }

  const parts = text.split(/( · | → )/)
  return (
    <span>
      {parts.map((part, i) => {
        if (part === ' · ' || part === ' → ') {
          return (
            <span key={i} style={{ color: 'var(--qw-fg-faint)' }}>
              {part}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

function KindPayload({ payload, color }: { payload: ReplayEventPayload; color: string }) {
  switch (payload.type) {
    case 'tool':
      return <ToolPayload payload={payload} color={color} />
    case 'memory':
      return <MemoryPayload payload={payload} />
    case 'retrieval':
      return <RetrievalPayload payload={payload} />
    case 'handoff':
      return <HandoffPayload payload={payload} />
    case 'score':
      return <ScorePayload payload={payload} color={color} />
    case 'error':
      return <ErrorPayload payload={payload} />
    default:
      return null
  }
}

function PayloadSection({
  label,
  children,
  tone,
}: {
  label: string
  children: React.ReactNode
  tone?: 'default' | 'ok' | 'warn' | 'danger'
}) {
  const labelColor =
    tone === 'ok'
      ? 'var(--qw-ok)'
      : tone === 'warn'
        ? 'var(--qw-warn)'
        : tone === 'danger'
          ? 'var(--qw-danger)'
          : 'var(--qw-fg-faint)'
  return (
    <div className="mt-2.5">
      <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.08em]" style={{ color: labelColor }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function PayloadCode({ children, maxHeight = 220 }: { children: React.ReactNode; maxHeight?: number }) {
  return (
    <div
      className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
      style={{
        background: 'var(--qw-bg)',
        border: '1px solid var(--qw-border)',
        maxHeight,
      }}
    >
      {children}
    </div>
  )
}

function ToolPayload({ payload, color }: { payload: Extract<ReplayEventPayload, { type: 'tool' }>; color: string }) {
  const isErr = payload.status === 'error' || payload.status === 'failed' || payload.error
  return (
    <>
      {payload.args != null && (
        <PayloadSection label="Arguments">
          <PayloadCode>
            {typeof payload.args === 'string' ? (
              <span style={{ color: 'var(--qw-fg)' }}>{payload.args}</span>
            ) : (
              <JsonTree data={payload.args} />
            )}
          </PayloadCode>
        </PayloadSection>
      )}
      {payload.result != null && !isErr && (
        <PayloadSection label="Result" tone="ok">
          <PayloadCode>
            {typeof payload.result === 'string' ? (
              <span style={{ color: 'var(--qw-fg)' }}>{payload.result}</span>
            ) : (
              <JsonTree data={payload.result} />
            )}
          </PayloadCode>
        </PayloadSection>
      )}
      {isErr && payload.error && (
        <PayloadSection label="Error" tone="danger">
          <div
            className="rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5]"
            style={{
              background: 'var(--qw-danger-soft)',
              color: 'var(--qw-danger)',
              border: '1px solid var(--qw-danger-line, var(--qw-danger))',
            }}
          >
            {payload.error}
          </div>
        </PayloadSection>
      )}
      {payload.status && payload.status !== 'success' && payload.status !== 'ok' && !isErr && (
        <PayloadSection label="Status">
          <span
            className="rounded-[3px] px-1.5 py-px font-mono text-[10.5px]"
            style={{
              color,
              background: 'var(--qw-bg)',
              boxShadow: `inset 0 0 0 1px ${color}`,
            }}
          >
            {payload.status}
          </span>
        </PayloadSection>
      )}
    </>
  )
}

function MemoryPayload({ payload }: { payload: Extract<ReplayEventPayload, { type: 'memory' }> }) {
  const op = payload.operation || ''
  const isWrite = op === 'set' || op === 'append' || op === 'write' || op === 'put'
  const isQuery = op === 'query' || op === 'search' || !!payload.query
  return (
    <>
      {payload.key && (
        <PayloadSection label="Key">
          <code
            className="rounded-[3px] px-1.5 py-px font-mono text-[11.5px]"
            style={{
              color: 'var(--qw-iris)',
              background: 'var(--qw-bg)',
              boxShadow: 'inset 0 0 0 1px var(--qw-border)',
            }}
          >
            {payload.key}
          </code>
        </PayloadSection>
      )}
      {payload.query && (
        <PayloadSection label="Query">
          <div className="font-serif text-[12.5px] leading-[1.55]">{payload.query}</div>
        </PayloadSection>
      )}
      {payload.value != null && (
        <PayloadSection label={isWrite ? 'Value (written)' : isQuery ? 'Result' : 'Value'}>
          <PayloadCode>
            {typeof payload.value === 'string' ? (
              <div className="font-serif text-[12.5px] leading-[1.55]" style={{ fontFamily: 'var(--qw-serif)' }}>
                {payload.value}
              </div>
            ) : (
              <JsonTree data={payload.value} />
            )}
          </PayloadCode>
        </PayloadSection>
      )}
    </>
  )
}

function RetrievalPayload({ payload }: { payload: Extract<ReplayEventPayload, { type: 'retrieval' }> }) {
  const hits = Array.isArray(payload.hits) ? payload.hits : []
  return (
    <>
      {payload.query && (
        <PayloadSection label="Query">
          <div className="font-serif text-[12.5px] leading-[1.55]">"{payload.query}"</div>
        </PayloadSection>
      )}
      {hits.length > 0 && (
        <PayloadSection label={`Hits${payload.k != null ? ` · k=${payload.k}` : ''}`}>
          <div className="flex flex-col gap-1.5">
            {hits.slice(0, 8).map((hit: unknown, i: number) => {
              const h = (hit ?? {}) as Record<string, unknown>
              const source = typeof h.source === 'object' && h.source !== null ? h.source as Record<string, unknown> : undefined
              const id = String(h.id ?? h.chunkId ?? source?.id ?? h.path ?? `hit-${i}`)
              const score = typeof h.score === 'number' ? h.score : undefined
              const preview =
                typeof h.contentPreview === 'string'
                  ? h.contentPreview
                  : typeof h.text === 'string'
                    ? h.text
                    : typeof h.content === 'string'
                      ? h.content
                      : ''
              return (
                <div
                  key={i}
                  className="rounded-[6px] px-2.5 py-1.5"
                  style={{
                    background: 'var(--qw-bg)',
                    border: '1px solid var(--qw-border)',
                  }}
                >
                  <div className="mb-0.5 flex items-baseline gap-2 font-mono text-[10.5px]">
                    <span style={{ color: 'var(--qw-crux)' }}>›</span>
                    <span style={{ color: 'var(--qw-fg-muted)' }}>{id}</span>
                    {score != null && (
                      <span
                        className="ml-auto rounded-[3px] px-1 py-px"
                        style={{
                          background: score >= 0.7 ? 'var(--qw-ok-soft)' : 'var(--qw-warn-soft)',
                          color: score >= 0.7 ? 'var(--qw-ok)' : 'var(--qw-warn)',
                        }}
                      >
                        {score.toFixed(3)}
                      </span>
                    )}
                  </div>
                  {preview && (
                    <div className="text-[12px] leading-[1.5]" style={{ color: 'var(--qw-fg)' }}>
                      {preview.slice(0, 280)}
                      {preview.length > 280 ? '...' : ''}
                    </div>
                  )}
                </div>
              )
            })}
            {hits.length > 8 && (
              <div className="text-[10.5px]" style={{ color: 'var(--qw-fg-faint)', fontFamily: 'var(--qw-mono)' }}>
                +{hits.length - 8} more
              </div>
            )}
          </div>
        </PayloadSection>
      )}
    </>
  )
}

function HandoffPayload({ payload }: { payload: Extract<ReplayEventPayload, { type: 'handoff' }> }) {
  return (
    <>
      {(payload.from || payload.to) && (
        <PayloadSection label="Transfer">
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span style={{ color: 'var(--qw-fg-muted)' }}>{payload.from ?? '-'}</span>
            <Icon name="arrowRight" size={12} color="var(--qw-iris)" />
            <span style={{ color: 'var(--qw-fg)', fontWeight: 600 }}>{payload.to ?? '-'}</span>
          </div>
        </PayloadSection>
      )}
      {payload.reason && (
        <PayloadSection label="Reason">
          <div className="text-[12.5px]">{payload.reason}</div>
        </PayloadSection>
      )}
      {payload.payload != null && (
        <PayloadSection label="Payload">
          <PayloadCode>
            <JsonTree data={payload.payload} />
          </PayloadCode>
        </PayloadSection>
      )}
    </>
  )
}

function ScorePayload({ payload, color }: { payload: Extract<ReplayEventPayload, { type: 'score' }>; color: string }) {
  const score = payload.score
  const threshold = payload.threshold
  const passed = score != null && threshold != null ? score >= threshold : undefined
  const pct = score != null ? Math.max(0, Math.min(1, score)) * 100 : 0
  const barColor = passed === true ? 'var(--qw-ok)' : passed === false ? 'var(--qw-danger)' : color
  return (
    <>
      {score != null && (
        <PayloadSection label={passed === true ? 'Score · pass' : passed === false ? 'Score · fail' : 'Score'}>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[18px] font-semibold tabular-nums" style={{ color: barColor }}>
              {score.toFixed(2)}
            </span>
            <div
              className="relative h-[6px] flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--qw-bg-muted)' }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${pct}%`, background: barColor }}
              />
              {threshold != null && (
                <div
                  className="absolute inset-y-[-2px] w-px"
                  style={{
                    left: `${Math.max(0, Math.min(1, threshold)) * 100}%`,
                    background: 'var(--qw-fg-faint)',
                  }}
                  title={`threshold ${threshold.toFixed(2)}`}
                />
              )}
            </div>
            {threshold != null && (
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                threshold {threshold.toFixed(2)}
              </span>
            )}
          </div>
        </PayloadSection>
      )}
      {payload.breakdown && Object.keys(payload.breakdown).length > 0 && (
        <PayloadSection label="Breakdown">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(payload.breakdown).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-baseline gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px]"
                style={{
                  background: 'var(--qw-bg)',
                  border: '1px solid var(--qw-border)',
                  color: 'var(--qw-fg-muted)',
                }}
              >
                {k}
                <span
                  style={{
                    color:
                      v >= 0.85
                        ? 'var(--qw-ok)'
                        : v >= 0.6
                          ? 'var(--qw-crux)'
                          : v < 0.4
                            ? 'var(--qw-danger)'
                            : 'var(--qw-warn)',
                    fontWeight: 600,
                  }}
                >
                  {v.toFixed(2)}
                </span>
              </span>
            ))}
          </div>
        </PayloadSection>
      )}
      {payload.rationale && (
        <PayloadSection label="Rationale">
          <div className="font-serif text-[12.5px] leading-[1.55]" style={{ color: 'var(--qw-fg)' }}>
            {payload.rationale}
          </div>
        </PayloadSection>
      )}
    </>
  )
}

function ErrorPayload({ payload }: { payload: Extract<ReplayEventPayload, { type: 'error' }> }) {
  return (
    <>
      {payload.message && (
        <PayloadSection label={payload.category ? `Error · ${payload.category}` : 'Error'} tone="danger">
          <div
            className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] leading-[1.5]"
            style={{
              background: 'var(--qw-danger-soft)',
              color: 'var(--qw-danger)',
              border: '1px solid var(--qw-danger)',
            }}
          >
            {payload.message}
          </div>
        </PayloadSection>
      )}
      {payload.stack && (
        <PayloadSection label="Stack">
          <PayloadCode maxHeight={160}>
            <pre className="whitespace-pre-wrap break-words" style={{ color: 'var(--qw-fg-muted)' }}>
              {payload.stack}
            </pre>
          </PayloadCode>
        </PayloadSection>
      )}
    </>
  )
}

function BodyRenderer({ kind, body }: { kind: string; body: unknown }) {
  if ((kind === 'retrieval' || kind === 'retrieve') && Array.isArray(body)) {
    return (
      <div className="mt-2 flex flex-col gap-1">
        {body.slice(0, 8).map((hit: unknown, i: number) => {
          const h = (hit ?? {}) as Record<string, unknown>
          const source = typeof h.source === 'object' && h.source !== null ? h.source as Record<string, unknown> : undefined
          const id = String(h.id ?? h.chunkId ?? source?.id ?? h.path ?? `hit-${i}`)
          const score = typeof h.score === 'number' ? h.score : undefined
          const preview =
            typeof h.contentPreview === 'string'
              ? h.contentPreview
              : typeof h.text === 'string'
                ? h.text
                : typeof h.content === 'string'
                  ? h.content
                  : ''
          return (
            <div key={i} className="flex items-baseline gap-2 font-mono text-[11px]">
              <span style={{ color: 'var(--qw-crux)' }}>›</span>
              <span style={{ color: 'var(--qw-fg-muted)' }}>{id}</span>
              {score != null && (
                <span
                  className="rounded-[3px] px-1 py-px text-[10.5px]"
                  style={{
                    background: score >= 0.7 ? 'var(--qw-ok-soft)' : 'var(--qw-warn-soft)',
                    color: score >= 0.7 ? 'var(--qw-ok)' : 'var(--qw-warn)',
                  }}
                >
                  {score.toFixed(2)}
                </span>
              )}
              {preview && (
                <span className="truncate" style={{ color: 'var(--qw-fg)', fontFamily: 'var(--qw-sans)' }}>
                  {preview.slice(0, 220)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (typeof body === 'string') {
    return (
      <div className="mt-2 text-[12.5px] leading-[1.55]" style={{ fontFamily: 'var(--qw-serif)' }}>
        <Streamdown>{body}</Streamdown>
      </div>
    )
  }

  return (
    <div
      className="mt-2 max-h-[260px] overflow-auto rounded-[6px] px-3 py-2 font-mono text-[11.5px]"
      style={{
        background: 'var(--qw-bg)',
        border: '1px solid var(--qw-border)',
      }}
    >
      <JsonTree data={body} />
    </div>
  )
}
