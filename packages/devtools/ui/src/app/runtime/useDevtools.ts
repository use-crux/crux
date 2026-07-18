/**
 * Devtools data hook — wires the WebSocket connection into the
 * Zustand runtime store and into the TanStack Query cache.
 *
 * Two responsibilities only:
 *  - WebSocket lifecycle (via `useDevtoolsConnection`).
 *  - For each incoming message:
 *      · dispatch into the runtime store (`dispatchRuntime`) for
 *        push-only WS state (event arrays, runtime flow diffs);
 *      · invalidate or set the matching TanStack Query cache for
 *        REST-shaped slices (index, observability, Evals).
 *
 * Screens **do not** call this hook for data. They subscribe to a
 * specific slice via the selector hooks in `runtimeStore.ts` (e.g.
 * `useJudgeEvents`, `useConnected`) so they only re-render when
 * their slice changes.
 *
 * @module
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dispatchRuntime, useRetryAttempt } from "./runtimeStore";
import type { DevtoolsAction } from "./devtoolsReducer";
import type { WsEvent, RuntimeFlowRun, ProjectIndexData } from "@/types";
import { useDevtoolsConnection } from "./useDevtoolsConnection";
import { qk } from "@/shared/query/queryClient";
import {
  isBlanketInvalidatableObservabilityQueryKey,
  observabilityEventIds,
} from "./observabilityEvents";
import {
  applyIndexDelta,
  normalizeProjectIndexData,
  type IndexDeltaMessage,
} from "./indexDelta";

export type { DevtoolsState } from "./devtoolsReducer";

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/ui`;
}

function getApiUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

/**
 * Bootstraps the devtools WebSocket connection + Query invalidation.
 *
 * Mount once at the app root. Returns nothing — screens read state
 * from the runtime store selector hooks (`useConnected`,
 * `useJudgeEvents`, etc.) and from TanStack Query hooks.
 */
export function useDevtools(): void {
  const queryClient = useQueryClient();
  const retryAttempt = useRetryAttempt();
  const indexDeltaGenerationRef = useRef(0);

  useDevtoolsConnection({
    url: getWsUrl(),
    retrySignal: retryAttempt,
    onMessage: (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as WsEvent;
        const type = (msg as { type?: string }).type;
        if (type === "observability:event") {
          const ids = observabilityEventIds(msg);
          window.dispatchEvent(
            new CustomEvent("crux:observability-event", {
              detail: (msg as { event?: unknown }).event,
            }),
          );
          // Any observability mutation invalidates detail/resource
          // observability views (run detail, span events, resource activity,
          // definition activity) — but NOT the revisioned `runs-page` slice,
          // which owns its own revision-gated invalidation and bounded
          // catch-up (`useObservabilityRunsPage`); see
          // `isBlanketInvalidatableObservabilityQueryKey`. Also invalidate
          // matching Run Detail projections refresh with the graph.
          void queryClient.invalidateQueries({
            predicate: (query) =>
              isBlanketInvalidatableObservabilityQueryKey(query.queryKey),
          });
          for (const id of ids) {
            void queryClient.invalidateQueries({
              queryKey: qk.observability.run(id),
            });
            void queryClient.invalidateQueries({
              queryKey: qk.inspect.run(id),
            });
          }
        }
        // Index WS event carries the full new index payload — push
        // it straight into the Query cache so consumers re-render
        // without a network round-trip.
        if (type === "index") {
          const cat = msg as Partial<ProjectIndexData>;
          indexDeltaGenerationRef.current = 0;
          queryClient.setQueryData(qk.index(), normalizeProjectIndexData(cat));
          void queryClient.invalidateQueries({ queryKey: qk.indexWatch() });
          void queryClient.invalidateQueries({ queryKey: qk.evals.all });
        }
        if (type === "index:delta") {
          const delta = msg as unknown as IndexDeltaMessage;
          if (delta.generation < indexDeltaGenerationRef.current) return;
          indexDeltaGenerationRef.current = delta.generation;
          queryClient.setQueryData<ProjectIndexData | undefined>(
            qk.index(),
            (current) => applyIndexDelta(current, delta),
          );
          void queryClient.invalidateQueries({ queryKey: qk.indexWatch() });
        }
        // Inspect emits `{ _tag: 'InspectEvent', kind, refId, ... }`.
        // We re-invalidate the matching query cache prefix so the cached
        // REST reads (overview, runs, insights, etc.) refetch.
        if (
          type === "runtime_bridge.capabilities_changed" ||
          type === "resource_inspection.changed"
        ) {
          // Memory detail's `inspection` field is server-joined at read
          // time, so a refetch is the only way to re-evaluate against the
          // new bridge state. Prefix-invalidate so any open memory list /
          // detail Query refetches; React Query dedupes the network calls.
          void queryClient.invalidateQueries({ queryKey: qk.memory.all });
        }
        const tag = (msg as { _tag?: string })._tag;
        if (tag === "InspectEvent") {
          void queryClient.invalidateQueries({ queryKey: qk.inspect.all });
        } else if (tag === "MemoryStoreEvent") {
          // Library v2: memory store changed. Prefix-invalidate so both
          // the stores list and per-store detail refetch.
          void queryClient.invalidateQueries({ queryKey: qk.memory.all });
        } else if (tag === "WorkspaceEvent") {
          void queryClient.invalidateQueries({ queryKey: qk.workspaces.all });
        } else if (tag === "PlanEvent") {
          void queryClient.invalidateQueries({ queryKey: qk.plans.all });
        }
        dispatchRuntime(msg as DevtoolsAction);
      } catch {
        // Ignore malformed messages
      }
    },
    onConnected: () => {
      dispatchRuntime({ type: "SET_CONNECTED", connected: true });

      // Index is fetched by the `useIndex` Query hook on mount and
      // refreshed by the `index` WS event handler above (via
      // `queryClient.setQueryData`) — no on-connect fan-out needed.
      // On reconnect after a backend restart the index may have
      // changed, so we invalidate to force a refetch.
      void queryClient.invalidateQueries({ queryKey: qk.index() });

      // Runtime flow runs: REST snapshot on connect, then WS push events
      // (runtime-flow:*) apply diffs through the reducer. There is no
      // REST endpoint that returns the same composed view that the
      // WS stream produces, so this stays out of Query.
      fetch(getApiUrl("/api/runtime-flows"))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
        .then((runs: RuntimeFlowRun[]) =>
          dispatchRuntime({ type: "SET_RUNTIME_FLOWS", runtimeFlowRuns: runs }),
        );
    },
    onDisconnected: () => {
      dispatchRuntime({ type: "SET_CONNECTED", connected: false });
    },
  });
  // Suppress unused warning if React strict mode double-mounts.
  useEffect(() => {}, []);
}
