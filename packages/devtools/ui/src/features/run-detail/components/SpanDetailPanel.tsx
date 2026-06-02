/**
 * Editorial detail pane for the span selected in the Run Inspect waterfall.
 *
 * Drives a primitive-aware view: the inner tab strip and renderers adapt
 * to what the selected node actually is. A generation has a full
 * Context / Tools / Retrieval / Scores / Citations / Metadata strip; a
 * tool.call collapses to Args / Result / Metadata; a memory operation
 * shows snapshots and writes; a handoff shows from/to and payload. The
 * V4 design's "Input + Messages" tabs collapse into a single Context tab
 * that renders the full context-composition view (prompt definition,
 * stacked-bar parts, dropped/excluded, tool inventory, user prompt) when
 * the selected span has `trace.inspect` data.
 *
 * Citations remain a "pending backend projection" stub unless a
 * `citation.report` artifact is present (per CLIENT_SERVER_BOUNDARY §2).
 * Same for the Expected side of the Output tab's diff frame.
 */

import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { JsonTree } from '@/shared/components/JsonTree'
import { SkeletonCard } from '@/shared/components/Skeleton'
// Heavy graph view — only one tab renders it, keep @xyflow out of the
// inspect-mode bundle.
const SpanGraph = lazy(() =>
  import('@/features/run-detail/components/SpanGraph').then((m) => ({ default: m.SpanGraph })),
)
import { nodeFromRunDetail } from '@/features/observability/hooks/useObservabilityGraph'
import { Chip, Eyebrow, Kpi, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { SectionErrorBoundary } from '@/qw/shell/SectionBoundary'
import { StreamingChunks, StreamingMeta, hasLiveStream, tokenizedTextCount } from './StreamingChunks'
import { CardShell, EmptyHint, KeyValue, PendingFromBackend } from './SpanDetailPanelAtoms'
import { ExpectedVsActualFrame, OutputModeToggle, OutputTextView } from './SpanDetailOutputRenderers'
import { useNavigation } from '@/app/navigation/useNavigation'
import type {
  ObservabilityRunDetail,
  ObservabilityRunDetailNode,
  JudgeEventData,
  Trace,
  InspectPart,
  DroppedContext,
  ExcludedContext,
  CorrelatedEvent,
} from '@/types'

// ─── Tab strip ──────────────────────────────────────────────────────

import {
  COMPOSITION_PALETTE,
  KIND_ACCENT,
  TAB_LABEL,
  asString,
  classifyPrimitive,
  findAllArtifacts,
  findArtifact,
  findArtifactDeep,
  findAttribute,
  findNode,
  finishReasonsFor,
  fmtCost,
  fmtDuration,
  fmtTokens,
  gatherDescendants,
  gatherResolvedContexts,
  inspectionOf,
  nodeCost,
  nodeDuration,
  nodeTokens,
  parsePartSource,
  readMetric,
  readMetricDeep,
  resolveMessages,
  resolveModels,
  resolveOutput,
  resolveSpanError,
  shortModelId,
  sourceOf,
  statusLabel,
  statusTone,
  tabsForKind,
  tokenDeltaChunks,
  tokensPerSecond,
  unwrapOutput,
  type InspectionItem,
  type InspectTabId,
  type ModelUse,
  type OutputRenderMode,
  type PrimitiveKind,
  type ResolvedContext,
  type ResolvedOutput,
  type ResolvedSpanError,
} from '../lib/span-detail-inspection'
import { retrievalEntries } from '../lib/span-detail-retrieval'
import { collectToolRequests, resolveToolPayload } from '../lib/span-detail-tool'

// ─── Card primitives ────────────────────────────────────────────────

// ─── Output tab (generation / agent / run) ──────────────────────────

function SpanErrorCard({ error }: { error: ResolvedSpanError }) {
  const meta = [
    error.category ? ['category', error.category] : null,
    error.code ? ['code', error.code] : null,
    error.phase ? ['phase', error.phase] : null,
    error.retryable != null ? ['retryable', String(error.retryable)] : null,
  ].filter((row): row is [string, string] => row != null)

  return (
    <CardShell
      label={
        <span className="flex items-center gap-2">
          <Icon name="alert" size={12} color="var(--qw-danger)" />
          <span>Error</span>
        </span>
      }
      right={
        error.name ? (
          <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-danger)' }}>
            {error.name}
          </span>
        ) : undefined
      }
    >
      <div className="px-3.5 py-3">
        <div className="font-mono text-[12.5px] font-semibold" style={{ color: 'var(--qw-danger)' }}>
          {error.summary}
        </div>

        {meta.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {meta.map(([key, value]) => (
              <KeyValue key={key} k={key} v={value} />
            ))}
          </div>
        )}

        {error.stack && (
          <pre
            className="mt-2 max-h-[220px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11px]"
            style={{
              background: 'var(--qw-bg-muted)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            {error.stack}
          </pre>
        )}

        {error.evidence.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <Eyebrow>Evidence</Eyebrow>
            {error.evidence.map((item) => (
              <div
                key={`${item.kind ?? item.label}:${item.preview}`}
                className="rounded-[6px] px-2.5 py-1.5 font-mono text-[11px]"
                style={{ background: 'var(--qw-bg-muted)', border: '1px solid var(--qw-border)' }}
              >
                <div style={{ color: 'var(--qw-danger)' }}>{item.label}</div>
                <div className="mt-1 break-words" style={{ color: 'var(--qw-fg-muted)' }}>
                  {item.preview}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CardShell>
  )
}

function OutputTab({
  node,
  trace,
  isRoot,
}: {
  node: ObservabilityRunDetailNode
  trace: Trace | undefined
  isRoot: boolean
}) {
  const errorArt = findArtifact(node, 'error.stack') ?? findArtifact(node, 'error.raw')
  const resolved = useMemo(() => resolveOutput(node, trace, isRoot), [node, trace, isRoot])
  const spanError = useMemo(() => resolveSpanError(node), [node])
  const [outputMode, setOutputMode] = useState<OutputRenderMode>('raw')
  const modelInfo = useMemo(() => {
    if (!resolved.owner) return null
    const ms = resolveModels(resolved.owner)
    return ms[0] ?? null
  }, [resolved.owner])
  const fallbackText = resolved.text
  const obj = resolved.text == null ? resolved.object : undefined
  const ownerInfo =
    resolved.owner && resolved.owner.id !== node.id
      ? `from ${resolved.owner.display?.label ?? resolved.owner.name ?? resolved.owner.primitive}`
      : null

  // Pull metrics from the *owner* of the resolved output (e.g. the
  // generation.call that actually produced this text), falling back to the
  // selected node + run-level trace projection.
  const metricSource = resolved.owner ?? node
  const usageMeta = resolved.meta?.usage as Record<string, number> | undefined
  const totalTokens =
    readMetric(metricSource, 'totalTokens') ??
    readMetricDeep(metricSource, 'totalTokens') ??
    (typeof usageMeta?.totalTokens === 'number' ? usageMeta.totalTokens : undefined) ??
    (typeof usageMeta?.outputTokens === 'number' ? usageMeta.outputTokens : undefined)
  const inputTok =
    readMetric(metricSource, 'inputTokens') ??
    (typeof usageMeta?.inputTokens === 'number' ? usageMeta.inputTokens : undefined)
  const outputTok =
    readMetric(metricSource, 'outputTokens') ??
    (typeof usageMeta?.outputTokens === 'number' ? usageMeta.outputTokens : undefined)
  const cachedTok = readMetric(metricSource, 'cachedInputTokens')
  const reasoningTok = readMetric(metricSource, 'reasoningTokens')
  const costN =
    readMetric(metricSource, 'cost') ??
    readMetric(metricSource, 'costUsd') ??
    resolved.meta?.cost ??
    trace?.result?.cost
  const cost = fmtCost(costN)
  const tokens = fmtTokens(totalTokens)
  const tps = tokensPerSecond(metricSource)
  const finishReason =
    (findAttribute(metricSource, 'finishReason') as string | undefined) ??
    resolved.meta?.finishReason ??
    trace?.result?.finishReason
  const eventChunks = useMemo(() => tokenDeltaChunks(node), [node])
  const traceChunks = isRoot ? (trace?.streamProgress?.chunks ?? []) : []
  const streamChunks = eventChunks.length > 0 ? eventChunks : traceChunks
  const streamTextLength = streamChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const isStreaming = node.status === 'running' || (trace?.status === 'running' && isRoot)
  const hasStream = streamChunks.length > 0 || (isRoot && !!trace && hasLiveStream(trace))

  return (
    <div className="flex flex-col gap-4">
      {spanError && <SpanErrorCard error={spanError} />}

      <ExpectedVsActualFrame actual={fallbackText} obj={obj} />

      {!spanError && trace?.error && isRoot && (
        <CardShell label="Error">
          <div className="px-3.5 py-3" style={{ color: 'var(--qw-danger)' }}>
            <div className="font-mono text-[12.5px] font-semibold">{trace.error.message}</div>
            {trace.error.category && (
              <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                category · {trace.error.category}
              </div>
            )}
            {trace.error.stack && (
              <pre
                className="mt-2 max-h-[200px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11px]"
                style={{
                  background: 'var(--qw-bg-muted)',
                  border: '1px solid var(--qw-border)',
                  color: 'var(--qw-fg-muted)',
                }}
              >
                {trace.error.stack}
              </pre>
            )}
          </div>
        </CardShell>
      )}

      {hasStream && (
        <CardShell
          label={isStreaming ? 'Live stream' : 'Stream replay'}
          right={
            <span style={{ color: 'var(--qw-fg-muted)' }}>
              {streamChunks.length} deltas · {tokenizedTextCount(undefined, streamChunks).toLocaleString()} tokens ·{' '}
              {(trace?.streamProgress?.textLength ?? streamTextLength).toLocaleString()} chars
              {trace?.streamProgress?.ttftMs != null ? ` · TTFT ${trace.streamProgress.ttftMs}ms` : ''}
            </span>
          }
        >
          <div className="px-3.5 py-3">
            {isStreaming && (
              <StreamingMeta
                chunksReceived={streamChunks.length}
                textLength={trace?.streamProgress?.textLength ?? streamTextLength}
                ttftMs={trace?.streamProgress?.ttftMs}
                elapsedMs={trace?.streamProgress?.elapsedMs}
              />
            )}
            <div className={isStreaming ? 'mt-3' : ''}>
              <StreamingChunks chunks={streamChunks} isStreaming={isStreaming} maxHeight={420} />
            </div>
          </div>
        </CardShell>
      )}

      <CardShell
        label="Output"
        right={
          <span className="flex items-center gap-2">
            {fallbackText && <OutputModeToggle mode={outputMode} onModeChange={setOutputMode} />}
            {ownerInfo && (
              <span className="font-mono" style={{ color: 'var(--qw-fg-faint)' }}>
                {ownerInfo}
              </span>
            )}
            {modelInfo && (modelInfo.provider || modelInfo.model) && (
              <span className="font-mono" style={{ color: 'var(--qw-iris)' }} title={modelInfo.model}>
                {[modelInfo.provider, shortModelId(modelInfo.model)].filter(Boolean).join(' · ')}
              </span>
            )}
            <span>
              {[
                tokens !== '—' ? tokens : '',
                inputTok != null && outputTok != null
                  ? `(${fmtTokens(inputTok)}↓ / ${fmtTokens(outputTok)}↑${cachedTok ? ` · ${fmtTokens(cachedTok)} cached` : ''}${reasoningTok ? ` · ${fmtTokens(reasoningTok)} reason` : ''})`
                  : '',
                cost !== '—' ? cost : '',
                tps != null ? `${tps.toFixed(1)}t/s` : '',
                finishReason ?? '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        }
      >
        <div className="px-3.5 py-3 text-[13.5px] leading-[1.65]" style={{ fontFamily: 'var(--qw-serif)' }}>
          {fallbackText ? (
            <OutputTextView text={fallbackText} mode={outputMode} />
          ) : obj ? (
            <div>
              <JsonTree data={obj as unknown} />
            </div>
          ) : errorArt?.preview != null ? (
            <pre
              className="m-0 max-h-[360px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11.5px]"
              style={{
                background: 'var(--qw-bg-muted)',
                border: '1px solid var(--qw-border)',
                color: 'var(--qw-danger)',
              }}
            >
              {asString(errorArt.preview)}
            </pre>
          ) : (
            <span style={{ color: 'var(--qw-fg-faint)' }}>(no output for this span)</span>
          )}
        </div>
      </CardShell>

      {/* Fallback attempts */}
      {isRoot && trace?.fallback && trace.fallback.details.length > 0 && (
        <div>
          <Eyebrow>
            Fallback · {trace.fallback.attempts} attempt{trace.fallback.attempts === 1 ? '' : 's'}
          </Eyebrow>
          <div className="mt-2 flex flex-col gap-2">
            {trace.fallback.details.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-[6px] px-3 py-2 font-mono text-[11.5px]"
                style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
              >
                <Chip tone={d.status === 'success' ? 'ok' : 'danger'} dot>
                  {d.status}
                </Chip>
                <span style={{ color: 'var(--qw-fg)' }}>{d.model}</span>
                <span style={{ color: 'var(--qw-fg-muted)' }}>{fmtDuration(d.durationMs)}</span>
                {d.cost != null && <span style={{ color: 'var(--qw-fg-muted)' }}>· {fmtCost(d.cost)}</span>}
                {d.error && (
                  <span className="truncate" style={{ color: 'var(--qw-danger)' }}>
                    {d.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Context tab (the full context-engineering view) ─────────────────

function ContextTab({
  node,
  trace,
  isRoot,
}: {
  node: ObservabilityRunDetailNode
  trace: Trace | undefined
  isRoot: boolean
}) {
  const { navigate } = useNavigation()

  // Gather resolved contexts from detail nodes (the new backend's source
  // of truth — each context.resolve detail carries its text + priority).
  const contexts = useMemo(() => gatherResolvedContexts(node), [node])
  const messages = useMemo(() => resolveMessages(node), [node])

  // Tool inventory comes from trace.inspect (legacy) when present, or we
  // derive it from tool.call descendants.
  const toolsFromInspect = trace?.inspect?.tools ?? []
  const toolsFromDescendants = useMemo(() => {
    const set = new Set<string>()
    function walk(n: ObservabilityRunDetailNode) {
      if (n.toolName) set.add(n.toolName)
      for (const c of n.children ?? []) walk(c)
    }
    walk(node)
    return Array.from(set)
  }, [node])
  const tools = toolsFromInspect.length > 0 ? toolsFromInspect : toolsFromDescendants

  const rootInput = isRoot ? trace?.input : undefined
  const userInput = messages.input ?? rootInput

  const withText = contexts.filter((c) => c.text)
  const predicateOnly = contexts.filter((c) => c.hasPredicate && !c.text)
  const composed = withText.length > 0
  const totalSize = withText.reduce((a, c) => a + (c.sizeBytes ?? 0), 0)
  const colorFor = (idx: number) => COMPOSITION_PALETTE[idx % COMPOSITION_PALETTE.length]
  const visibleTotal = Math.max(1, totalSize)

  if (contexts.length === 0 && messages.messages.length === 0 && !messages.system && !messages.prompt && !userInput) {
    return (
      <EmptyHint>
        No context composition captured for this span. (Context is recorded at the prompt-resolve / generation layer —
        tool calls, memory writes, and handoffs don't usually carry one.)
      </EmptyHint>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {composed && (
        <>
          <Eyebrow>
            Context composition · {withText.length} resolved
            {predicateOnly.length > 0 ? ` · ${predicateOnly.length} checked` : ''}
            {totalSize > 0 ? ` · ${(totalSize / 1024).toFixed(1)}kB` : ''}
          </Eyebrow>

          <CardShell
            label="Composition"
            right={`${withText.length} active${predicateOnly.length > 0 ? ` · ${predicateOnly.length} skipped` : ''}`}
          >
            <div className="px-3.5 py-3">
              <div
                className="flex h-3 w-full overflow-hidden rounded-[4px]"
                style={{ background: 'var(--qw-bg-muted)' }}
              >
                {withText.map((c, i) => {
                  const w = ((c.sizeBytes ?? 0) / visibleTotal) * 100
                  if (w <= 0) return null
                  return (
                    <div
                      key={c.label + i}
                      title={`${c.label} · ${c.sizeBytes ?? 0} bytes${c.priority != null ? ` · priority ${c.priority}` : ''}`}
                      style={{
                        width: `${w}%`,
                        background: colorFor(i),
                        boxShadow: 'inset 0 0 0 1px var(--qw-bg-elev)',
                      }}
                    />
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {withText.map((c, i) => (
                  <button
                    key={c.label + i}
                    onClick={() =>
                      navigate(
                        c.family === 'prompt'
                          ? { view: 'library-catalog', promptId: c.label }
                          : { view: 'library-catalog', contextId: c.label },
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-opacity hover:opacity-90"
                    style={{
                      background: 'var(--qw-bg-muted)',
                      color: 'var(--qw-fg)',
                      boxShadow: 'inset 0 0 0 1px var(--qw-border)',
                    }}
                    title={`Open ${c.family} · ${c.label}`}
                  >
                    <span className="size-2 rounded-[2px]" style={{ background: colorFor(i) }} />
                    {c.label}
                    {c.priority != null && <span style={{ color: 'var(--qw-fg-faint)' }}>p{c.priority}</span>}
                    {c.sizeBytes != null && (
                      <span style={{ color: 'var(--qw-fg-faint)' }}>{(c.sizeBytes / 1024).toFixed(1)}kB</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </CardShell>

          <div className="flex flex-col gap-2">
            <Eyebrow>Parts · {withText.length}</Eyebrow>
            {withText.map((c, i) => (
              <ResolvedContextCard key={c.label + i} entry={c} color={colorFor(i)} />
            ))}
          </div>
        </>
      )}

      {predicateOnly.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Checked but not included · {predicateOnly.length}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {predicateOnly.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: 'var(--qw-bg-muted)',
                  color: 'var(--qw-fg-muted)',
                  border: '1px dashed var(--qw-border)',
                }}
                title={`Predicate-only · ${c.label}`}
              >
                {c.label}
                {c.priority != null && <span style={{ color: 'var(--qw-fg-faint)' }}>p{c.priority}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {tools.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Tool inventory · {tools.length}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <button
                key={t}
                onClick={() => navigate({ view: 'library-catalog', toolName: t })}
                className="rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-opacity hover:opacity-90"
                style={{
                  background: 'var(--qw-bg-muted)',
                  color: 'var(--qw-fg)',
                  boxShadow: 'inset 0 0 0 1px var(--qw-border)',
                }}
                title={`Open tool · ${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.system && !composed && (
        <CardShell label="System">
          <div
            className="px-3.5 py-3 whitespace-pre-wrap text-[12.5px] leading-[1.55]"
            style={{ color: 'var(--qw-fg)', fontFamily: 'var(--qw-serif)' }}
          >
            {messages.system}
          </div>
        </CardShell>
      )}
      {messages.prompt && (
        <div className="flex flex-col gap-2">
          <Eyebrow>User · prompt</Eyebrow>
          <div
            className="rounded-[10px] px-4 py-3 text-[14px] leading-[1.6]"
            style={{
              background: 'var(--qw-bg-muted)',
              border: '1px solid var(--qw-border)',
              fontFamily: 'var(--qw-serif)',
            }}
          >
            <div className="qw-prose">
              <Streamdown>{messages.prompt}</Streamdown>
            </div>
          </div>
        </div>
      )}
      {messages.messages.length > 0 && (
        <div className="flex flex-col gap-2">
          {(() => {
            const allParts = messages.messages.every(
              (m): boolean =>
                m != null &&
                typeof m === 'object' &&
                typeof (m as { type?: unknown }).type === 'string' &&
                (m as { role?: unknown }).role === undefined,
            )
            return (
              <>
                <Eyebrow>
                  {allParts
                    ? `Assistant output · ${messages.messages.length} parts`
                    : `Messages · ${messages.messages.length}`}
                </Eyebrow>
                {allParts && (
                  <div
                    className="rounded-[8px] px-3 py-2 text-[11.5px]"
                    style={{
                      background: 'var(--qw-bg-muted)',
                      border: '1px dashed var(--qw-border)',
                      color: 'var(--qw-fg-muted)',
                    }}
                  >
                    These are the content parts the model produced this turn (reasoning, text, tool calls). The actual
                    input chat history isn't captured on this generation — for Convex-agent-wrapped runs the prompt &
                    thread messages live on the Convex thread, not on the observability span.
                  </div>
                )}
                <MessageBlock raw={messages.messages as unknown} />
              </>
            )
          })()}
        </div>
      )}
      {userInput != null &&
        !(
          typeof userInput === 'object' &&
          userInput != null &&
          !Array.isArray(userInput) &&
          Object.keys(userInput as Record<string, unknown>).length === 0
        ) && (
          <CardShell label="Input">
            <div className="px-3.5 py-3">
              <JsonTree data={userInput as unknown} />
            </div>
          </CardShell>
        )}
    </div>
  )
}

function ResolvedContextCard({ entry, color }: { entry: ResolvedContext; color: string }) {
  const { navigate } = useNavigation()
  const [expanded, setExpanded] = useState(false)
  const text = entry.text ?? ''
  const truncated = text.length > 400
  const shown = expanded || !truncated ? text : text.slice(0, 400) + '…'
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2 px-3.5 py-2"
        style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-muted)' }}
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
          {entry.family}
        </span>
        <button
          onClick={() =>
            navigate(
              entry.family === 'prompt'
                ? { view: 'library-catalog', promptId: entry.label }
                : { view: 'library-catalog', contextId: entry.label },
            )
          }
          className="font-mono text-[12px] transition-colors hover:underline"
          style={{ color: 'var(--qw-crux)' }}
          title={`Open ${entry.family} · ${entry.label}`}
        >
          {entry.label}
        </button>
        {entry.priority != null && (
          <Chip tone="muted" mono>
            p{entry.priority}
          </Chip>
        )}
        <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {entry.sizeBytes != null ? `${(entry.sizeBytes / 1024).toFixed(1)}kB` : ''}
          {entry.durationMs != null ? ` · ${fmtDuration(entry.durationMs)}` : ''}
        </span>
      </div>
      {text ? (
        <>
          <div
            className="whitespace-pre-wrap px-3.5 py-3 text-[12.5px] leading-[1.55]"
            style={{ fontFamily: 'var(--qw-serif)' }}
          >
            {shown}
          </div>
          {truncated && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="block w-full px-3.5 py-2 text-left font-mono text-[11px]"
              style={{
                color: 'var(--qw-crux)',
                borderTop: '1px solid var(--qw-border)',
                background: 'var(--qw-bg-muted)',
              }}
            >
              {expanded ? '↑ collapse' : '↓ expand'}
            </button>
          )}
        </>
      ) : entry.body != null ? (
        <div className="px-3.5 py-3">
          <JsonTree data={entry.body as unknown} />
        </div>
      ) : (
        <div className="px-3.5 py-3 text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          (no body recorded)
        </div>
      )}
    </div>
  )
}

function PartCard({ part, color }: { part: InspectPart; color: string }) {
  const { navigate } = useNavigation()
  const [expanded, setExpanded] = useState(false)
  const truncated = part.text.length > 400
  const text = expanded || !truncated ? part.text : part.text.slice(0, 400) + '…'
  const parsed = parsePartSource(part.source)
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        borderLeft: `3px solid ${color}`,
        opacity: part.skipped ? 0.65 : 1,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2 px-3.5 py-2"
        style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-muted)' }}
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
          system
        </span>
        <button
          onClick={() =>
            navigate(
              parsed.kind === 'prompt'
                ? { view: 'library-catalog', promptId: parsed.id }
                : { view: 'library-catalog', contextId: parsed.id },
            )
          }
          className="font-mono text-[12px] transition-colors hover:underline"
          style={{ color: 'var(--qw-crux)' }}
          title={`Open ${parsed.kind} · ${parsed.id}`}
        >
          {part.source}
        </button>
        {part.skipped && <Chip tone="muted">skipped</Chip>}
        <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {fmtTokens(part.tokens)} tok
        </span>
      </div>
      <div
        className="whitespace-pre-wrap px-3.5 py-3 text-[12.5px] leading-[1.55]"
        style={{ fontFamily: 'var(--qw-serif)' }}
      >
        {text}
      </div>
      {truncated && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="block w-full px-3.5 py-2 text-left font-mono text-[11px]"
          style={{
            color: 'var(--qw-crux)',
            borderTop: '1px solid var(--qw-border)',
            background: 'var(--qw-bg-muted)',
          }}
        >
          {expanded ? '↑ collapse' : '↓ expand'}
        </button>
      )}
    </div>
  )
}

function DroppedRow({ entry }: { entry: DroppedContext }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[6px] px-3 py-1.5 font-mono text-[11.5px]"
      style={{ background: 'var(--qw-warn-soft)', border: '1px solid var(--qw-warn-soft)', color: 'var(--qw-warn)' }}
    >
      <span style={{ fontWeight: 600 }}>{entry.source}</span>
      <span style={{ color: 'var(--qw-fg-muted)' }}>
        priority {entry.priority} · {fmtTokens(entry.tokens)} tok
      </span>
      <span className="truncate" style={{ color: 'var(--qw-fg)' }}>
        {entry.text.slice(0, 160)}
      </span>
    </div>
  )
}

function ExcludedRow({ entry }: { entry: ExcludedContext }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[6px] px-3 py-1.5 font-mono text-[11.5px]"
      style={{ background: 'var(--qw-bg-muted)', border: '1px solid var(--qw-border)', color: 'var(--qw-fg-muted)' }}
    >
      <span style={{ fontWeight: 600, color: 'var(--qw-fg)' }}>{entry.source}</span>
      <span>· {entry.reason}</span>
    </div>
  )
}

/**
 * Two distinct shapes flow through this component:
 *
 *  1. **Chat messages** — `[{ role: 'system' | 'user' | 'assistant' | 'tool',
 *     content: string | ContentPart[], name? }]`. This is the input shape
 *     fed to LLMs and used by most context-engineering layers.
 *
 *  2. **AI SDK v6 content parts** — `[{ type: 'reasoning' | 'text' |
 *     'tool-call' | 'tool-result' | 'file' | 'image', ...partFields }]`.
 *     This is the *output* shape from generation.call (the assistant's
 *     response, decomposed into reasoning blocks, text, and tool calls).
 *     It surfaces on Convex-agent-wrapped generations where the messages
 *     artifact captures the model's output rather than the input chat.
 *
 * We auto-detect: an item with `type` but no `role` is treated as a
 * content part. Otherwise we fall back to the chat-message renderer.
 * Mixed arrays (rare) are rendered row-by-row with per-row detection.
 */
type AnyMessageItem = Record<string, unknown>

interface AssistantContentPart {
  type: string
  text?: string
  input?: unknown
  output?: unknown
  args?: unknown
  result?: unknown
  toolName?: string
  toolCallId?: string
  providerExecuted?: boolean
  title?: string
}

function isContentPart(item: AnyMessageItem): boolean {
  return typeof item.type === 'string' && item.role === undefined
}

function MessageBlock({ raw, label }: { raw: unknown; label?: string }) {
  const items = useMemo<AnyMessageItem[]>(() => {
    if (Array.isArray(raw)) return raw as AnyMessageItem[]
    if (typeof raw === 'object' && raw !== null) {
      const list = (raw as { messages?: unknown }).messages
      if (Array.isArray(list)) return list as AnyMessageItem[]
    }
    return []
  }, [raw])

  if (items.length === 0) return null

  // If every row is a content-part, label it "Assistant output" — that's
  // what these arrays actually represent on AI-SDK generations.
  const allContentParts = items.every((m) => isContentPart(m))
  const computedLabel =
    label ?? (allContentParts ? `Assistant output · ${items.length} parts` : `Messages · ${items.length}`)

  return (
    <CardShell label={computedLabel}>
      <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
        {items.map((m, i) =>
          isContentPart(m) ? (
            <ContentPartRow key={i} part={m as unknown as AssistantContentPart} />
          ) : (
            <ChatMessageRow key={i} msg={m} />
          ),
        )}
      </div>
    </CardShell>
  )
}

/** One AI-SDK content part — reasoning / text / tool-call / tool-result / file / image. */
function ContentPartRow({ part }: { part: AssistantContentPart }) {
  switch (part.type) {
    case 'reasoning': {
      return (
        <PartRow tone="iris" label="reasoning" icon="brain">
          <div
            className="whitespace-pre-wrap text-[12.5px] leading-[1.6]"
            style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)', fontStyle: 'italic' }}
          >
            {part.text || <span style={{ color: 'var(--qw-fg-faint)' }}>(empty reasoning)</span>}
          </div>
        </PartRow>
      )
    }
    case 'text': {
      return (
        <PartRow tone="crux" label="assistant" icon="spark">
          <div
            className="whitespace-pre-wrap text-[13px] leading-[1.6]"
            style={{ color: 'var(--qw-fg)', fontFamily: 'var(--qw-serif)' }}
          >
            {part.text || <span style={{ color: 'var(--qw-fg-faint)' }}>(empty)</span>}
          </div>
        </PartRow>
      )
    }
    case 'tool-call':
    case 'tool_call': {
      const args = part.input ?? part.args
      return (
        <PartRow
          tone="warn"
          label={
            <span className="font-mono">
              tool-call
              {part.toolName && (
                <>
                  {' '}
                  <span style={{ color: 'var(--qw-warn)' }}>·</span> {part.toolName}
                </>
              )}
            </span>
          }
          icon="flask"
          right={
            part.toolCallId && (
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {part.toolCallId}
              </span>
            )
          }
        >
          {part.title && (
            <div className="mb-1.5 text-[12.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {part.title}
            </div>
          )}
          {args != null ? (
            <div
              className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
              style={{
                background: 'var(--qw-bg)',
                border: '1px solid var(--qw-border)',
                maxHeight: 240,
              }}
            >
              <JsonTree data={args} />
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
              (no args)
            </span>
          )}
        </PartRow>
      )
    }
    case 'tool-result':
    case 'tool_result': {
      const result = part.output ?? part.result
      return (
        <PartRow
          tone="ok"
          label={
            <span className="font-mono">
              tool-result
              {part.toolName && (
                <>
                  {' '}
                  <span style={{ color: 'var(--qw-ok)' }}>·</span> {part.toolName}
                </>
              )}
            </span>
          }
          icon="check"
          right={
            part.toolCallId && (
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {part.toolCallId}
              </span>
            )
          }
        >
          {result != null ? (
            typeof result === 'string' ? (
              <div
                className="whitespace-pre-wrap text-[12.5px] leading-[1.55]"
                style={{ color: 'var(--qw-fg)', fontFamily: 'var(--qw-serif)' }}
              >
                {result}
              </div>
            ) : (
              <div
                className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
                style={{
                  background: 'var(--qw-bg)',
                  border: '1px solid var(--qw-border)',
                  maxHeight: 240,
                }}
              >
                <JsonTree data={result} />
              </div>
            )
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
              (no result)
            </span>
          )}
        </PartRow>
      )
    }
    case 'file':
    case 'image': {
      const url =
        (part as unknown as Record<string, unknown>).url ?? (part as unknown as Record<string, unknown>).source
      return (
        <PartRow tone="muted" label={part.type} icon="folder">
          <div className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {typeof url === 'string' ? url : asString(part)}
          </div>
        </PartRow>
      )
    }
    default: {
      // Unknown part type — surface the raw JSON so it's not silently
      // dropped. New AI-SDK parts arrive regularly; better visible than
      // invisible.
      return (
        <PartRow tone="muted" label={part.type || 'part'}>
          <div
            className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
            style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)', maxHeight: 200 }}
          >
            <JsonTree data={part as unknown} />
          </div>
        </PartRow>
      )
    }
  }
}

function PartRow({
  tone,
  label,
  icon: _icon,
  right,
  children,
}: {
  tone: ChipTone
  label: ReactNode
  icon?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="px-3.5 py-3" style={{ background: 'var(--qw-bg-elev)' }}>
      <div className="mb-1.5 flex items-center gap-2">
        <Chip tone={tone}>{label}</Chip>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </div>
  )
}

function ChatMessageRow({ msg }: { msg: AnyMessageItem }) {
  const role = (typeof msg.role === 'string' ? msg.role : 'message').toLowerCase()
  const tone: ChipTone = role === 'system' ? 'iris' : role === 'assistant' ? 'crux' : role === 'tool' ? 'muted' : 'ok'
  const content = msg.content
  // Content can be a string or an array of content parts (multimodal /
  // tool-call-bearing). Render either case clearly.
  return (
    <div className="px-3.5 py-3" style={{ background: 'var(--qw-bg-elev)' }}>
      <div className="mb-1 flex items-center gap-2">
        <Chip tone={tone}>{role}</Chip>
        {typeof msg.name === 'string' && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {msg.name}
          </span>
        )}
      </div>
      {typeof content === 'string' ? (
        <div
          className="whitespace-pre-wrap text-[12.5px] leading-[1.55]"
          style={{ fontFamily: role === 'tool' ? 'var(--qw-mono)' : 'var(--qw-serif)' }}
        >
          {content || <span style={{ color: 'var(--qw-fg-faint)' }}>(empty)</span>}
        </div>
      ) : Array.isArray(content) ? (
        <div className="flex flex-col gap-2">
          {(content as AnyMessageItem[]).map((c, j) =>
            isContentPart(c) ? (
              <ContentPartRow key={j} part={c as unknown as AssistantContentPart} />
            ) : (
              <div
                key={j}
                className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
                style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)', maxHeight: 200 }}
              >
                <JsonTree data={c as unknown} />
              </div>
            ),
          )}
        </div>
      ) : content != null ? (
        <div
          className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
          style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)', maxHeight: 200 }}
        >
          <JsonTree data={content as unknown} />
        </div>
      ) : (
        <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
          (empty)
        </span>
      )}
    </div>
  )
}

// ─── Tool span panel (primitive === tool.*) ─────────────────────────

function ToolSpanTab({ node }: { node: ObservabilityRunDetailNode }) {
  const toolName = node.toolName ?? (findAttribute(node, 'toolName', 'name') as string | undefined) ?? node.name
  const toolCallId = findAttribute(node, 'toolCallId') as string | undefined
  const payload = useMemo(() => resolveToolPayload(node), [node])
  const spanError = useMemo(() => resolveSpanError(node), [node])
  const approvalArt = findArtifact(node, 'guardrail.report') ?? findArtifact(node, 'constraint.report')

  // Cross-link to the requesting generation via tool.request item
  const insp = inspectionOf(node)
  const requestItem = insp?.tools?.find((i) => i.kind === 'tool.request')
  const requestingSpanId = requestItem?.sourceSpanId
  const argsOwnerInfo =
    payload.argsOwner && payload.argsOwner.id !== node.id
      ? `from ${payload.argsOwner.display?.label ?? payload.argsOwner.name ?? payload.argsOwner.primitive}`
      : null
  const resultOwnerInfo =
    payload.resultOwner && payload.resultOwner.id !== node.id
      ? `from ${payload.resultOwner.display?.label ?? payload.resultOwner.name ?? payload.resultOwner.primitive}`
      : null

  return (
    <div className="flex flex-col gap-3">
      {spanError && <SpanErrorCard error={spanError} />}

      <CardShell
        label={
          <span className="flex items-center gap-2">
            <Icon name="layers" size={11} color="var(--qw-fg-muted)" />
            <span className="font-mono" style={{ textTransform: 'none', color: 'var(--qw-crux)' }}>
              {toolName ?? 'tool'}
            </span>
            {toolCallId && (
              <span className="font-mono" style={{ color: 'var(--qw-fg-faint)', textTransform: 'none' }}>
                · {toolCallId}
              </span>
            )}
          </span>
        }
        right={
          <Chip tone={statusTone(node.status)} dot>
            {statusLabel(node.status)}
          </Chip>
        }
      >
        <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
          <div className="px-3.5 py-3" style={{ background: 'var(--qw-bg-elev)' }}>
            <div className="flex items-center justify-between">
              <Eyebrow>Args</Eyebrow>
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {argsOwnerInfo}
                {payload.inputSize != null
                  ? `${argsOwnerInfo ? ' · ' : ''}${payload.inputSize.toLocaleString()} bytes`
                  : ''}
              </span>
            </div>
            <div className="mt-1.5">
              {payload.args !== undefined ? (
                <JsonTree data={payload.args as unknown} />
              ) : (
                <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  (args not recorded — model embeds them in the messages artifact of the parent generation)
                </span>
              )}
            </div>
          </div>
          <div className="px-3.5 py-3" style={{ background: 'var(--qw-bg-elev)' }}>
            <div className="flex items-center justify-between">
              <Eyebrow>Result</Eyebrow>
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {resultOwnerInfo}
                {payload.outputSize != null
                  ? `${resultOwnerInfo ? ' · ' : ''}${payload.outputSize.toLocaleString()} bytes`
                  : ''}
              </span>
            </div>
            <div className="mt-1.5">
              {payload.result !== undefined ? (
                <JsonTree data={payload.result as unknown} />
              ) : node.status === 'running' ? (
                <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  running…
                </span>
              ) : (
                <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  (no result recorded)
                </span>
              )}
            </div>
          </div>
        </div>
      </CardShell>

      {requestingSpanId && (
        <CardShell label="Request">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            <KeyValue k="requestedBy" v={requestingSpanId} />
            {toolCallId && <KeyValue k="toolCallId" v={toolCallId} />}
          </div>
        </CardShell>
      )}

      {(payload.fromAgent || payload.toAgent || payload.delegateId) && (
        <CardShell label="Handoff">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            {(payload.fromAgent || payload.toAgent) && (
              <KeyValue k="agents" v={`${payload.fromAgent ?? '—'} → ${payload.toAgent ?? '—'}`} />
            )}
            {payload.delegateId && <KeyValue k="delegateId" v={payload.delegateId} />}
            {payload.handoffId && <KeyValue k="handoffId" v={payload.handoffId} />}
            {payload.summary && <KeyValue k="summary" v={payload.summary} />}
          </div>
        </CardShell>
      )}

      {approvalArt && (
        <CardShell label="Approval / guardrail">
          <div className="px-3.5 py-3">
            <JsonTree data={approvalArt.preview as unknown} />
          </div>
        </CardShell>
      )}
    </div>
  )
}

// ─── Memory span panel (primitive === memory.*) ─────────────────────

function MemoryTab({ node }: { node: ObservabilityRunDetailNode }) {
  const snapshot = findArtifact(node, 'memory.snapshot')
  const insp = inspectionOf(node)

  // Pull from inspection.memory (artifact rows) + inspection.relations
  // (edge rows describing the read/write) when present — the new
  // backend curates these instead of stuffing them on attributes.
  const memoryItems = (insp?.memory ?? []) as readonly InspectionItem[]
  const relationItems = (insp?.relations ?? []) as readonly InspectionItem[]
  const memoryRelation = relationItems.find((r) => typeof r.kind === 'string' && r.kind.startsWith('memory.'))
  const memoryRel = (memoryRelation?.data as Record<string, unknown> | undefined) ?? {}

  const op =
    (memoryRel.operation as string | undefined) ??
    (findAttribute(node, 'operation') as string | undefined) ??
    node.primitive.split('.').pop() ??
    '—'
  const memoryId =
    (memoryRel.memoryId as string | undefined) ??
    node.memoryId ??
    (findAttribute(node, 'memoryId') as string | undefined)
  const memoryType =
    (memoryRel.memoryType as string | undefined) ?? (findAttribute(node, 'memoryType', 'kind') as string | undefined)
  const blockKind =
    (memoryRel.blockKind as string | undefined) ?? (findAttribute(node, 'blockKind') as string | undefined)
  const blockId = memoryRel.blockId as string | undefined
  const isBlackboard = memoryType === 'blackboard'
  const query = findAttribute(node, 'query') as string | undefined
  const writeMode = findAttribute(node, 'writeMode') as string | undefined
  const resultsRaw = findAttribute(node, 'results', 'entries')
  const results = Array.isArray(resultsRaw) ? (resultsRaw as Array<Record<string, unknown>>) : []

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label={
          <span className="flex items-center gap-2">
            <Icon name="brain" size={11} color={isBlackboard ? 'var(--qw-crux)' : 'var(--qw-iris)'} />
            <span style={{ textTransform: 'none' }}>{op}</span>
            {memoryType && (
              <Chip tone={isBlackboard ? 'crux' : 'iris'} mono>
                {isBlackboard ? 'shared state' : memoryType}
              </Chip>
            )}
            {blockKind && !isBlackboard && (
              <span className="font-mono" style={{ color: 'var(--qw-fg-muted)', textTransform: 'none' }}>
                · {blockKind}
              </span>
            )}
          </span>
        }
        right={memoryId && <span style={{ color: 'var(--qw-fg-muted)' }}>{memoryId}</span>}
      >
        <div className="px-3.5 py-3">
          {query && (
            <>
              <Eyebrow>Query</Eyebrow>
              <div className="mt-1.5 mb-3 font-mono text-[12px]">{query}</div>
            </>
          )}
          {writeMode && (
            <div className="mb-3">
              <Chip tone={writeMode === 'propose' ? 'warn' : 'crux'} mono>
                write · {writeMode}
              </Chip>
            </div>
          )}
          {results.length > 0 ? (
            <>
              <Eyebrow>Results · {results.length}</Eyebrow>
              <div className="mt-1.5 flex flex-col gap-1">
                {results.slice(0, 12).map((r, i) => {
                  const key = String(r.key ?? r.id ?? `result-${i + 1}`)
                  const preview = typeof r.preview === 'string' ? r.preview : r.content ? asString(r.content) : ''
                  const score = typeof r.score === 'number' ? r.score : undefined
                  return (
                    <div key={i} className="flex items-baseline gap-2 font-mono text-[11.5px]">
                      <span style={{ color: 'var(--qw-crux)' }}>›</span>
                      <span style={{ color: 'var(--qw-fg-muted)' }}>{key}</span>
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
            </>
          ) : null}
        </div>
      </CardShell>

      {snapshot && (
        <CardShell label="Snapshot" right={snapshot.sizeBytes ? `${snapshot.sizeBytes} bytes` : undefined}>
          <div className="px-3.5 py-3">
            {snapshot.preview != null ? (
              <JsonTree data={snapshot.preview as unknown} />
            ) : (
              <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                (snapshot recorded but preview is null — likely a no-op read)
              </span>
            )}
          </div>
        </CardShell>
      )}

      {/* inspection.memory artifact rows that aren't the primary snapshot
          (additional writes / proposals etc.) */}
      {memoryItems.length > 1 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Memory artifacts · {memoryItems.length}</Eyebrow>
          {memoryItems.map((it, i) => (
            <CardShell
              key={`${it.id}-${i}`}
              label={
                <span className="flex items-center gap-2">
                  <span style={{ textTransform: 'none' }}>{it.label ?? it.kind}</span>
                  {it.role && (
                    <Chip tone="muted" mono>
                      {it.role}
                    </Chip>
                  )}
                </span>
              }
            >
              {it.data != null && (
                <div className="px-3.5 py-3">
                  <JsonTree data={it.data as unknown} />
                </div>
              )}
            </CardShell>
          ))}
        </div>
      )}

      {blockId && (
        <CardShell label="Block">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            <KeyValue k="blockId" v={blockId} />
            {blockKind && <KeyValue k="blockKind" v={blockKind} />}
          </div>
        </CardShell>
      )}
    </div>
  )
}

// ─── Handoff / delegate span panel ──────────────────────────────────

function HandoffTab({ node }: { node: ObservabilityRunDetailNode }) {
  const fromAgent = findAttribute(node, 'fromAgent', 'from') as string | undefined
  const toAgent = findAttribute(node, 'toAgent', 'to', 'agent') as string | undefined
  const handoffId = findAttribute(node, 'handoffId') as string | undefined
  const delegateId = findAttribute(node, 'delegateId') as string | undefined
  const summary = findAttribute(node, 'summary') as string | undefined
  const inputSize = findAttribute(node, 'inputSize') as number | undefined
  const outputSize = findAttribute(node, 'outputSize') as number | undefined

  // Prefer the curated inspection.input/output sections — backend now
  // emits proper Input + Output for delegate.invoke and handoff.prepare.
  const insp = inspectionOf(node)
  const inputData = insp?.input?.[0]?.data
  const outputItem = insp?.output?.[0]
  const outputData = outputItem?.data
  // handoff.payload wrapper: { handoffId, data } — unwrap the inner payload
  const outputUnwrapped =
    outputItem?.kind === 'handoff.payload' &&
    outputData &&
    typeof outputData === 'object' &&
    'data' in (outputData as Record<string, unknown>)
      ? (outputData as { data: unknown }).data
      : outputData
  // Fallback to direct artifact lookup for older runs
  const payloadArt = inputData != null || outputUnwrapped != null ? null : findArtifact(node, 'handoff.payload')
  const inputArt = inputData != null ? null : findArtifact(node, 'input')
  const outputArt = outputUnwrapped != null ? null : findArtifact(node, 'output')

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label={
          <span className="flex items-center gap-2">
            <Icon name="play" size={11} color="var(--qw-fg-muted)" />
            <span style={{ textTransform: 'none' }}>
              {fromAgent ?? '—'} → {toAgent ?? '—'}
            </span>
          </span>
        }
        right={
          <Chip tone={statusTone(node.status)} dot>
            {statusLabel(node.status)}
          </Chip>
        }
      >
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          {handoffId && <KeyValue k="handoffId" v={handoffId} />}
          {delegateId && <KeyValue k="delegateId" v={delegateId} />}
          {inputSize != null && <KeyValue k="inputSize" v={`${inputSize.toLocaleString()} bytes`} />}
          {outputSize != null && <KeyValue k="outputSize" v={`${outputSize.toLocaleString()} bytes`} />}
          {inputSize != null && outputSize != null && inputSize > 0 && (
            <KeyValue k="compression" v={`${Math.round((1 - outputSize / inputSize) * 100)}%`} />
          )}
        </div>
      </CardShell>

      {summary && (
        <CardShell label="Summary">
          <div
            className="whitespace-pre-wrap px-3.5 py-3 text-[13px] leading-[1.55]"
            style={{ fontFamily: 'var(--qw-serif)' }}
          >
            {summary}
          </div>
        </CardShell>
      )}

      {(inputData != null || inputArt || payloadArt) && (
        <CardShell label="Input · delegate args">
          <div className="px-3.5 py-3">
            <JsonTree data={(inputData ?? inputArt?.preview ?? payloadArt?.preview) as unknown} />
          </div>
        </CardShell>
      )}

      {(outputUnwrapped != null || outputArt) && (
        <CardShell label="Output · after handoff transform">
          <div className="px-3.5 py-3">
            <JsonTree data={(outputUnwrapped ?? outputArt?.preview) as unknown} />
          </div>
        </CardShell>
      )}
    </div>
  )
}

// ─── Retrieval span panel + Retrieval tab (for parent runs) ─────────

function RetrievalSpanTab({ node }: { node: ObservabilityRunDetailNode }) {
  const { query, hits, stages } = retrievalEntries(node)
  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label={
          <span className="flex items-center gap-2">
            <Icon name="search" size={11} color="var(--qw-ok)" />
            <span style={{ textTransform: 'none' }}>{node.retrieverId ?? node.name ?? 'retrieval'}</span>
          </span>
        }
        right={`${hits.length} hits`}
      >
        <div className="px-3.5 py-3">
          {query && (
            <div className="mb-2 font-mono text-[12px]" style={{ color: 'var(--qw-fg)' }}>
              {query}
            </div>
          )}
          <RetrievalHits hits={hits} />
        </div>
      </CardShell>

      {stages.length > 0 && (
        <CardShell label={`Pipeline stages · ${stages.length}`}>
          <div className="flex flex-col gap-1 px-3.5 py-3 font-mono text-[11.5px]">
            {stages.map((s, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span style={{ color: 'var(--qw-fg-faint)' }}>{i + 1}.</span>
                <span style={{ color: 'var(--qw-fg)' }}>{String(s.name ?? s.kind ?? '—')}</span>
                {s.status != null && (
                  <Chip tone={statusTone(String(s.status))} mono>
                    {String(s.status)}
                  </Chip>
                )}
                {typeof s.durationMs === 'number' && (
                  <span style={{ color: 'var(--qw-fg-muted)' }}>{fmtDuration(s.durationMs)}</span>
                )}
              </div>
            ))}
          </div>
        </CardShell>
      )}
    </div>
  )
}

function RetrievalHits({ hits }: { hits: Array<Record<string, unknown>> }) {
  if (hits.length === 0) {
    return (
      <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
        (no hits)
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {hits.slice(0, 12).map((h, i) => {
        const id = String(h.id ?? h.chunkId ?? h.sourceId ?? h.path ?? `hit-${i + 1}`)
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
          <div key={i} className="flex items-baseline gap-2 font-mono text-[11.5px]">
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

// ─── Tools tab (for parent runs — aggregates child tool.calls) ──────

function ToolsTab({ scope }: { scope: ObservabilityRunDetailNode }) {
  const calls = useMemo(
    () => gatherDescendants(scope).filter((n) => n.primitive === 'tool.call' || n.primitive === 'tool' || n.toolName),
    [scope],
  )

  const requests = useMemo(() => collectToolRequests(scope), [scope])

  if (calls.length === 0 && requests.length === 0) {
    return <EmptyHint>No tool calls or requests under this span.</EmptyHint>
  }
  return (
    <div className="flex flex-col gap-4">
      {requests.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Tool requests · {requests.length}</Eyebrow>
          {requests.map((r, i) => (
            <CardShell
              key={`${r.toolCallId ?? i}`}
              label={
                <span className="flex items-center gap-2">
                  <Icon name="sparkle" size={11} color="var(--qw-warn)" />
                  <span className="font-mono" style={{ textTransform: 'none' }}>
                    {r.toolName ?? 'tool'}
                  </span>
                  {r.toolCallId && (
                    <span className="font-mono" style={{ textTransform: 'none', color: 'var(--qw-fg-faint)' }}>
                      · {r.toolCallId.slice(0, 12)}
                    </span>
                  )}
                </span>
              }
              right={
                <span className="font-mono" style={{ color: 'var(--qw-fg-faint)' }}>
                  requested by {r.owner.display?.label ?? r.owner.name ?? r.owner.primitive}
                </span>
              }
            >
              {r.args !== undefined && (
                <div className="px-3.5 py-3">
                  <JsonTree data={r.args as unknown} />
                </div>
              )}
            </CardShell>
          ))}
        </div>
      )}
      {calls.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Tool calls · {calls.length}</Eyebrow>
          {calls.map((c) => {
            const name = c.toolName ?? c.name ?? 'tool'
            const args = findArtifact(c, 'tool.args')?.preview ?? findAttribute(c, 'args', 'input')
            const result = findArtifact(c, 'tool.result')?.preview ?? findAttribute(c, 'result', 'output')
            return (
              <CardShell
                key={c.id}
                label={
                  <span className="flex items-center gap-2">
                    <Chip tone={statusTone(c.status)} dot>
                      {statusLabel(c.status)}
                    </Chip>
                    <span className="font-mono" style={{ textTransform: 'none' }}>
                      {name}
                    </span>
                  </span>
                }
                right={fmtDuration(nodeDuration(c))}
              >
                <div className="grid gap-px" style={{ background: 'var(--qw-border)' }}>
                  <div className="px-3.5 py-2" style={{ background: 'var(--qw-bg-elev)' }}>
                    <Eyebrow>Args</Eyebrow>
                    <div className="mt-1.5">
                      {args !== undefined ? (
                        <JsonTree data={args as unknown} />
                      ) : (
                        <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                          (no args)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="px-3.5 py-2" style={{ background: 'var(--qw-bg-elev)' }}>
                    <Eyebrow>Result</Eyebrow>
                    <div className="mt-1.5">
                      {result !== undefined ? (
                        <JsonTree data={result as unknown} />
                      ) : (
                        <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
                          (no result)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardShell>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Retrieval tab (for parent runs — aggregates child retrieval/memory) ─

function RetrievalAggregateTab({ scope }: { scope: ObservabilityRunDetailNode }) {
  const all = useMemo(
    () =>
      gatherDescendants(scope).filter(
        (n) =>
          n.primitive.startsWith('retrieval.') || n.primitive === 'embedding.call' || n.primitive.startsWith('memory.'),
      ),
    [scope],
  )
  if (all.length === 0) {
    return <EmptyHint>No retrieval / memory activity under this span.</EmptyHint>
  }
  const retrievals = all.filter((n) => !n.primitive.startsWith('memory.'))
  const memory = all.filter((n) => n.primitive.startsWith('memory.'))
  return (
    <div className="flex flex-col gap-4">
      {retrievals.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Retrieval · {retrievals.length}</Eyebrow>
          {retrievals.map((r) => {
            const { query, hits } = retrievalEntries(r)
            return (
              <CardShell
                key={r.id}
                label={r.retrieverId ?? r.name ?? r.primitive}
                right={`${hits.length} hits · ${fmtDuration(nodeDuration(r))}`}
              >
                <div className="px-3.5 py-3">
                  {query && <div className="mb-2 font-mono text-[12px]">{query}</div>}
                  <RetrievalHits hits={hits} />
                </div>
              </CardShell>
            )
          })}
        </div>
      )}
      {memory.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Memory edits · {memory.length}</Eyebrow>
          {memory.map((m) => (
            <CardShell
              key={m.id}
              label={
                <span className="flex items-center gap-2">
                  <span style={{ textTransform: 'none' }}>{m.primitive.replace('memory.', '')}</span>
                  {(findAttribute(m, 'memoryType', 'kind') as string | undefined) && (
                    <Chip tone="iris">{String(findAttribute(m, 'memoryType', 'kind'))}</Chip>
                  )}
                </span>
              }
              right={m.memoryId}
            >
              {(findArtifact(m, 'memory.snapshot')?.preview as unknown) != null && (
                <div className="px-3.5 py-3">
                  <JsonTree data={findArtifact(m, 'memory.snapshot')!.preview as unknown} />
                </div>
              )}
            </CardShell>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Scores ─────────────────────────────────────────────────────────

function ScoresTab({ node, judges }: { node: ObservabilityRunDetailNode; judges: readonly JudgeEventData[] }) {
  type Entry = { name: string; score: number; reasoning?: string }
  // Prefer inspection.scores when ribbed by backend
  const fromInspection = useMemo<Entry[]>(() => {
    const insp = inspectionOf(node)
    if (!insp?.scores) return []
    const items = insp.scores
    const out: Entry[] = []
    for (const item of items) {
      const data = item.data
      if (data == null) continue
      if (Array.isArray(data)) {
        for (const e of data as Array<{ name?: string; metricId?: string; score?: number; reasoning?: string }>) {
          if (typeof e.score === 'number') {
            out.push({ name: e.name ?? e.metricId ?? item.label ?? 'score', score: e.score, reasoning: e.reasoning })
          }
        }
        continue
      }
      if (typeof data === 'object') {
        const obj = data as { name?: string; metricId?: string; score?: number; reasoning?: string; scores?: unknown }
        if (Array.isArray(obj.scores)) {
          for (const e of obj.scores as Array<{
            name?: string
            metricId?: string
            score?: number
            reasoning?: string
          }>) {
            if (typeof e.score === 'number') {
              out.push({ name: e.name ?? e.metricId ?? 'score', score: e.score, reasoning: e.reasoning })
            }
          }
        } else if (typeof obj.score === 'number') {
          out.push({
            name: obj.name ?? obj.metricId ?? item.label ?? 'score',
            score: obj.score,
            reasoning: obj.reasoning,
          })
        }
      }
    }
    return out
  }, [node])

  const fromArtifact = useMemo<Entry[]>(() => {
    if (fromInspection.length > 0) return []
    const art = findArtifact(node, 'score.report')
    const raw = art?.preview
    if (!raw) return []
    if (Array.isArray(raw)) {
      return (raw as Array<{ name?: string; metricId?: string; score?: number; reasoning?: string }>)
        .filter((e) => typeof e.score === 'number')
        .map((e) => ({ name: e.name ?? e.metricId ?? 'score', score: e.score!, reasoning: e.reasoning }))
    }
    if (typeof raw === 'object' && raw !== null) {
      const list = (raw as { scores?: unknown }).scores
      if (Array.isArray(list)) {
        return (list as Array<{ name?: string; metricId?: string; score?: number; reasoning?: string }>)
          .filter((e) => typeof e.score === 'number')
          .map((e) => ({ name: e.name ?? e.metricId ?? 'score', score: e.score!, reasoning: e.reasoning }))
      }
    }
    return []
  }, [node])
  const fromJudges = useMemo<Entry[]>(
    () => judges.map((j) => ({ name: j.metricId, score: j.score, reasoning: j.reasoning })),
    [judges],
  )
  const entries = fromInspection.length > 0 ? fromInspection : fromArtifact.length > 0 ? fromArtifact : fromJudges

  if (entries.length === 0) {
    return <EmptyHint>No scorer / judge results recorded for this span.</EmptyHint>
  }
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {entries.map((e, i) => {
        const tone: ChipTone = e.score >= 0.85 ? 'ok' : e.score >= 0.6 ? 'crux' : e.score < 0.4 ? 'danger' : 'warn'
        const palette = {
          ok: { fg: 'var(--qw-ok)', bg: 'var(--qw-ok-soft)' },
          crux: { fg: 'var(--qw-crux)', bg: 'var(--qw-crux-soft)' },
          warn: { fg: 'var(--qw-warn)', bg: 'var(--qw-warn-soft)' },
          danger: { fg: 'var(--qw-danger)', bg: 'var(--qw-danger-soft)' },
          muted: { fg: 'var(--qw-fg-muted)', bg: 'var(--qw-bg-muted)' },
          iris: { fg: 'var(--qw-iris)', bg: 'var(--qw-iris-soft)' },
        }[tone]
        return (
          <div
            key={`${e.name}-${i}`}
            className="rounded-[10px] px-4 py-3"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                {e.name}
              </span>
              <span
                className="rounded-[4px] px-2 py-0.5 font-mono text-[12px] font-semibold"
                style={{ background: palette.bg, color: palette.fg }}
              >
                {e.score.toFixed(2)}
              </span>
            </div>
            {e.reasoning && (
              <div className="text-[12px] leading-[1.55]" style={{ color: 'var(--qw-fg-faint)' }}>
                {e.reasoning}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Citations ──────────────────────────────────────────────────────

function CitationsTab({ node }: { node: ObservabilityRunDetailNode }) {
  type Entry = { num?: string | number; sourceId?: string; path?: string; score?: number; status?: string }

  // Prefer inspection.citations
  const fromInspection: Entry[] = useMemo(() => {
    const insp = inspectionOf(node)
    if (!insp?.citations) return []
    const out: Entry[] = []
    for (const item of insp.citations) {
      const data = item.data
      if (data == null) continue
      if (Array.isArray(data)) {
        out.push(...(data as Entry[]))
        continue
      }
      if (typeof data === 'object') {
        const obj = data as { citations?: unknown; entries?: unknown }
        const list = obj.citations ?? obj.entries
        if (Array.isArray(list)) out.push(...(list as Entry[]))
        else out.push(data as Entry)
      }
    }
    return out
  }, [node])

  const report = findArtifact(node, 'citation.report')
  const fromArtifact: Entry[] = useMemo(() => {
    if (fromInspection.length > 0) return []
    const raw = report?.preview
    if (!raw) return []
    if (Array.isArray(raw)) return raw as Entry[]
    if (typeof raw === 'object' && raw !== null) {
      const list =
        (raw as { citations?: unknown; entries?: unknown }).citations ?? (raw as { entries?: unknown }).entries
      if (Array.isArray(list)) return list as Entry[]
    }
    return []
  }, [report, fromInspection])

  const entries = fromInspection.length > 0 ? fromInspection : fromArtifact
  if (entries.length === 0) {
    return <PendingFromBackend what="Citation report" />
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((c, i) => {
        const num = c.num ?? `[${i + 1}]`
        const path = c.path ?? c.sourceId ?? ''
        const tone: ChipTone = c.status === 'unused' || c.status === 'warn' ? 'warn' : 'ok'
        return (
          <div
            key={`${num}-${path}-${i}`}
            className="flex items-center gap-2.5 rounded-[6px] px-3 py-2"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-crux)' }}>
              {num}
            </span>
            <span className="flex-1 truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }} title={path}>
              {path}
            </span>
            {typeof c.score === 'number' ? (
              <Chip tone={tone} mono>
                {c.score.toFixed(2)}
              </Chip>
            ) : (
              <Chip tone={tone}>{c.status ?? 'unused'}</Chip>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Children list (group/flow/composition) ─────────────────────────

function ChildrenTab({ node, onSelect }: { node: ObservabilityRunDetailNode; onSelect: (id: string) => void }) {
  const children = node.children ?? []
  if (children.length === 0) {
    return <EmptyHint>No child spans under this node.</EmptyHint>
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>
        {node.primitive.startsWith('flow') ? 'Steps' : 'Children'} · {children.length}
      </Eyebrow>
      {children.map((c: ObservabilityRunDetailNode) => {
        const kind = classifyPrimitive(c.primitive)
        const accent = KIND_ACCENT[kind]
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="grid items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition-opacity hover:opacity-90"
            style={{
              gridTemplateColumns: '88px 1fr 90px 70px 70px',
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              borderLeft: `3px solid ${accent}`,
            }}
          >
            <Chip tone={statusTone(c.status)} dot>
              {statusLabel(c.status)}
            </Chip>
            <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[12px]">
              <span style={{ color: accent }}>{c.primitive}</span>
              <span style={{ color: 'var(--qw-fg-faint)' }}>·</span>
              <span className="truncate" style={{ color: 'var(--qw-fg)' }}>
                {c.display?.label ?? c.name}
              </span>
            </span>
            <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {fmtDuration(nodeDuration(c))}
            </span>
            <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {fmtTokens(nodeTokens(c))}
            </span>
            <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {fmtCost(nodeCost(c))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Metadata ───────────────────────────────────────────────────────

function MetadataTab({
  node,
  trace,
  isRoot,
}: {
  node: ObservabilityRunDetailNode
  trace: Trace | undefined
  isRoot: boolean
}) {
  const rows: { k: string; v: string }[] = []
  rows.push({ k: 'spanId', v: node.spanId })
  rows.push({ k: 'primitive', v: node.primitive })
  if (node.family) rows.push({ k: 'family', v: node.family })
  if (node.name) rows.push({ k: 'name', v: node.name })
  if (node.status) rows.push({ k: 'status', v: node.status })
  if (node.timing?.startedAt) rows.push({ k: 'startedAt', v: node.timing.startedAt })
  if (node.timing?.endedAt) rows.push({ k: 'endedAt', v: node.timing.endedAt })
  if (node.timing?.durationMs != null) rows.push({ k: 'durationMs', v: String(node.timing.durationMs) })
  if (node.timing?.selfMs != null) rows.push({ k: 'selfMs', v: String(node.timing.selfMs) })
  if (node.model) rows.push({ k: 'model', v: node.model })
  if (node.provider) rows.push({ k: 'provider', v: node.provider })
  if (node.promptId) rows.push({ k: 'promptId', v: node.promptId })
  if (node.contextId) rows.push({ k: 'contextId', v: node.contextId })
  if (node.agentId) rows.push({ k: 'agentId', v: node.agentId })
  if (node.toolName) rows.push({ k: 'toolName', v: node.toolName })
  if (node.flowId) rows.push({ k: 'flowId', v: node.flowId })
  if (node.stepId) rows.push({ k: 'stepId', v: node.stepId })
  if (node.memoryId) rows.push({ k: 'memoryId', v: node.memoryId })
  if (node.retrieverId) rows.push({ k: 'retrieverId', v: node.retrieverId })

  const tokKeys = [
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'costUsd',
  ]
  for (const k of tokKeys) {
    const v = readMetric(node, k)
    if (v != null) rows.push({ k, v: k === 'costUsd' ? v.toFixed(6) : String(v) })
  }

  const attrs = node.attributes as Record<string, unknown> | null | undefined
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('_')) continue
      if (rows.find((r) => r.k === k)) continue
      const formatted =
        typeof v === 'string'
          ? v
          : typeof v === 'number' || typeof v === 'boolean'
            ? String(v)
            : v == null
              ? ''
              : asString(v)
      if (formatted) rows.push({ k, v: formatted.length > 200 ? formatted.slice(0, 200) + '…' : formatted })
    }
  }

  if (isRoot && trace?.source) {
    rows.push({
      k: 'source',
      v: `${trace.source.file}:${trace.source.line}${trace.source.function ? ` · ${trace.source.function}` : ''}`,
    })
  }

  // Canonical graph linkage (new backend's `source` field).
  const src = sourceOf(node)
  if (src) {
    if (src.placementReason) rows.push({ k: 'placement', v: src.placementReason })
    if (src.canonicalParentSpanId) rows.push({ k: 'canonicalParent', v: src.canonicalParentSpanId })
    if (src.ownerSpanId) rows.push({ k: 'ownerSpan', v: src.ownerSpanId })
  }

  const models = resolveModels(node)

  return (
    <div className="flex flex-col gap-3">
      {models.length > 0 && (
        <CardShell label={`Models · ${models.length}`}>
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {models.map((m, i) => (
              <div
                key={i}
                className="grid items-baseline gap-2 px-3.5 py-2 font-mono text-[11.5px]"
                style={{ background: 'var(--qw-bg-elev)', gridTemplateColumns: '70px 1fr 1fr 160px' }}
              >
                <Chip tone="iris" mono>
                  {m.provider ?? '—'}
                </Chip>
                <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={m.model}>
                  {shortModelId(m.model) ?? '—'}
                </span>
                <span
                  className="truncate"
                  style={{ color: 'var(--qw-fg-muted)' }}
                  title={m.owner.display?.label ?? m.owner.name}
                >
                  {m.owner.display?.label ?? m.owner.name ?? m.owner.primitive}
                </span>
                <span className="truncate text-right" style={{ color: 'var(--qw-fg-faint)' }} title={m.responseId}>
                  {m.responseId ?? ''}
                </span>
              </div>
            ))}
          </div>
        </CardShell>
      )}
      <CardShell label={`Attributes · ${rows.length}`}>
        <div className="px-3.5 py-3">
          <table className="w-full font-mono text-[11.5px]">
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td className="py-1 pr-3 align-top" style={{ color: 'var(--qw-fg-faint)', width: '180px' }}>
                    {r.k}
                  </td>
                  <td className="break-all py-1" style={{ color: 'var(--qw-fg)' }}>
                    {r.v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardShell>
    </div>
  )
}

// ─── Header + KPI strip ─────────────────────────────────────────────

function SelectedSpanHeader({
  node,
  detail,
  kind,
  isRoot,
  trace,
}: {
  node: ObservabilityRunDetailNode
  detail: ObservabilityRunDetail
  kind: PrimitiveKind
  isRoot: boolean
  trace: Trace | undefined
}) {
  const accent = KIND_ACCENT[kind]
  const dur = fmtDuration(nodeDuration(node))

  // Resolve which model(s) backed this span — node.model is empty in the
  // new backend; the routed model lives on output.meta.actualModelId.
  const models = useMemo(() => resolveModels(node), [node])
  const distinctModels = Array.from(new Set(models.map((m) => m.model).filter((m): m is string => !!m)))
  const distinctProviders = Array.from(new Set(models.map((m) => m.provider).filter((p): p is string => !!p)))
  const primaryModel = node.model || shortModelId(distinctModels[0])
  const primaryProvider = node.provider || distinctProviders[0]

  // Pull tokens/cost from node + descendants — root spans don't have own
  // usage; their tokens are the sum of leaf generation events.
  const inputTok = readMetric(node, 'inputTokens') ?? readMetricDeep(node, 'inputTokens')
  const outputTok = readMetric(node, 'outputTokens') ?? readMetricDeep(node, 'outputTokens')
  const totalTok =
    readMetric(node, 'totalTokens') ??
    readMetricDeep(node, 'totalTokens') ??
    ((inputTok ?? 0) + (outputTok ?? 0) || undefined)
  const cachedTok = readMetric(node, 'cachedInputTokens') ?? readMetricDeep(node, 'cachedInputTokens')
  const reasoningTok = readMetric(node, 'reasoningTokens') ?? readMetricDeep(node, 'reasoningTokens')
  const costN =
    readMetric(node, 'cost') ??
    readMetric(node, 'costUsd') ??
    readMetricDeep(node, 'cost') ??
    readMetricDeep(node, 'costUsd')
  const tps = tokensPerSecond(node)
  const ttftMs = isRoot ? trace?.streaming?.ttftMs : undefined
  const finishReasons = finishReasonsFor(node)

  const tokens = fmtTokens(totalTok)
  const cost = fmtCost(costN)

  return (
    <>
      <div
        className="flex flex-shrink-0 flex-wrap items-center gap-2 px-4 py-3 font-mono text-[12px]"
        style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
      >
        <Chip tone={statusTone(node.status)} dot>
          {statusLabel(node.status)}
        </Chip>
        <span style={{ color: accent, fontWeight: 600 }}>{node.primitive}</span>
        {(primaryProvider || primaryModel) && (
          <>
            <span style={{ color: 'var(--qw-fg-faint)' }}>·</span>
            <span title={distinctModels.join(', ')}>
              {[primaryProvider, primaryModel].filter(Boolean).join(' · ')}
              {distinctModels.length > 1 && (
                <span style={{ color: 'var(--qw-fg-faint)' }}>
                  {' +'}
                  {distinctModels.length - 1}
                </span>
              )}
            </span>
          </>
        )}
        {node.display?.label && node.display.label !== node.primitive && (
          <>
            <span style={{ color: 'var(--qw-fg-faint)' }}>·</span>
            <span style={{ color: 'var(--qw-fg-muted)' }}>{node.display.label}</span>
          </>
        )}
        {finishReasons.length > 0 && (
          <>
            <span style={{ color: 'var(--qw-fg-faint)' }}>·</span>
            {finishReasons.map((r) => (
              <Chip key={r} tone={r === 'stop' ? 'ok' : r === 'tool-calls' ? 'iris' : 'muted'} mono>
                {r}
              </Chip>
            ))}
          </>
        )}
        <span className="ml-auto flex items-center gap-2" style={{ color: 'var(--qw-fg-muted)' }}>
          <span>{dur}</span>
          {tokens !== '—' && (
            <>
              <span style={{ color: 'var(--qw-fg-faint)' }}>·</span>
              <span>{tokens}</span>
            </>
          )}
          {cost !== '—' && (
            <>
              <span style={{ color: 'var(--qw-fg-faint)' }}>·</span>
              <span>{cost}</span>
            </>
          )}
        </span>
      </div>

      {/* Status banners for first-class waiting/blocked states */}
      {node.status === 'suspended' && (
        <div
          className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5 text-[12px]"
          style={{
            background: 'var(--qw-iris-soft)',
            color: 'var(--qw-iris)',
            borderBottom: '1px solid var(--qw-border)',
          }}
        >
          <Icon name="alert" size={13} color="var(--qw-iris)" />
          <span className="font-semibold">
            {node.primitive === 'flow.suspension'
              ? `Suspended at: ${(findAttribute(node, 'suspendPoint') as string | undefined) ?? node.name ?? 'unknown'}`
              : 'Suspended'}
          </span>
          <span className="font-mono opacity-80" style={{ color: 'var(--qw-fg-muted)' }}>
            {node.primitive === 'flow.suspension'
              ? `flowId · ${(findAttribute(node, 'flowId') as string | undefined) ?? '—'}`
              : 'waiting for a signal — plan approval, human review, or resume'}
          </span>
        </div>
      )}
      {node.status === 'blocked' && (
        <div
          className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5 text-[12px]"
          style={{
            background: 'var(--qw-danger-soft)',
            color: 'var(--qw-danger)',
            borderBottom: '1px solid var(--qw-border)',
          }}
        >
          <Icon name="alert" size={13} color="var(--qw-danger)" />
          <span className="font-semibold">Blocked</span>
          <span className="font-mono opacity-80" style={{ color: 'var(--qw-fg-muted)' }}>
            guardrail / constraint / safety check stopped execution
          </span>
        </div>
      )}

      {/* KPI strip — only for full-span kinds (generation/run/agent) */}
      {(kind === 'run' || kind === 'generation' || kind === 'agent') && (
        <div
          className="grid flex-shrink-0 gap-2 px-4 py-3"
          style={{ gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid var(--qw-border)' }}
        >
          <Kpi
            label="Duration"
            value={dur}
            sublabel={
              ttftMs != null
                ? `TTFT ${ttftMs}ms`
                : node.timing?.selfMs != null && node.timing?.childrenMs != null
                  ? `${fmtDuration(node.timing.selfMs)} self · ${fmtDuration(node.timing.childrenMs)} children`
                  : node.timing?.selfMs != null
                    ? `${fmtDuration(node.timing.selfMs)} self`
                    : undefined
            }
          />
          <Kpi
            label="Tokens"
            value={tokens}
            sublabel={
              inputTok != null || outputTok != null
                ? `${fmtTokens(inputTok)} in · ${fmtTokens(outputTok)} out${cachedTok ? ` · ${fmtTokens(cachedTok)} cached` : ''}`
                : reasoningTok
                  ? `${fmtTokens(reasoningTok)} reasoning`
                  : undefined
            }
          />
          <Kpi
            label="Cost"
            value={cost}
            sublabel={
              reasoningTok
                ? `${fmtTokens(reasoningTok)} reasoning tok`
                : totalTok && costN
                  ? `${((costN / totalTok) * 1_000_000).toFixed(2)} ¢/Mtok`
                  : undefined
            }
          />
          <Kpi
            label={isRoot ? 'Spans' : kind === 'generation' ? 'Throughput' : 'Children'}
            value={
              kind === 'generation' && tps != null
                ? `${tps.toFixed(1)}t/s`
                : String(isRoot ? detail.run.spanCount : (node.children?.length ?? 0))
            }
            sublabel={
              kind === 'generation' && tps != null
                ? outputTok != null
                  ? `${fmtTokens(outputTok)} out / ${fmtDuration(node.timing?.selfMs ?? nodeDuration(node))}`
                  : undefined
                : isRoot
                  ? `${detail.counts.attachedDetails ?? 0} attached`
                  : undefined
            }
          />
        </div>
      )}
    </>
  )
}

function TabStrip({
  tabs,
  active,
  onSelect,
  counts,
}: {
  tabs: readonly InspectTabId[]
  active: InspectTabId
  onSelect: (id: InspectTabId) => void
  counts: Partial<Record<InspectTabId, number>>
}) {
  return (
    <div
      className="flex flex-shrink-0 items-center px-4 text-[12px]"
      style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
    >
      {tabs.map((id) => {
        const isActive = id === active
        const count = counts[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className="-mb-px flex items-center gap-1.5 px-2.5 py-2"
            style={{
              color: isActive ? 'var(--qw-fg)' : 'var(--qw-fg-muted)',
              borderBottom: isActive ? '2px solid var(--qw-crux)' : '2px solid transparent',
              fontWeight: isActive ? 600 : 450,
              fontFamily: 'var(--qw-mono)',
            }}
          >
            {TAB_LABEL[id]}
            {count != null && count > 0 && (
              <span
                className="rounded-[3px] px-[5px] py-px font-mono text-[10px]"
                style={{
                  color: isActive ? 'var(--qw-crux)' : 'var(--qw-fg-faint)',
                  background: isActive ? 'var(--qw-crux-soft)' : 'var(--qw-bg-muted)',
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Panel ──────────────────────────────────────────────────────────

interface SpanDetailPanelProps {
  detail: ObservabilityRunDetail | null
  selectedNodeId: string | null
  onSelectSpan?: (id: string) => void
  trace: Trace | undefined
  judges: readonly JudgeEventData[]
}

export function SpanDetailPanel({ detail, selectedNodeId, onSelectSpan, trace, judges }: SpanDetailPanelProps) {
  if (!detail?.root) {
    return (
      <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
        Run detail unavailable.
      </div>
    )
  }

  const node = findNode(detail.root, selectedNodeId) ?? detail.root
  const isRoot = node.id === detail.root.id
  const kind = isRoot ? 'run' : classifyPrimitive(node.primitive)
  const hasChildren = (node.children?.length ?? 0) > 0
  const tabs = tabsForKind(kind, hasChildren)

  const [activeTab, setActiveTab] = useState<InspectTabId>(tabs[0])
  // Reset to default tab whenever the selected node changes (so switching
  // from a generation to a tool.call doesn't leave us on a hidden tab).
  const tabKey = `${node.id}:${tabs.join(',')}`
  const [tabsForId, setTabsForId] = useState<string>(tabKey)
  if (tabsForId !== tabKey) {
    setTabsForId(tabKey)
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0])
    }
  }

  const spanJudges = useMemo(
    () => judges.filter((j) => !j.traceId || j.traceId === node.traceId || j.traceId === detail.run.runId),
    [judges, node.traceId, detail.run.runId],
  )

  const counts: Partial<Record<InspectTabId, number>> = useMemo(() => {
    const c: Partial<Record<InspectTabId, number>> = {}
    const scope = isRoot ? detail.root : node

    if (tabs.includes('context')) {
      const partsLen = trace?.inspect?.system?.parts?.length ?? 0
      const hasPrompt = trace?.inspect?.prompt ? 1 : 0
      const v = partsLen + hasPrompt
      if (v > 0) c.context = v
    }
    if (tabs.includes('tools')) {
      const t = gatherDescendants(scope).filter(
        (n) => n.primitive === 'tool.call' || n.primitive === 'tool' || n.toolName,
      ).length
      if (t > 0) c.tools = t
    }
    if (tabs.includes('retrieval')) {
      const r = gatherDescendants(scope).filter(
        (n) =>
          n.primitive.startsWith('retrieval.') || n.primitive === 'embedding.call' || n.primitive.startsWith('memory.'),
      ).length
      if (r > 0) c.retrieval = r
    }
    if (tabs.includes('scores')) {
      const scoreArt = findArtifact(node, 'score.report')
      const scoreCount = Array.isArray(scoreArt?.preview)
        ? (scoreArt!.preview as unknown[]).length
        : Array.isArray((scoreArt?.preview as { scores?: unknown })?.scores)
          ? (scoreArt!.preview as { scores: unknown[] }).scores.length
          : spanJudges.length
      if (scoreCount > 0) c.scores = scoreCount
    }
    if (tabs.includes('citations')) {
      const citationArt = findArtifact(node, 'citation.report')
      const citations = Array.isArray(citationArt?.preview)
        ? (citationArt!.preview as unknown[]).length
        : Array.isArray((citationArt?.preview as { citations?: unknown })?.citations)
          ? (citationArt!.preview as { citations: unknown[] }).citations.length
          : 0
      if (citations > 0) c.citations = citations
    }
    if (tabs.includes('children')) {
      c.children = node.children?.length ?? 0
    }
    return c
  }, [node, detail.root, isRoot, spanJudges, tabs, trace])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SelectedSpanHeader node={node} detail={detail} kind={kind} isRoot={isRoot} trace={trace} />
      <TabStrip tabs={tabs} active={activeTab} onSelect={setActiveTab} counts={counts} />
      {/* Per-tab error boundary: a broken render on one tab (malformed
          message payload, unexpected handoff shape, etc.) shouldn't
          take down the rest of the span detail panel. `resetKey` ties
          the boundary to the selected node + tab, so switching tabs or
          spans gives a clean retry surface. */}
      <div className={activeTab === 'canvas' ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto px-4 py-4'}>
        <SectionErrorBoundary
          title={`${TAB_LABEL[activeTab] ?? activeTab} tab`}
          compact
          resetKey={`${node.id}:${activeTab}`}
        >
          {activeTab === 'output' && <OutputTab node={node} trace={trace} isRoot={isRoot} />}
          {activeTab === 'context' && <ContextTab node={node} trace={trace} isRoot={isRoot} />}
          {activeTab === 'tool' && <ToolSpanTab node={node} />}
          {activeTab === 'memory' && <MemoryTab node={node} />}
          {activeTab === 'handoff' && <HandoffTab node={node} />}
          {activeTab === 'tools' && <ToolsTab scope={isRoot ? detail.root : node} />}
          {activeTab === 'retrieval' &&
            (kind === 'retrieval' ? (
              <RetrievalSpanTab node={node} />
            ) : (
              <RetrievalAggregateTab scope={isRoot ? detail.root : node} />
            ))}
          {activeTab === 'scores' && <ScoresTab node={node} judges={spanJudges} />}
          {activeTab === 'citations' && <CitationsTab node={node} />}
          {activeTab === 'metadata' && <MetadataTab node={node} trace={trace} isRoot={isRoot} />}
          {activeTab === 'children' && <ChildrenTab node={node} onSelect={(id) => onSelectSpan?.(id)} />}
          {activeTab === 'canvas' && (
            <Suspense fallback={<div className="p-4"><SkeletonCard bodyLines={6} height={420} /></div>}>
              <SpanGraph root={nodeFromRunDetail(node, 0)} selectedId={node.id} onSelect={(id) => onSelectSpan?.(id)} />
            </Suspense>
          )}
        </SectionErrorBoundary>
      </div>
    </div>
  )
}
