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

import { lazy } from "react";
import { type NavState } from "@/app/navigation/useNavigation";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { DevtoolsSidebar } from "@/devtools/shell/DevtoolsSidebar";
import { CodeBlock } from "@/shared/components/ai-elements/code-block";

const OverviewPage = lazy(() =>
  import("@/pages/OverviewPage").then((m) => ({ default: m.OverviewPage })),
);
const InsightsPage = lazy(() =>
  import("@/pages/InsightsPage").then((m) => ({ default: m.InsightsPage })),
);
const RunsPage = lazy(() =>
  import("@/pages/RunsPage").then((m) => ({ default: m.RunsPage })),
);
const RuntimePage = lazy(() =>
  import("@/pages/RuntimePage").then((m) => ({ default: m.RuntimePage })),
);
const RunDetailPage = lazy(() =>
  import("@/pages/RunDetailPage").then((m) => ({ default: m.RunDetailPage })),
);
const BaselinesPage = lazy(() =>
  import("@/pages/BaselinesPage").then((m) => ({ default: m.BaselinesPage })),
);
const MemoryPage = lazy(() =>
  import("@/pages/MemoryPage").then((m) => ({ default: m.MemoryPage })),
);
const PlansPage = lazy(() =>
  import("@/pages/PlansPage").then((m) => ({ default: m.PlansPage })),
);
const WorkspacesPage = lazy(() =>
  import("@/pages/WorkspacesPage").then((m) => ({ default: m.WorkspacesPage })),
);
const IndexPage = lazy(() =>
  import("@/pages/IndexPage").then((m) => ({ default: m.IndexPage })),
);
const EvalsPage = lazy(() =>
  import("@/pages/EvalsPage").then((m) => ({ default: m.EvalsPage })),
);
const EvalRunsPage = lazy(() =>
  import("@/pages/EvalRunsPage").then((m) => ({ default: m.EvalRunsPage })),
);
const ReviewPage = lazy(() =>
  import("@/pages/ReviewPage").then((m) => ({ default: m.ReviewPage })),
);
const PromptPreviewPage = lazy(() =>
  import("@/pages/PromptPreviewPage").then((m) => ({
    default: m.PromptPreviewPage,
  })),
);
const PromptLatestRunPage = lazy(() =>
  import("@/pages/PromptLatestRunPage").then((m) => ({
    default: m.PromptLatestRunPage,
  })),
);

export function AppRouter({ nav }: { nav: NavState }) {
  switch (nav.view) {
    case "overview":
      return <OverviewPage />;
    case "insights":
      return (
        <InsightsPage
          filters={{
            severity: nav.severity,
            target: nav.target,
            status: nav.status,
            search: nav.search,
          }}
          groupBy={nav.groupBy ?? "none"}
        />
      );
    case "runs":
      return (
        <RunsPage
          groupBy={nav.groupBy ?? "none"}
          filters={{
            status: nav.status,
            target: nav.target,
            model: nav.model,
            last: nav.last,
            search: nav.search,
            definitionId: nav.definitionId,
          }}
        />
      );
    case "runtime":
      return <RuntimePage />;
    case "run-detail":
      return (
        <RunDetailPage
          traceId={nav.traceId}
          lens={nav.lens}
          spanId={nav.spanId}
          summary={nav.summary}
        />
      );
    case "evals":
      return <EvalsPage evalId={nav.evalId} />;
    case "eval-runs":
      return <EvalRunsPage runId={nav.runId} />;
    case "review":
      return <ReviewPage reviewId={nav.reviewId} />;
    case "baselines":
      return <BaselinesPage />;
    case "library-index":
      return (
        <IndexPage
          promptId={nav.promptId}
          contextId={nav.contextId}
          toolName={nav.toolName}
          tab={nav.tab}
        />
      );
    case "prompt-preview":
      return <PromptPreviewPage definitionId={nav.definitionId} />;
    case "prompt-latest-run":
      return <PromptLatestRunPage definitionId={nav.definitionId} />;
    case "library-memory":
      return <MemoryPage memoryId={nav.memoryId} />;
    case "library-workspaces":
      return (
        <WorkspacesPage workspaceId={nav.workspaceId} filePath={nav.filePath} />
      );
    case "library-plans":
      return <PlansPage planId={nav.planId} />;
  }
}

export function WaitingShell({ connected }: { connected: boolean }) {
  return (
    <div
      className="flex h-screen min-h-0 overflow-hidden"
      style={{
        background: "var(--devtools-bg)",
        color: "var(--devtools-fg)",
        fontFamily: "var(--devtools-sans)",
      }}
    >
      <DevtoolsSidebar />
      <DevtoolsShell
        breadcrumb="Overview"
        title="Waiting for connection"
        subtitle="Connect your app to start collecting traces"
      >
        <div className="flex h-full items-center justify-center px-8 py-12">
          <div
            className="w-full max-w-[560px] space-y-4 rounded-[10px] p-6"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
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
      </DevtoolsShell>
    </div>
  );
}

function Step({
  n,
  done,
  title,
  description,
  code,
}: {
  n: number;
  done: boolean;
  title: string;
  description?: string;
  code?: string;
}) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-[11px] font-medium"
        style={{
          border: `1px solid ${done ? "var(--devtools-ok)" : "var(--devtools-border)"}`,
          background: done
            ? "var(--devtools-ok-soft)"
            : "var(--devtools-bg-muted)",
          color: done ? "var(--devtools-ok)" : "var(--devtools-fg-muted)",
        }}
      >
        {done ? "OK" : n}
      </span>
      <div className="min-w-0">
        <div
          className="text-[13px] font-medium"
          style={{
            color: done ? "var(--devtools-fg-muted)" : "var(--devtools-fg)",
          }}
        >
          {title}
        </div>
        {description && (
          <div
            className="mt-0.5 text-[12px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
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
  );
}
