/**
 * Shared TanStack Query client for the devtools UI.
 *
 * One instance, mounted at the app root. We deliberately bias defaults
 * for a *local* observability UI:
 *
 *   - staleTime: 0          — every mount can refetch; for cheap local
 *                             REST that's the right default (data moves
 *                             constantly while users iterate).
 *   - gcTime:    5 minutes  — keep prior runs warm while the user is
 *                             clicking around.
 *   - retry:     1          — one retry on transient network failure
 *                             (local server restarts during dev).
 *   - refetchOnWindowFocus  — true; the user often Alt-Tabs back to
 *                             check if a run finished.
 *
 * WebSocket-driven invalidation lives in `useDevtools.ts`: when a
 * `quality:*` event arrives we call `queryClient.invalidateQueries`
 * with the matching key prefix. Query owns the read cache; the WS
 * reducer keeps owning push-only runtime state (judge events, runtime
 * flow steps, in-flight tool events).
 */

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
})

/** Top-level query key namespaces. Used both by hooks + WS invalidator. */
export const qk = {
  index: () => ['index'] as const,
  indexWatch: () => ['index', 'watch'] as const,
  quality: {
    all: ['quality'] as const,
    overview: (window?: string) => ['quality', 'overview', ...(window ? [window] : [])] as const,
    runs: (opts?: unknown) => ['quality', 'runs', opts ?? null] as const,
    run: (traceId: string | null | undefined) => ['quality', 'run', traceId] as const,
    insights: () => ['quality', 'insights'] as const,
    insightSilences: (opts?: { includeDeleted?: boolean }) =>
      ['quality', 'insights', 'silences', opts ?? null] as const,
    scorers: () => ['quality', 'scorers'] as const,
    experiments: (opts?: unknown) => ['quality', 'experiments', opts ?? null] as const,
    evaluationExperimentGroups: (limit?: number) =>
      ['quality', 'evaluation-experiment-groups', limit ?? null] as const,
    evaluationExperiments: (evaluationId: string | null | undefined, limit?: number) =>
      ['quality', 'evaluation-experiments', evaluationId, limit ?? null] as const,
    experiment: (experimentId: string | null | undefined) =>
      ['quality', 'experiment', experimentId] as const,
    cellEvidence: (
      experimentId: string | null | undefined,
      cell: { caseId: string; variantName: string; trial: number } | null | undefined,
    ) => ['quality', 'cell-evidence', experimentId, cell ?? null] as const,
    evaluationProgress: (evaluationId: string | null | undefined, limit?: number) =>
      ['quality', 'evaluation-progress', evaluationId, limit ?? null] as const,
    judgeReport: (evaluationId: string | null | undefined) =>
      ['quality', 'judge-report', evaluationId] as const,
    experimentDiff: (a: string | null | undefined, b: string | null | undefined) =>
      ['quality', 'experiment-diff', a, b] as const,
    baselines: () => ['quality', 'baselines'] as const,
    baseline: (evaluationId: string | null | undefined) =>
      ['quality', 'baseline', evaluationId] as const,
    evaluations: () => ['quality', 'evaluations'] as const,
    feedback: () => ['quality', 'feedback'] as const,
    feedbackAnnotations: () => ['quality', 'feedback', 'annotations'] as const,
    feedbackMemoryProposals: () => ['quality', 'feedback', 'memory-proposals'] as const,
    cassettes: () => ['quality', 'cassettes'] as const,
  },
  observability: {
    all: ['observability'] as const,
    runs: () => ['observability', 'runs'] as const,
    runsPage: (options: Record<string, unknown> | null) => ['observability', 'runs-page', options] as const,
    run: (runId: string | null | undefined) => ['observability', 'run', runId] as const,
    spanEvents: (
      runId: string | null | undefined,
      spanId: string | null | undefined,
      options?: { name?: string; limit?: number },
    ) => ['observability', 'span-events', runId, spanId, options ?? null] as const,
    resource: (family: string) => ['observability', 'resource', family] as const,
  },
  runtime: {
    all: ['runtime'] as const,
    status: () => ['runtime', 'status'] as const,
    work: (workId: string | null | undefined) => ['runtime', 'work', workId] as const,
  },
  memory: {
    all: ['memory'] as const,
    stores: () => ['memory', 'stores'] as const,
    store: (storeId: string | null | undefined) => ['memory', 'store', storeId] as const,
    operations: (since?: number, until?: number, limit?: number) =>
      ['memory', 'operations', since, until, limit] as const,
  },
  workspaces: {
    all: ['workspaces'] as const,
    list: () => ['workspaces', 'list'] as const,
    workspace: (id: string | null | undefined) => ['workspaces', 'workspace', id] as const,
    file: (id: string | null | undefined, path: string | null | undefined) =>
      ['workspaces', 'file', id, path] as const,
  },
  plans: {
    all: ['plans'] as const,
    list: () => ['plans', 'list'] as const,
    plan: (id: string | null | undefined) => ['plans', 'plan', id] as const,
  },
} as const
