/**
 * AppRouter — maps the discriminated NavState union onto a lazy-loaded
 * page component. Pages are code-split so that the initial paint (the
 * shell + the landing page) doesn't drag the entire app bundle.
 *
 * The router itself does not render Suspense — `App.tsx` mounts a single
 * top-level Suspense + ErrorBoundary that catches both lazy-load and any
 * render-time crashes. This lets `useTransition` keep the previous page
 * mounted while the next page resolves, instead of flashing a fallback.
 */

import { lazy } from 'react'
import { navTarget } from '@/app/navigation/navTarget'
import { useNavigation, type NavState } from '@/app/navigation/useNavigation'
import { QwShell } from '@/qw/shell/QwShell'
import { QwSidebar } from '@/qw/shell/QwSidebar'
import { CodeBlock } from '@/shared/components/ai-elements/code-block'

const OverviewPage = lazy(() => import('@/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const InsightsPage = lazy(() => import('@/pages/InsightsPage').then((m) => ({ default: m.InsightsPage })))
const RunsPage = lazy(() => import('@/pages/RunsPage').then((m) => ({ default: m.RunsPage })))
const RuntimePage = lazy(() => import('@/pages/RuntimePage').then((m) => ({ default: m.RuntimePage })))
const RunDetailPage = lazy(() => import('@/pages/RunDetailPage').then((m) => ({ default: m.RunDetailPage })))
const ExperimentsPage = lazy(() => import('@/pages/ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })))
const ExperimentDetailPage = lazy(() =>
  import('@/pages/ExperimentsPage').then((m) => ({ default: m.ExperimentDetailPage })),
)
const BaselinesPage = lazy(() => import('@/pages/BaselinesPage').then((m) => ({ default: m.BaselinesPage })))
const EvaluationsPage = lazy(() => import('@/pages/EvaluationsPage').then((m) => ({ default: m.EvaluationsPage })))
const FeedbackPage = lazy(() => import('@/pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })))
const CassettesPage = lazy(() => import('@/pages/CassettesPage').then((m) => ({ default: m.CassettesPage })))
const ScorersPage = lazy(() => import('@/pages/ScorersPage').then((m) => ({ default: m.ScorersPage })))
const MemoryPage = lazy(() => import('@/pages/MemoryPage').then((m) => ({ default: m.MemoryPage })))
const PlansPage = lazy(() => import('@/pages/PlansPage').then((m) => ({ default: m.PlansPage })))
const WorkspacesPage = lazy(() => import('@/pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })))
const IndexPage = lazy(() => import('@/pages/IndexPage').then((m) => ({ default: m.IndexPage })))

export function AppRouter({ nav }: { nav: NavState }) {
  switch (nav.view) {
    case 'overview':
    case 'dashboard':
      return <OverviewPage />
    case 'insights':
    case 'security':
      return (
        <InsightsPage
          filters={
            nav.view === 'insights'
              ? {
                  severity: nav.severity,
                  target: nav.target,
                  status: nav.status,
                  search: nav.search,
                }
              : {}
          }
          groupBy={nav.view === 'insights' ? (nav.groupBy ?? 'none') : 'none'}
        />
      )
    case 'runs':
    case 'traces':
    case 'sessions':
    case 'constraints':
      return (
        <RunsPage
          groupBy={nav.view === 'runs' ? (nav.groupBy ?? 'none') : 'none'}
          filters={
            nav.view === 'runs'
              ? {
                  status: nav.status,
                  target: nav.target,
                  model: nav.model,
                  last: nav.last,
                  has: nav.has,
                  search: nav.search,
                }
              : {}
          }
        />
      )
    case 'runtime':
      return <RuntimePage />
    case 'run-detail':
      return <RunDetailPage traceId={nav.traceId} lens={nav.lens} spanId={nav.spanId} summary={nav.summary} />
    case 'detail':
      if (nav.traceId) {
        return <RunDetailPage traceId={nav.traceId} />
      }
      return <RunsPage groupBy="none" filters={{}} />
    case 'evaluations':
      return <EvaluationsPage />
    case 'experiments':
    case 'evals':
      return <ExperimentsPage />
    case 'experiment-detail':
      return <ExperimentDetailPage experimentId={nav.experimentId} />
    case 'baselines':
      return <BaselinesPage />
    case 'feedback':
      return <FeedbackPage />
    case 'cassettes':
      return <CassettesPage />
    case 'scorers':
      return <ScorersPage />
    case 'library-index':
    case 'prompts':
      return (
        <IndexPage
          promptId={'promptId' in nav ? nav.promptId : undefined}
          contextId={'contextId' in nav ? nav.contextId : undefined}
          toolName={'toolName' in nav ? nav.toolName : undefined}
          tab={'tab' in nav ? nav.tab : undefined}
        />
      )
    case 'library-memory':
    case 'memory':
      return <MemoryPage memoryId={'memoryId' in nav ? nav.memoryId : undefined} />
    case 'library-workspaces':
    case 'workspaces':
      return (
        <WorkspacesPage
          workspaceId={'workspaceId' in nav ? nav.workspaceId : undefined}
          filePath={'filePath' in nav ? nav.filePath : undefined}
        />
      )
    case 'library-plans':
    case 'plans':
      return <PlansPage planId={'planId' in nav ? nav.planId : undefined} />
  }
}

export function WaitingShell({ connected }: { connected: boolean }) {
  const { navigate } = useNavigation()
  return (
    <div
      className="flex h-screen min-h-0 overflow-hidden"
      style={{
        background: 'var(--qw-bg)',
        color: 'var(--qw-fg)',
        fontFamily: 'var(--qw-sans)',
      }}
    >
      <QwSidebar />
      <QwShell
        activeView="overview"
        onNavigate={(v) => navigate(navTarget(v))}
        breadcrumb="Quality / Overview"
        title="Waiting for connection"
        subtitle="Connect your app to start collecting traces"
        connected={connected}
      >
        <div className="flex h-full items-center justify-center px-8 py-12">
          <div
            className="w-full max-w-[560px] space-y-4 rounded-[10px] p-6"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
            }}
          >
            <Step
              n={1}
              done={connected}
              title="Server is running"
              description="The devtools server is listening for events."
            />
            <Step
              n={2}
              done={false}
              title="Connect your app"
              code={`import { enableDevtools } from '@use-crux/core/observability'

enableDevtools({
  prompts: [...],
  serverUrl: window.location.origin,
})`}
            />
            <Step
              n={3}
              done={false}
              title="Trigger a run"
              description="Call any action that uses generate() to populate the Runs view."
            />
          </div>
        </div>
      </QwShell>
    </div>
  )
}

function Step({
  n,
  done,
  title,
  description,
  code,
}: {
  n: number
  done: boolean
  title: string
  description?: string
  code?: string
}) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-[11px] font-medium"
        style={{
          border: `1px solid ${done ? 'var(--qw-ok)' : 'var(--qw-border)'}`,
          background: done ? 'var(--qw-ok-soft)' : 'var(--qw-bg-muted)',
          color: done ? 'var(--qw-ok)' : 'var(--qw-fg-muted)',
        }}
      >
        {done ? 'OK' : n}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-medium" style={{ color: done ? 'var(--qw-fg-muted)' : 'var(--qw-fg)' }}>
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {description}
          </div>
        )}
        {code && (
          <div className="mt-2">
            <CodeBlock code={code} language="typescript" />
          </div>
        )}
      </div>
    </div>
  )
}
