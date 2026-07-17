/**
 * POST helpers for mutation endpoints on /api/inspect/*.
 *
 * Backed by TanStack Query `useMutation`. Each hook exposes a callback
 * with the same signature it used to so screens didn't have to change.
 * Internally:
 *
 *   - `onSettled` invalidates the matching `qk.inspect.*` prefix so
 *     cached reads (runs, insights, and silences) refetch
 *     without callers wiring `.reload()` chains.
 *   - Toasts report successful writes and actionable failures.
 *
 * If you need optimistic UI (e.g. hiding a dismissed insight before
 * the round-trip lands), use `mutation.mutate(input, { onMutate })` —
 * the underlying mutation supports the full `useMutation` lifecycle.
 * See `packages/devtools/CLAUDE.md` for the canonical recipe.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { qk } from "@/shared/query/queryClient";
import { deleteJson, expectOk } from "@/shared/services/http";
import { useToast } from "@/qw/shell/useToast";
import type { InspectRunRecord } from "@/types";

interface MutationResult {
  ok: boolean;
}

// ─── Insight status ─────────────────────────────────────────────────

/** Delete one or more Inspect runs while preserving rollback cache entries. */
export function useDeleteRunsMutation() {
  const client = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation<
    MutationResult,
    Error,
    { traceIds: readonly string[] },
    { prevByKey: Map<readonly unknown[], readonly InspectRunRecord[]> }
  >({
    mutationFn: async ({ traceIds }) => {
      if (traceIds.length === 0) return { ok: true };
      // Single id → single-resource DELETE; many → bulk DELETE.
      if (traceIds.length === 1) {
        const r = await deleteJson(
          `/api/inspect/runs/${encodeURIComponent(traceIds[0])}`,
        );
        await expectOk(r, `Delete run ${traceIds[0]}`);
      } else {
        const r = await deleteJson("/api/inspect/runs", { traceIds });
        await expectOk(r, `Delete ${traceIds.length} runs`);
      }
      return { ok: true };
    },
    // Optimistic: snip the deleted rows out of every cached runs query
    // (the screen passes various filter options, each one a separate
    // cache entry). Snapshot all of them so we can roll back on failure.
    onMutate: async ({ traceIds }) => {
      const ids = new Set(traceIds);
      await client.cancelQueries({ queryKey: qk.inspect.all });
      const prevByKey = new Map<
        readonly unknown[],
        readonly InspectRunRecord[]
      >();
      const all = client.getQueriesData<readonly InspectRunRecord[]>({
        queryKey: ["inspect", "runs"],
      });
      for (const [key, data] of all) {
        if (!data) continue;
        prevByKey.set(key, data);
        client.setQueryData<readonly InspectRunRecord[]>(
          key,
          data.filter((r) => !ids.has(r.traceId)),
        );
      }
      return { prevByKey };
    },
    onError: (err, { traceIds }, ctx) => {
      // Roll back optimistic deletions
      if (ctx?.prevByKey) {
        for (const [key, prev] of ctx.prevByKey) {
          client.setQueryData(key, prev);
        }
      }
      toast({
        kind: "danger",
        title:
          traceIds.length === 1
            ? "Could not delete run"
            : `Could not delete ${traceIds.length} runs`,
        message: err.message,
      });
    },
    onSuccess: (_data, { traceIds }) => {
      toast({
        kind: "ok",
        title:
          traceIds.length === 1
            ? "Run deleted"
            : `${traceIds.length} runs deleted`,
      });
    },
    onSettled: () => {
      // Invalidate the whole quality prefix — overview counts, insights
      // referencing the deleted run, etc. all need to refetch.
      void client.invalidateQueries({ queryKey: qk.inspect.all });
      void client.invalidateQueries({ queryKey: ["observability"] });
    },
  });
  return useCallback(
    async (traceIds: readonly string[]) => {
      try {
        return await mutation.mutateAsync({ traceIds });
      } catch {
        return { ok: false };
      }
    },
    [mutation],
  );
}
