import { lazy, Suspense, useCallback } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/shared/components/ui/resizable'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useObservabilityGraph } from '@/features/observability/hooks/useObservabilityGraph'
import { SpanTree } from '@/features/run-detail/components/SpanTree'
import { SpanDetailPanel } from '@/features/run-detail/components/SpanDetailPanel'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard } from '@/shared/components/Skeleton'
import type { JudgeEventData, Trace } from '@/types'

// SpanGraph drags in @xyflow/react (large) + the @xyflow CSS — only
// Canvas mode renders it, so keep it out of the main run-detail bundle.
const SpanGraph = lazy(() =>
  import('@/features/run-detail/components/SpanGraph').then((m) => ({ default: m.SpanGraph })),
)

export function CanvasMode({ traceId, spanId }: { traceId: string; spanId?: string }) {
  const { navigate } = useNavigation()
  const canonical = useObservabilityGraph(traceId)
  const tree = canonical.spanTree
  const selectedSpanId = spanId ?? tree?.id ?? traceId ?? null
  const handleSelectSpan = useCallback(
    (id: string) => {
      navigate({ view: 'run-detail', traceId, mode: 'inspect', spanId: id })
    },
    [navigate, traceId],
  )

  if (!tree) {
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {canonical.loading ? 'Loading run detail...' : 'Run detail not found.'}
        {canonical.error ? ` (${canonical.error.message})` : ''}
      </div>
    )
  }

  return (
    <div className="h-full w-full" style={{ background: 'var(--qw-bg)' }}>
      <SectionBoundary
        title="Canvas"
        fallback={
          <div className="p-6">
            <SkeletonCard bodyLines={6} height={420} />
          </div>
        }
      >
        <Suspense
          fallback={
            <div className="p-6">
              <SkeletonCard bodyLines={6} height={420} />
            </div>
          }
        >
          <SpanGraph root={tree} selectedId={selectedSpanId} onSelect={handleSelectSpan} />
        </Suspense>
      </SectionBoundary>
    </div>
  )
}

export function InspectMode({
  traceId,
  spanId,
  trace,
  judges,
}: {
  traceId: string
  spanId?: string
  trace: Trace | undefined
  judges: readonly JudgeEventData[]
}) {
  const { navigate } = useNavigation()
  const canonical = useObservabilityGraph(traceId)
  const tree = canonical.spanTree
  const selectedSpanId = spanId ?? tree?.id ?? traceId ?? null

  const handleSelectSpan = useCallback(
    (id: string) => {
      navigate({ view: 'run-detail', traceId, mode: 'inspect', spanId: id })
    },
    [navigate, traceId],
  )

  if (!tree) {
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {canonical.loading ? 'Loading run detail...' : 'Run detail not found in the canonical observability store.'}
        {canonical.error ? ` (${canonical.error.message})` : ''}
      </div>
    )
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 overflow-hidden">
      <ResizablePanel defaultSize="38%" minSize="20%" maxSize="65%">
        <div className="h-full overflow-hidden" style={{ background: 'var(--qw-bg)' }}>
          <SpanTree tree={tree} selectedId={selectedSpanId} onSelect={handleSelectSpan} />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle className="bg-[var(--qw-border)]" />
      <ResizablePanel defaultSize="62%">
        <div className="h-full w-full overflow-hidden" style={{ background: 'var(--qw-bg)' }}>
          <SpanDetailPanel
            detail={canonical.runDetail}
            selectedNodeId={selectedSpanId}
            onSelectSpan={handleSelectSpan}
            trace={trace}
            judges={judges}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
