/**
 * Observability hooks backed by TanStack Query.
 *
 *   - useObservabilityRunsPage       → /api/observability/runs/page (the one joined,
 *                                       revisioned Runs list — Runs page + Global Search;
 *                                       see runs/hooks/useRuns.ts)
 *   - useObservabilityGraph(runId)   → /api/observability/runs/{runId}
 *   - useObservabilityResourceActivity(family) → /api/observability/resources/{family}
 *
 * Polling cadence is per-query and adapts to status:
 *   - the list polls every 1s while any row is non-terminal
 *   - a single run polls every 1s while it's running, then stops 60s
 *     after it goes terminal (gives stale snapshots a beat to settle)
 *
 * The WS layer in `useDevtools.ts` dispatches a `crux:observability-event`
 * CustomEvent on the window for every `observability.*` notification.
 * We still listen for it and invalidate the matching key so the realtime
 * push path stays sub-second even when the polling interval hasn't fired.
 * The revisioned `runs-page` slice is excluded from the blanket WS sweep and
 * owns its own revision-gated catch-up instead.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import type {
  CompositionType,
  ObservabilityResourceActivity,
  ObservabilityRunDetail,
  ObservabilityRunDetailNode,
  ObservabilityRunsPage,
  ObservabilityRunsPageOptions,
  ObservabilitySpanEventSummary,
} from "@/types";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import { orderRunDetailChildren } from "@/features/observability/lib/run-detail-order";
import { observabilityService } from "../services/observability";
import {
  observabilityEventIds,
  observabilityEventRevision,
} from "@/app/runtime/observabilityEvents";
import {
  catchUpActionFromDelta,
  decideOnObservabilityRevisionEvent,
} from "@/shared/lib/runs-revision";

interface ObservabilityGraphState {
  runDetail: ObservabilityRunDetail | null;
  spanTree: SpanNode | null;
  loading: boolean;
  error: Error | null;
}

function mapStatus(status: string): SpanNode["status"] {
  if (status === "ok" || status === "success" || status === "skipped")
    return "success";
  if (status === "error" || status === "cancelled") return "error";
  if (
    status === "stale" ||
    status === "incomplete" ||
    status === "warn" ||
    status === "warning"
  )
    return "stale";
  return "running";
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === "ok" ||
    status === "success" ||
    status === "error" ||
    status === "cancelled" ||
    status === "suspended" ||
    status === "incomplete"
  );
}

/** Bound detail polling once Local has authoritatively returned not-found. */
export function observabilityRunRefetchInterval(query: {
  state: {
    data?: ObservabilityRunDetail | null;
    dataUpdatedAt: number;
  };
}): number | false {
  if (query.state.data === null) return false;
  const status = query.state.data?.run?.status;
  if (!isTerminalStatus(status)) return 1_000;
  const elapsed = Date.now() - (query.state.dataUpdatedAt || 0);
  return elapsed < 60_000 ? 5_000 : false;
}

function timeMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compositionType(primitive: string): CompositionType | undefined {
  switch (primitive) {
    case "composition.pipeline":
    case "pipeline":
      return "pipeline";
    case "composition.parallel":
    case "parallel":
      return "parallel";
    case "composition.consensus":
    case "consensus":
      return "consensus";
    case "composition.swarm":
    case "swarm":
      return "swarm";
    default:
      return undefined;
  }
}

function optionalSeq(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const seq = (value as { seq?: unknown }).seq;
  return typeof seq === "number" ? seq : undefined;
}

function nodeKind(node: ObservabilityRunDetailNode): SpanNode["kind"] {
  switch (node.display?.kind) {
    case "run":
      return "trace";
    case "flow":
      return "flow";
    case "step":
      return "step";
    case "composition":
      return "composition";
    case "transition":
      return "handoff";
    default:
      return "trace";
  }
}

export function nodeFromRunDetail(
  node: ObservabilityRunDetailNode,
  depth: number = 0,
): SpanNode {
  const comp = compositionType(node.primitive);
  const seq = optionalSeq(node);
  // The model name belongs only to generation spans (shown as the model badge on
  // the generation row + in the generation card). Other span kinds — flow steps,
  // agents, compositions — must NOT carry a model.
  const isGeneration =
    node.primitive === "generation" ||
    (node.primitive?.startsWith("generation.") ?? false);
  const rawLabel =
    node.display?.label ||
    node.name ||
    node.primitive ||
    node.spanId ||
    node.id;
  // Guard against the backend overwriting a non-generation span's label with the
  // underlying generation's model (BACKEND-GAPS B11): fall back to the span's own
  // name so e.g. `plan-round-1` isn't rendered as `google/gemini…`.
  const label =
    !isGeneration && node.model && rawLabel === node.model
      ? node.name || node.primitive || rawLabel
      : rawLabel;
  return {
    id: node.id,
    seq,
    kind: nodeKind(node),
    primitive: node.primitive,
    compositionType: comp,
    label,
    status: mapStatus(node.status),
    durationMs: node.timing?.durationMs ?? node.durationMs,
    startedAt: timeMs(node.timing?.startedAt ?? node.startedAt),
    model: isGeneration ? node.model || undefined : undefined,
    children: orderRunDetailChildren(node.children).map((child) =>
      nodeFromRunDetail(child, depth + 1),
    ),
    depth,
    composition: comp
      ? {
          kind: comp,
          agentCount: node.children.length,
        }
      : undefined,
  };
}

/** Invalidate the run detail when a matching observability WS event fires. */
function useInvalidateOnObservabilityEvent(
  targetRunId: string | undefined,
  queryKey: readonly unknown[],
) {
  const client = useQueryClient();
  useEffect(() => {
    function onEvt(event: Event) {
      const ids = observabilityEventIds((event as CustomEvent<unknown>).detail);
      if (
        targetRunId == null ||
        ids.length === 0 ||
        ids.includes(targetRunId)
      ) {
        void client.invalidateQueries({ queryKey });
      }
    }
    window.addEventListener("crux:observability-event", onEvt);
    return () => window.removeEventListener("crux:observability-event", onEvt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, targetRunId, queryKey.join("|")]);
}

export function useObservabilityGraph(
  runId: string | undefined,
): ObservabilityGraphState {
  const key = qk.observability.run(runId);
  useInvalidateOnObservabilityEvent(runId, key);

  const q = useQuery<ObservabilityRunDetail | null, Error>({
    queryKey: key,
    queryFn: ({ signal }) => observabilityService.getRun(runId ?? "", signal),
    enabled: Boolean(runId),
    // While the run is still running, refetch every second. Once it
    // terminates we taper to one more refresh per 5s for 60s, then stop.
    refetchInterval: observabilityRunRefetchInterval,
  });

  const runDetail = q.data ?? null;
  const spanTree = useMemo(
    () => (runDetail ? nodeFromRunDetail(runDetail.root, 0) : null),
    [runDetail],
  );

  return {
    runDetail,
    spanTree,
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  };
}

export interface UseObservabilityRunsPageResult {
  page: ObservabilityRunsPage | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * The one joined, revisioned Runs list (binding spec 04 §3-4). Filters run
 * server-side; pagination and row presence are server-owned, so this is the
 * single canonical row source for the Runs feature — it must not be merged
 * client-side with a second, independently-filtered list.
 *
 * Push updates are revision-aware: a WS `ObservabilityEvent` carrying a
 * revision no newer than the last one this hook applied is ignored (avoids
 * refetch storms on redundant notifications). A newer revision triggers the
 * bounded `/runs/delta` catch-up; an `expired` delta (the client fell behind
 * the server's retained change log) forces a full invalidate/refetch instead
 * of trusting a partial delta.
 */
export function useObservabilityRunsPage(
  options: ObservabilityRunsPageOptions = {},
): UseObservabilityRunsPageResult {
  const stableOptions = useMemo(
    () => ({
      status:
        options.status && options.status.length > 0
          ? [...options.status].sort()
          : undefined,
      sessionId: options.sessionId || undefined,
      since: options.since,
      until: options.until,
      cursor: options.cursor,
      limit: options.limit,
      definitionId: options.definitionId || undefined,
    }),
    [
      options.status,
      options.sessionId,
      options.since,
      options.until,
      options.cursor,
      options.limit,
      options.definitionId,
    ],
  );
  const key = qk.observability.runsPage(stableOptions);
  const client = useQueryClient();
  const lastAppliedRevisionRef = useRef(0);

  const q = useQuery<ObservabilityRunsPage, Error>({
    queryKey: key,
    queryFn: ({ signal }) =>
      observabilityService.listRunsPage(stableOptions, signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.rows.some((r) => !isTerminalStatus(r.status))
        ? 1000
        : 5000;
    },
  });

  useEffect(() => {
    if (q.data)
      lastAppliedRevisionRef.current = Math.max(
        lastAppliedRevisionRef.current,
        q.data.revision,
      );
  }, [q.data]);

  useEffect(() => {
    function onEvt(event: Event) {
      const eventRevision = observabilityEventRevision(
        (event as CustomEvent<unknown>).detail,
      );
      const decision = decideOnObservabilityRevisionEvent(
        lastAppliedRevisionRef.current,
        eventRevision,
      );
      if (decision === "ignore") return;
      void observabilityService
        .listRunsDelta(lastAppliedRevisionRef.current)
        .then((delta) => {
          if (catchUpActionFromDelta(delta) === "invalidate") {
            void client.invalidateQueries({ queryKey: key });
          }
          lastAppliedRevisionRef.current = Math.max(
            lastAppliedRevisionRef.current,
            delta.revision,
          );
        });
    }
    window.addEventListener("crux:observability-event", onEvt);
    return () => window.removeEventListener("crux:observability-event", onEvt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, JSON.stringify(key)]);

  return {
    page: q.data,
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  };
}

export function useObservabilityResourceActivity(family: string): {
  activity: ObservabilityResourceActivity[];
  loading: boolean;
  error: Error | null;
} {
  const key = qk.observability.resource(family);
  useInvalidateOnObservabilityEvent(undefined, key);

  const q = useQuery<ObservabilityResourceActivity[], Error>({
    queryKey: key,
    queryFn: ({ signal }) =>
      observabilityService.getResourceActivity(family, signal),
    enabled: Boolean(family),
  });

  return {
    activity: q.data ?? [],
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  };
}

export function useObservabilitySpanEvents(
  runId: string | undefined,
  spanId: string | undefined,
  options: { name?: string; limit?: number } = {},
): {
  events: ObservabilitySpanEventSummary[];
  loading: boolean;
  error: Error | null;
} {
  const key = qk.observability.spanEvents(runId, spanId, options);
  useInvalidateOnObservabilityEvent(runId, key);

  const q = useQuery<ObservabilitySpanEventSummary[], Error>({
    queryKey: key,
    queryFn: ({ signal }) =>
      observabilityService.getSpanEvents(
        runId ?? "",
        spanId ?? "",
        { name: options.name, limit: options.limit },
        signal,
      ),
    enabled: Boolean(runId && spanId),
  });

  return {
    events: q.data ?? [],
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  };
}
