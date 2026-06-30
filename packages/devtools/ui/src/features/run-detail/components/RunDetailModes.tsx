import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/shared/components/ui/resizable'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useObservabilityGraph } from '@/features/observability/hooks/useObservabilityGraph'
import { SpanTree } from '@/features/run-detail/components/SpanTree'
import { SpanDetailPanel } from '@/features/run-detail/components/SpanDetailPanel'
import { SpanInspector, InspectorRail } from '@/features/run-detail/components/SpanInspector'
import { RunStructureState } from '@/features/run-detail/components/RunDetailStates'
import { EvalRunCard, OperationReportCard } from '@/features/run-detail/components/PrimitiveCards'
import { EmptyHint } from '@/features/run-detail/components/SpanDetailPanelAtoms'
import { LensSwitch } from '@/features/run-detail/components/atoms'
import type { RunArchetype } from '@/features/run-detail/lib/archetype'
import { warningTurnSpanIds } from '@/features/run-detail/lib/explain/rollup'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { SkeletonCard } from '@/shared/components/Skeleton'
import type { JudgeEventData, Trace } from '@/types'
import type { RunLens } from '@/features/run-detail/types'

// SpanGraph drags in @xyflow/react (large) + the @xyflow CSS — only
// Canvas mode renders it, so keep it out of the main run-detail bundle.
const SpanGraph = lazy(() =>
  import('@/features/run-detail/components/SpanGraph').then((m) => ({ default: m.SpanGraph })),
)

/** Leading "Summary" segment for the lens bar (eval/indexing roots). */
export interface SummaryNav {
  active: boolean
  onSelect: () => void
}

export function CanvasMode({
  traceId,
  spanId,
  lens,
  onSelectLens,
  summaryNav,
  trace,
  judges,
}: {
  traceId: string
  spanId?: string
  lens: RunLens
  onSelectLens: (lens: RunLens) => void
  summaryNav?: SummaryNav
  trace: Trace | undefined
  judges: readonly JudgeEventData[]
}) {
  const { navigate } = useNavigation()
  const canonical = useObservabilityGraph(traceId)
  const tree = canonical.spanTree
  const selectedSpanId = spanId ?? tree?.id ?? traceId ?? null
  const warningSpanIds = useMemo(
    () => (canonical.runDetail ? warningTurnSpanIds(canonical.runDetail.root) : undefined),
    [canonical.runDetail],
  )
  const handleSelectSpan = useCallback(
    (id: string) => {
      // Selecting a node keeps the current (graph) lens — selection is shared.
      navigate({ view: 'run-detail', traceId, lens: 'graph', spanId: id })
    },
    [navigate, traceId],
  )
  const openInTree = useCallback(() => {
    navigate({ view: 'run-detail', traceId, lens: 'tree', spanId: selectedSpanId ?? undefined })
  }, [navigate, traceId, selectedSpanId])

  if (!tree) {
    return <RunStructureState traceId={traceId} error={canonical.error} loading={canonical.loading} />
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Canvas */}
      <div className="relative min-w-0 flex-1" style={{ background: 'var(--qw-bg)' }}>
        {/* Lens switch — floats over the canvas at the same offset as the
            tree's structure-pane switch (px-2.5 py-2), so it doesn't jump. */}
        <div className="absolute left-2.5 top-2 z-10">
          <LensSwitch active={lens} onSelect={onSelectLens} dense summary={summaryNav} />
        </div>
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
            <SpanGraph
              root={tree}
              selectedId={selectedSpanId}
              warningSpanIds={warningSpanIds}
              onSelect={handleSelectSpan}
            />
          </Suspense>
        </SectionBoundary>
      </div>
      {/* Detail drawer (design `RunDetailGraph`) — not the constant inspector
          but the selected span's detail pane + an "Open in Tree" jump. */}
      <div
        className="flex min-h-0 flex-col"
        style={{ width: 400, flex: '0 0 400px', borderLeft: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          <SpanDetailPanel
            detail={canonical.runDetail}
            selectedNodeId={selectedSpanId}
            onSelectSpan={handleSelectSpan}
            trace={trace}
            judges={judges}
          />
        </div>
        <div className="flex-shrink-0 p-2.5" style={{ borderTop: '1px solid var(--qw-border)' }}>
          <Btn
            variant="soft"
            size="sm"
            icon={<Icon name="trace" size={13} />}
            onClick={openInTree}
            className="w-full justify-center"
          >
            Open in Tree
          </Btn>
        </div>
      </div>
    </div>
  )
}

export function InspectMode({
  traceId,
  spanId,
  trace,
  judges,
  lens,
  layout,
  onSelectLens,
  summaryNav,
  triage = false,
}: {
  traceId: string
  spanId?: string
  trace: Trace | undefined
  judges: readonly JudgeEventData[]
  /** The active lens (`tree` or `timeline`) — preserved when selecting a span. */
  lens: RunLens
  /** Structure layout driven by the lens. */
  layout: 'tree' | 'timeline'
  /** Switch lenses — the segmented control sits atop the Structure pane. */
  onSelectLens: (lens: RunLens) => void
  /** Leading Summary segment (eval/indexing roots). */
  summaryNav?: SummaryNav
  /** Run failed → the tree opens collapsed to the failure path. */
  triage?: boolean
}) {
  const { navigate } = useNavigation()
  const canonical = useObservabilityGraph(traceId)
  const tree = canonical.spanTree
  const selectedSpanId = spanId ?? tree?.id ?? traceId ?? null
  // Spans whose turn explanation carries a warning — badged in the structure
  // lens; selecting one opens Explain by default.
  const warningSpanIds = useMemo(
    () => (canonical.runDetail ? warningTurnSpanIds(canonical.runDetail.root) : undefined),
    [canonical.runDetail],
  )
  // Timeline wants a wide structure axis, so the inspector starts collapsed
  // there (design `RunDetailTimeline`); Tree keeps the inspector pinned open.
  const isTimeline = layout === 'timeline'
  const [inspectorOpen, setInspectorOpen] = useState(!isTimeline)

  const handleSelectSpan = useCallback(
    (id: string) => {
      navigate({ view: 'run-detail', traceId, lens, spanId: id })
    },
    [navigate, traceId, lens],
  )

  if (!tree) {
    return <RunStructureState traceId={traceId} error={canonical.error} loading={canonical.loading} />
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Structure | Detail — resizable */}
      <div className="min-w-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 overflow-hidden">
          {/* Structure pane — wider in Timeline so the time axis has room. */}
          <ResizablePanel defaultSize={isTimeline ? '46%' : '34%'} minSize="18%" maxSize="62%">
            <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ background: 'var(--qw-bg)' }}>
              {/* Lens switch — heads the Structure pane (design `StructureTree`). */}
              <div
                className="flex flex-shrink-0 items-center px-2.5 py-2"
                style={{ borderBottom: '1px solid var(--qw-border)' }}
              >
                <LensSwitch active={lens} onSelect={onSelectLens} dense summary={summaryNav} />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <SpanTree
                  tree={tree}
                  selectedId={selectedSpanId}
                  warningSpanIds={warningSpanIds}
                  onSelect={handleSelectSpan}
                  layout={layout}
                  triage={triage}
                />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-[var(--qw-border)]" />
          <ResizablePanel defaultSize={isTimeline ? '54%' : '66%'}>
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
      </div>
      {/* Inspector — constant facts & quality rail; collapsible */}
      {inspectorOpen ? (
        <SpanInspector
          runDetail={canonical.runDetail}
          selectedNodeId={selectedSpanId}
          onSelectSpan={handleSelectSpan}
          onCollapse={() => setInspectorOpen(false)}
        />
      ) : (
        <InspectorRail onExpand={() => setInspectorOpen(true)} />
      )}
    </div>
  )
}

/**
 * Summary landing (design `ArchEval`/`ArchIndexing`) — the root composite
 * node's archetype card, full-bleed + centered. Same cards as the detail
 * pane (chrome-free); the frame is the only difference. Default landing for
 * eval/indexing roots; the four lenses stay reachable from the bar.
 */
export function SummaryMode({
  traceId,
  archetype,
  onSelectLens,
  summaryNav,
}: {
  traceId: string
  archetype: RunArchetype
  onSelectLens: (lens: RunLens) => void
  summaryNav?: SummaryNav
}) {
  const { navigate } = useNavigation()
  const canonical = useObservabilityGraph(traceId)
  const root = canonical.runDetail?.root
  // Drill from a case/source row → Tree focused on that span.
  const drill = useCallback(
    (spanId: string) => navigate({ view: 'run-detail', traceId, lens: 'tree', spanId }),
    [navigate, traceId],
  )

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--qw-bg)' }}>
      <div
        className="flex flex-shrink-0 items-center px-2.5 py-2"
        style={{ borderBottom: '1px solid var(--qw-border)' }}
      >
        <LensSwitch active="tree" onSelect={onSelectLens} dense summary={summaryNav} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!root ? (
          <RunStructureState traceId={traceId} error={canonical.error} loading={canonical.loading} />
        ) : (
          <div className="mx-auto px-6 py-6" style={{ maxWidth: 1000 }}>
            {archetype === 'eval' ? (
              <EvalRunCard node={root} onSelect={drill} />
            ) : archetype === 'indexing' ? (
              <OperationReportCard node={root} />
            ) : (
              <EmptyHint>No summary view for this run type.</EmptyHint>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
