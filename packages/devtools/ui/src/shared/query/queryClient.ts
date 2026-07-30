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
 * WebSocket-driven invalidation lives in `useDevtools.ts`. Eval file-backed
 * read models additionally use bounded polling because filesystem changes do
 * not have a durable push event yet.
 */

import { QueryClient } from "@tanstack/react-query";

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
});

/** Top-level query key namespaces. Used both by hooks + WS invalidator. */
export const qk = {
  index: () => ["index"] as const,
  indexWatch: () => ["index", "watch"] as const,
  inspect: {
    all: ["inspect"] as const,
    overview: (window?: string) =>
      ["inspect", "overview", ...(window ? [window] : [])] as const,
    runs: (opts?: unknown) => ["inspect", "runs", opts ?? null] as const,
    run: (traceId: string | null | undefined) =>
      ["inspect", "run", traceId] as const,
    insights: () => ["inspect", "insights"] as const,
    insightSilences: (opts?: { includeDeleted?: boolean }) =>
      ["inspect", "insights", "silences", opts ?? null] as const,
  },
  observability: {
    all: ["observability"] as const,
    runsPage: (options: Record<string, unknown> | null) =>
      ["observability", "runs-page", options] as const,
    run: (runId: string | null | undefined) =>
      ["observability", "run", runId] as const,
    spanEvents: (
      runId: string | null | undefined,
      spanId: string | null | undefined,
      options?: { name?: string; limit?: number },
    ) =>
      ["observability", "span-events", runId, spanId, options ?? null] as const,
    resource: (family: string) =>
      ["observability", "resource", family] as const,
    definitionActivity: (definitionId: string | null | undefined) =>
      ["observability", "definition-activity", definitionId] as const,
    evidence: (subject: unknown, role: string) =>
      ["observability", "evidence", subject, role] as const,
    relatedEvidence: (subjects: readonly unknown[]) =>
      ["observability", "evidence-related", subjects] as const,
    evidenceNavigation: (refs: readonly unknown[]) =>
      ["observability", "evidence-navigation", refs] as const,
  },
  runtime: {
    all: ["runtime"] as const,
    status: () => ["runtime", "status"] as const,
    work: (workId: string | null | undefined) =>
      ["runtime", "work", workId] as const,
  },
  evals: {
    all: ["evals"] as const,
    catalog: () => ["evals", "catalog"] as const,
    runs: () => ["evals", "runs"] as const,
    run: (runId?: string) => ["evals", "run", runId ?? null] as const,
    localRunAvailability: (runIds: readonly string[]) =>
      ["evals", "local-run-availability", runIds] as const,
    baselines: () => ["evals", "baselines"] as const,
    reviews: () => ["evals", "reviews"] as const,
    review: (reviewId?: string) =>
      ["evals", "review", reviewId ?? null] as const,
  },
  memory: {
    all: ["memory"] as const,
    stores: () => ["memory", "stores"] as const,
    store: (storeId: string | null | undefined) =>
      ["memory", "store", storeId] as const,
    operations: (since?: number, until?: number, limit?: number) =>
      ["memory", "operations", since, until, limit] as const,
  },
  workspaces: {
    all: ["workspaces"] as const,
    list: () => ["workspaces", "list"] as const,
    workspace: (id: string | null | undefined) =>
      ["workspaces", "workspace", id] as const,
    file: (id: string | null | undefined, path: string | null | undefined) =>
      ["workspaces", "file", id, path] as const,
  },
  plans: {
    all: ["plans"] as const,
    list: () => ["plans", "list"] as const,
    plan: (id: string | null | undefined) => ["plans", "plan", id] as const,
  },
} as const;
