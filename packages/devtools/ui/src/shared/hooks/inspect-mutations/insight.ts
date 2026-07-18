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
import { expectOk, postJson } from "@/shared/services/http";
import { useToast } from "@/devtools/shell/useToast";
import type { InspectInsightRecord } from "@/types";

interface MutationResult {
  ok: boolean;
}

// ─── Insight status ─────────────────────────────────────────────────

/** Update the review status of an Inspect insight with optimistic cache state. */
export function useInsightMutation() {
  const client = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation<
    MutationResult,
    Error,
    {
      insightId: string;
      status: "open" | "dismissed" | "resolved";
      note?: string;
    },
    { prev: readonly InspectInsightRecord[] | undefined }
  >({
    mutationFn: async ({ insightId, status, note }) => {
      const r = await postJson(
        `/api/inspect/insights/${encodeURIComponent(insightId)}/status`,
        {
          status,
          note,
        },
      );
      await expectOk(r, `Insight ${insightId}`);
      return { ok: true };
    },
    // Optimistic: flip the status on the matching record so the UI
    // reflects the change immediately. Rolled back in onError if the
    // server rejects, then refetched in onSettled either way.
    onMutate: async ({ insightId, status }) => {
      await client.cancelQueries({ queryKey: qk.inspect.insights() });
      const prev = client.getQueryData<readonly InspectInsightRecord[]>(
        qk.inspect.insights(),
      );
      if (prev) {
        client.setQueryData<readonly InspectInsightRecord[]>(
          qk.inspect.insights(),
          prev.map((i) => (i.insightId === insightId ? { ...i, status } : i)),
        );
      }
      return { prev };
    },
    onSuccess: (_data, { status }) => {
      toast({
        kind: "ok",
        title:
          status === "dismissed"
            ? "Insight dismissed"
            : status === "resolved"
              ? "Insight resolved"
              : "Insight reopened",
      });
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) client.setQueryData(qk.inspect.insights(), ctx.prev);
      toast({
        kind: "danger",
        title: "Could not update insight",
        message: err.message,
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.inspect.insights() });
    },
  });
  return useCallback(
    async (
      insightId: string,
      status: "open" | "dismissed" | "resolved",
      note?: string,
    ) => {
      try {
        return await mutation.mutateAsync({ insightId, status, note });
      } catch {
        return { ok: false };
      }
    },
    [mutation],
  );
}

// ─── Insight pattern silences ───────────────────────────────────────
//
// Silencing is a separate persistence from per-insightId status. A
// silence matches by `{ title, targetId? }`; the backend filters matching
// insights out of the read model before they reach the UI. Soft-delete
// restores the insight on the next read.
//
// We invalidate the broader `qk.inspect.all` prefix on success so both
// the insights list and the silences list refetch — a new silence
// removes insights from the open feed, and a deleted silence brings
// them back.
