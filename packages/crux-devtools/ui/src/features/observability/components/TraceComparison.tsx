import type { Trace } from '@/types'
import { fmt } from '@/shared/components/ui-atoms'

interface TraceComparisonProps {
  traceA: Trace
  traceB: Trace
  onClose: () => void
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '...'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function DeltaIndicator({
  label,
  a,
  b,
  format,
}: {
  label: string
  a: number | undefined
  b: number | undefined
  format: (v: number) => string
}) {
  if (a == null || b == null) return null
  const delta = b - a
  const pct = a > 0 ? (delta / a) * 100 : 0
  const color = Math.abs(pct) < 5 ? 'text-zinc-400' : delta > 0 ? 'text-red-400' : 'text-emerald-400'

  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-zinc-500">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-zinc-400 tabular-nums">{format(a)}</span>
        <span className="text-zinc-600">{'\u2192'}</span>
        <span className="text-zinc-400 tabular-nums">{format(b)}</span>
        <span className={`${color} tabular-nums text-[10px] w-16 text-right`}>
          {delta > 0 ? '+' : ''}
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

function TraceColumn({ trace, label }: { trace: Trace; label: string }) {
  const usage = trace.result?.usage
  const statusColor =
    trace.status === 'success' ? 'text-emerald-400' : trace.status === 'error' ? 'text-red-400' : 'text-blue-400'

  return (
    <div className="flex-1 min-w-0 space-y-3">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="space-y-2">
        <div className="text-xs">
          <span className="text-zinc-500">Prompt: </span>
          <span className="font-mono text-zinc-300">{trace.promptId ?? 'unnamed'}</span>
        </div>
        <div className="text-xs">
          <span className="text-zinc-500">Model: </span>
          <span className="font-mono text-zinc-300">{trace.model.replace(/^[^/]+\//, '')}</span>
        </div>
        <div className="text-xs">
          <span className="text-zinc-500">Status: </span>
          <span className={statusColor}>{trace.status}</span>
        </div>
        <div className="text-xs">
          <span className="text-zinc-500">Duration: </span>
          <span className="tabular-nums text-zinc-300">{formatDuration(trace.durationMs)}</span>
        </div>
        {usage?.totalTokens != null && (
          <div className="text-xs">
            <span className="text-zinc-500">Tokens: </span>
            <span className="tabular-nums text-zinc-300">{usage.totalTokens.toLocaleString()}</span>
          </div>
        )}
        {trace.result?.cost != null && (
          <div className="text-xs">
            <span className="text-zinc-500">Cost: </span>
            <span className="tabular-nums text-emerald-400">{formatCost(trace.result.cost)}</span>
          </div>
        )}

        {/* Output preview */}
        {trace.result?.text != null && (
          <div className="mt-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Output</div>
            <div className="bg-zinc-950 rounded p-2 text-xs text-zinc-300 max-h-64 overflow-y-auto whitespace-pre-wrap">
              {trace.result.text.length > 500 ? trace.result.text.slice(0, 500) + '...' : trace.result.text}
            </div>
          </div>
        )}

        {/* System parts */}
        {trace.inspect && trace.inspect.system.parts.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">System Parts</div>
            <div className="space-y-0.5">
              {trace.inspect.system.parts
                .filter((p) => !p.skipped)
                .map((p) => (
                  <div key={p.source} className="flex items-center justify-between text-[10px]">
                    <span className="text-zinc-400 font-mono truncate">{p.source}</span>
                    <span className="text-zinc-600 tabular-nums">{p.tokens} tok</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function TraceComparison({ traceA, traceB, onClose }: TraceComparisonProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Trace Comparison</h3>
        <button
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
        >
          Close
        </button>
      </div>

      {/* Delta summary */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
        <DeltaIndicator label="Duration" a={traceA.durationMs} b={traceB.durationMs} format={formatDuration} />
        <DeltaIndicator
          label="Tokens"
          a={traceA.result?.usage?.totalTokens}
          b={traceB.result?.usage?.totalTokens}
          format={(v) => fmt(v, 'tok')}
        />
        <DeltaIndicator
          label="Cost"
          a={traceA.result?.cost ?? undefined}
          b={traceB.result?.cost ?? undefined}
          format={formatCost}
        />
      </div>

      {/* Side by side */}
      <div className="flex gap-4">
        <TraceColumn trace={traceA} label="Trace A" />
        <div className="w-px bg-zinc-800 shrink-0" />
        <TraceColumn trace={traceB} label="Trace B" />
      </div>
    </div>
  )
}
