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
import { deleteJson, postJson } from "@/shared/services/http";
import { useToast } from "@/devtools/shell/useToast";
import type { InspectInsightSilence } from "@/types";

interface MutationResult {
  ok: boolean;
}

// ─── Insight status ─────────────────────────────────────────────────

interface SilenceCreateInput {
  insightId?: string;
  pattern?: { title: string; targetId?: string };
  note?: string;
}

/** Create an Inspect silence from an insight or an explicit match pattern. */
export function useSilenceMutation() {
  const client = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation<
    InspectInsightSilence,
    Error,
    SilenceCreateInput
  >({
    mutationFn: async (input) => {
      const r = await postJson("/api/inspect/insights/silences", input);
      if (!r.ok) throw new Error(`HTTP ${r.status} · create silence`);
      return (await r.json()) as InspectInsightSilence;
    },
    onSuccess: (record) => {
      toast({
        kind: "ok",
        title: "Pattern silenced",
        message: `Hiding insights matching "${record.pattern.title}"${
          record.pattern.targetId ? ` on ${record.pattern.targetId}` : ""
        }.`,
      });
    },
    onError: (err) => {
      toast({
        kind: "danger",
        title: "Could not silence pattern",
        message: err.message,
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.inspect.all });
    },
  });
  return useCallback(
    async (input: SilenceCreateInput) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return undefined;
      }
    },
    [mutation],
  );
}

/** Delete an Inspect silence and refresh affected insight projections. */
export function useUnsilenceMutation() {
  const client = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation<{ ok: boolean }, Error, { silenceId: string }>({
    mutationFn: async ({ silenceId }) => {
      const r = await deleteJson(
        `/api/inspect/insights/silences/${encodeURIComponent(silenceId)}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status} · delete silence`);
      return { ok: true };
    },
    onSuccess: () => {
      toast({
        kind: "ok",
        title: "Pattern unsilenced",
        message: "Matching insights are now visible again.",
      });
    },
    onError: (err) => {
      toast({
        kind: "danger",
        title: "Could not unsilence pattern",
        message: err.message,
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.inspect.all });
    },
  });
  return useCallback(
    async (silenceId: string) => {
      try {
        return await mutation.mutateAsync({ silenceId });
      } catch {
        return { ok: false };
      }
    },
    [mutation],
  );
}

// ─── Bulk delete runs ───────────────────────────────────────────────
//
// Backend: DELETE /api/inspect/runs with { traceIds: string[] }. The Go
// service deletes canonical observability rows (runs/spans/events/artifacts/
// edges) and emits InspectEvent { kind: 'run', action: 'deleted' } over WS.
