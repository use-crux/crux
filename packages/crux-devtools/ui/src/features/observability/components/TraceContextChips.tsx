import type { Trace } from '@/types'
import { Pill } from '@/shared/components/ui-atoms'
import { useNavigation } from '@/app/navigation/useNavigation'

export function TraceContextChips({ trace }: { trace: Trace }) {
  const { navigate } = useNavigation()
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {trace.promptId && (
        <button
          onClick={() => navigate({ view: 'library-catalog', promptId: trace.promptId! })}
          className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors rounded"
        >
          <span className="text-zinc-500">Prompt:</span> {trace.promptId}
        </button>
      )}
      {trace.sessionId && (
        <button
          onClick={() => navigate({ view: 'runs', groupBy: 'session' })}
          className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors rounded"
        >
          <span className="text-zinc-500">Session:</span> {trace.sessionId.slice(0, 12)}...
        </button>
      )}
      {trace.flowId && (
        <Pill>
          <span className="text-zinc-500">Flow:</span> {trace.flowId.slice(0, 12)}...
        </Pill>
      )}
      {trace.parentTraceId && (
        <button
          onClick={() => navigate({ view: 'run-detail', traceId: trace.parentTraceId! })}
          className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors rounded"
        >
          <span className="text-zinc-500">Parent:</span> {trace.parentTraceId.slice(0, 8)}...
        </button>
      )}
    </div>
  )
}
