/**
 * POST helpers for mutation endpoints on /api/quality/*.
 *
 * Backed by TanStack Query `useMutation`. Each hook exposes a callback
 * with the same signature it used to so screens didn't have to change.
 * Internally:
 *
 *   - `onSettled` invalidates the matching `qk.quality.*` prefix so
 *     cached reads (insights list, feedback list, etc.) refetch
 *     without callers wiring `.reload()` chains.
 *   - Toasts fire on success/error — same UX as the old implementation.
 *
 * If you need optimistic UI (e.g. hiding a dismissed insight before
 * the round-trip lands), use `mutation.mutate(input, { onMutate })` —
 * the underlying mutation supports the full `useMutation` lifecycle.
 * See `packages/devtools/CLAUDE.md` for the canonical recipe.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { qk } from '@/shared/query/queryClient'
import { deleteJson, expectOk, postJson } from '@/shared/services/http'
import { useToast } from '@/qw/shell/useToast'
import type {
  QualityFeedbackRecord,
  QualityInsightRecord,
  QualityInsightSilence,
  QualityRunRecord,
} from '@/types'

interface MutationResult {
  ok: boolean
}

// ─── Insight status ─────────────────────────────────────────────────

export function useInsightMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<
    MutationResult,
    Error,
    { insightId: string; status: 'open' | 'dismissed' | 'resolved'; note?: string },
    { prev: readonly QualityInsightRecord[] | undefined }
  >({
    mutationFn: async ({ insightId, status, note }) => {
      const r = await postJson(`/api/quality/insights/${encodeURIComponent(insightId)}/status`, {
        status,
        note,
      })
      await expectOk(r, `Insight ${insightId}`)
      return { ok: true }
    },
    // Optimistic: flip the status on the matching record so the UI
    // reflects the change immediately. Rolled back in onError if the
    // server rejects, then refetched in onSettled either way.
    onMutate: async ({ insightId, status }) => {
      await client.cancelQueries({ queryKey: qk.quality.insights() })
      const prev = client.getQueryData<readonly QualityInsightRecord[]>(qk.quality.insights())
      if (prev) {
        client.setQueryData<readonly QualityInsightRecord[]>(
          qk.quality.insights(),
          prev.map((i) => (i.insightId === insightId ? { ...i, status } : i)),
        )
      }
      return { prev }
    },
    onSuccess: (_data, { status }) => {
      toast({
        kind: 'ok',
        title:
          status === 'dismissed'
            ? 'Insight dismissed'
            : status === 'resolved'
              ? 'Insight resolved'
              : 'Insight reopened',
      })
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) client.setQueryData(qk.quality.insights(), ctx.prev)
      toast({ kind: 'danger', title: 'Could not update insight', message: err.message })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.quality.insights() })
    },
  })
  return useCallback(
    async (insightId: string, status: 'open' | 'dismissed' | 'resolved', note?: string) => {
      try {
        return await mutation.mutateAsync({ insightId, status, note })
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}

// ─── Insight pattern silences ───────────────────────────────────────
//
// Silencing is a separate persistence from per-insightId status. A
// silence matches by `{ title, targetId? }`; the backend filters matching
// insights out of the read model before they reach the UI. Soft-delete
// restores the insight on the next read.
//
// We invalidate the broader `qk.quality.all` prefix on success so both
// the insights list and the silences list refetch — a new silence
// removes insights from the open feed, and a deleted silence brings
// them back.

interface SilenceCreateInput {
  insightId?: string
  pattern?: { title: string; targetId?: string }
  note?: string
}

export function useSilenceMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<QualityInsightSilence, Error, SilenceCreateInput>({
    mutationFn: async (input) => {
      const r = await postJson('/api/quality/insights/silences', input)
      if (!r.ok) throw new Error(`HTTP ${r.status} · create silence`)
      return (await r.json()) as QualityInsightSilence
    },
    onSuccess: (record) => {
      toast({
        kind: 'ok',
        title: 'Pattern silenced',
        message: `Hiding insights matching "${record.pattern.title}"${
          record.pattern.targetId ? ` on ${record.pattern.targetId}` : ''
        }.`,
      })
    },
    onError: (err) => {
      toast({ kind: 'danger', title: 'Could not silence pattern', message: err.message })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.quality.all })
    },
  })
  return useCallback(
    async (input: SilenceCreateInput) => {
      try {
        return await mutation.mutateAsync(input)
      } catch {
        return undefined
      }
    },
    [mutation],
  )
}

export function useUnsilenceMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<{ ok: boolean }, Error, { silenceId: string }>({
    mutationFn: async ({ silenceId }) => {
      const r = await deleteJson(`/api/quality/insights/silences/${encodeURIComponent(silenceId)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status} · delete silence`)
      return { ok: true }
    },
    onSuccess: () => {
      toast({ kind: 'ok', title: 'Pattern unsilenced', message: 'Matching insights are now visible again.' })
    },
    onError: (err) => {
      toast({ kind: 'danger', title: 'Could not unsilence pattern', message: err.message })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.quality.all })
    },
  })
  return useCallback(
    async (silenceId: string) => {
      try {
        return await mutation.mutateAsync({ silenceId })
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}

// ─── Bulk delete runs ───────────────────────────────────────────────
//
// Backend: DELETE /api/quality/runs with { traceIds: string[] }. The Go
// service deletes canonical observability rows (runs/spans/events/artifacts/
// edges) and emits QualityEvent { kind: 'run', action: 'deleted' } over WS.

export function useDeleteRunsMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<
    MutationResult,
    Error,
    { traceIds: readonly string[] },
    { prevByKey: Map<readonly unknown[], readonly QualityRunRecord[]> }
  >({
    mutationFn: async ({ traceIds }) => {
      if (traceIds.length === 0) return { ok: true }
      // Single id → single-resource DELETE; many → bulk DELETE.
      if (traceIds.length === 1) {
        const r = await deleteJson(`/api/quality/runs/${encodeURIComponent(traceIds[0])}`)
        await expectOk(r, `Delete run ${traceIds[0]}`)
      } else {
        const r = await deleteJson('/api/quality/runs', { traceIds })
        await expectOk(r, `Delete ${traceIds.length} runs`)
      }
      return { ok: true }
    },
    // Optimistic: snip the deleted rows out of every cached runs query
    // (the screen passes various filter options, each one a separate
    // cache entry). Snapshot all of them so we can roll back on failure.
    onMutate: async ({ traceIds }) => {
      const ids = new Set(traceIds)
      await client.cancelQueries({ queryKey: qk.quality.all })
      const prevByKey = new Map<readonly unknown[], readonly QualityRunRecord[]>()
      const all = client.getQueriesData<readonly QualityRunRecord[]>({
        queryKey: ['quality', 'runs'],
      })
      for (const [key, data] of all) {
        if (!data) continue
        prevByKey.set(key, data)
        client.setQueryData<readonly QualityRunRecord[]>(
          key,
          data.filter((r) => !ids.has(r.traceId)),
        )
      }
      return { prevByKey }
    },
    onError: (err, { traceIds }, ctx) => {
      // Roll back optimistic deletions
      if (ctx?.prevByKey) {
        for (const [key, prev] of ctx.prevByKey) {
          client.setQueryData(key, prev)
        }
      }
      toast({
        kind: 'danger',
        title: traceIds.length === 1 ? 'Could not delete run' : `Could not delete ${traceIds.length} runs`,
        message: err.message,
      })
    },
    onSuccess: (_data, { traceIds }) => {
      toast({
        kind: 'ok',
        title: traceIds.length === 1 ? 'Run deleted' : `${traceIds.length} runs deleted`,
      })
    },
    onSettled: () => {
      // Invalidate the whole quality prefix — overview counts, insights
      // referencing the deleted run, etc. all need to refetch.
      void client.invalidateQueries({ queryKey: qk.quality.all })
      void client.invalidateQueries({ queryKey: ['observability'] })
    },
  })
  return useCallback(
    async (traceIds: readonly string[]) => {
      try {
        return await mutation.mutateAsync({ traceIds })
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}

// ─── Feedback status ────────────────────────────────────────────────

export function useFeedbackMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<
    MutationResult,
    Error,
    { feedbackId: string; status: 'new' | 'reviewed' | 'dismissed'; note?: string },
    { prev: readonly QualityFeedbackRecord[] | undefined }
  >({
    mutationFn: async ({ feedbackId, status, note }) => {
      const r = await postJson(`/api/quality/feedback/${encodeURIComponent(feedbackId)}/status`, {
        status,
        note,
      })
      await expectOk(r, `Feedback ${feedbackId}`)
      return { ok: true }
    },
    // Optimistic — same shape as insight status. The Feedback screen
    // already does a separate `hidden` ID set for instant disappearance
    // from the active tab; this optimistic write keeps the cached record
    // status in sync so other consumers (digest counters, run-detail
    // feedback tab) reflect it immediately too.
    onMutate: async ({ feedbackId, status }) => {
      await client.cancelQueries({ queryKey: qk.quality.feedback() })
      const prev = client.getQueryData<readonly QualityFeedbackRecord[]>(qk.quality.feedback())
      if (prev) {
        client.setQueryData<readonly QualityFeedbackRecord[]>(
          qk.quality.feedback(),
          prev.map((f) => (f.id === feedbackId ? { ...f, status } : f)),
        )
      }
      return { prev }
    },
    onSuccess: (_data, { status }) => {
      toast({
        kind: 'ok',
        title:
          status === 'dismissed'
            ? 'Feedback dismissed'
            : status === 'reviewed'
              ? 'Feedback marked reviewed'
              : 'Feedback reopened',
      })
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) client.setQueryData(qk.quality.feedback(), ctx.prev)
      toast({ kind: 'danger', title: 'Could not update feedback', message: err.message })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.quality.feedback() })
    },
  })
  return useCallback(
    async (feedbackId: string, status: 'new' | 'reviewed' | 'dismissed', note?: string) => {
      try {
        return await mutation.mutateAsync({ feedbackId, status, note })
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}

// ─── Cassette issue ─────────────────────────────────────────────────

interface CassetteIssueInput {
  path: string
  status: 'missing' | 'mismatch' | 'recorded' | 'error'
  reason?: string
  entryId?: string
  caseId?: string
  kind?: string
  targetId?: string
  provider?: string
  model?: string
}

export function useCassetteIssueMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<MutationResult, Error, CassetteIssueInput>({
    mutationFn: async (issue) => {
      const r = await postJson('/api/quality/legacy/cassettes/issues', issue)
      await expectOk(r, `Cassette ${issue.path}`)
      return { ok: true }
    },
    onSuccess: (_data, issue) => {
      toast({ kind: 'ok', title: 'Cassette issue logged', message: issue.path })
    },
    onError: (err) => {
      toast({ kind: 'danger', title: 'Could not log cassette issue', message: err.message })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.quality.cassettes() })
    },
  })
  return useCallback(
    async (issue: CassetteIssueInput) => {
      try {
        return await mutation.mutateAsync(issue)
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}

// ─── Promote baseline ───────────────────────────────────────────────

interface PromoteBaselineInput {
  experimentId: string
  variantId?: string
  label?: string
  note?: string
}

export function usePromoteBaselineMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<MutationResult, Error, PromoteBaselineInput>({
    mutationFn: async (input) => {
      // Legacy promote endpoint (quarantined): the spec-02 system promotes
      // via `crux quality promote`; a server-side promote on the new
      // contracts is a redesign follow-up (see the quality handover doc).
      const r = await postJson('/api/quality/legacy/baselines', input)
      await expectOk(r, `Baseline ${input.experimentId}`)
      return { ok: true }
    },
    onSuccess: (_data, input) => {
      toast({ kind: 'ok', title: 'Baseline promoted', message: input.experimentId })
    },
    onError: (err) => {
      toast({ kind: 'danger', title: 'Could not promote baseline', message: err.message })
    },
    onSettled: () => {
      // Promoting a baseline updates both the baselines list and the
      // overview KPI ("latestExperimentPassRate").
      void client.invalidateQueries({ queryKey: qk.quality.baselines() })
      void client.invalidateQueries({ queryKey: qk.quality.overview() })
    },
  })
  return useCallback(
    async (input: PromoteBaselineInput) => {
      try {
        return await mutation.mutateAsync(input)
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}

// ─── Add suite case ─────────────────────────────────────────────────

interface CaseInput {
  caseId?: string
  id?: string
  name?: string
  input?: unknown
  expected?: unknown
  tags?: readonly string[]
  metadata?: Record<string, unknown>
  origin?: unknown
}

export function useAddCaseMutation() {
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<MutationResult, Error, { suiteId: string; caseInput: CaseInput }>({
    mutationFn: async ({ suiteId, caseInput }) => {
      const r = await postJson(`/api/quality/legacy/suites/${encodeURIComponent(suiteId)}/cases`, caseInput)
      await expectOk(r, `Suite ${suiteId}`)
      return { ok: true }
    },
    onSuccess: (_data, { suiteId }) => {
      toast({ kind: 'ok', title: 'Case saved', message: suiteId })
    },
    onError: (err) => {
      toast({ kind: 'danger', title: 'Could not save case', message: err.message })
    },
    onSettled: (_data, _err, { suiteId }) => {
      // The suite detail screen shows the new case, the suites list
      // shows the updated count.
      void client.invalidateQueries({ queryKey: qk.quality.suite(suiteId) })
      void client.invalidateQueries({ queryKey: qk.quality.suites() })
    },
  })
  return useCallback(
    async (suiteId: string, caseInput: CaseInput) => {
      try {
        return await mutation.mutateAsync({ suiteId, caseInput })
      } catch {
        return { ok: false }
      }
    },
    [mutation],
  )
}
