# Crux Devtools — Agent Instructions

This file is read by any AI agent (Claude Code, Claude Agent SDK, custom
copilots) before they touch this package. Keep it short, opinionated, and
current — out-of-date instructions are worse than no instructions.

Two pieces of background context every agent needs:

- **What this is**: a self-contained Vite + React 19 SPA that ships
  embedded in the `crux` Go binary. It talks to a local Go backend on
  the same origin via REST (`/api/quality/*`, `/api/observability/*`)
  and a WebSocket (`/ws/ui`) for realtime push events.
- **What this is not**: a general-purpose web app. It runs **locally**
  against a single user's `crux dev` server. Don't add multi-tenant
  patterns, auth flows, or persistence layers.

See also:

- [`QUALITY_BACKEND_HANDOVER.md`](./QUALITY_BACKEND_HANDOVER.md) — the
  REST/WS contract the Go backend offers.
- [`CLIENT_SERVER_BOUNDARY.md`](./CLIENT_SERVER_BOUNDARY.md) — what the
  UI is allowed to derive client-side vs. what must come from the
  backend.

---

## Hard rules

1. **REST goes through TanStack Query.** No `useEffect(() => fetch(...))`.
   No `useState<T>` paired with a tick counter for reload. If you find
   any in the codebase, migrate it as part of your change — see
   "Migration recipe" below.
2. **WebSocket runtime state goes through the Zustand store.** Push-only
   data that isn't backed by a REST endpoint (judge events, runtime
   flow steps, in-flight tool events, span streams) is held by the
   `useRuntimeStore` Zustand store in `hooks/runtimeStore.ts`. The
   store's `dispatch` action wraps the pure `devtoolsReducer` so the
   exhaustive `WsEvent` switch + immutability invariants are preserved.
   **Screens never read the whole store.** They subscribe to a single
   slice via a selector hook (`useConnected`, `useJudgeEvents`, etc.)
   so the screen only re-renders when its slice changes — a chatty
   span emitting cost events won't re-render the Cassettes screen.
3. **Local UI state is `useState`.** Selected span, expanded panel,
   active inner tab, hover targets — never lift these to the store
   or to Query. Per-component.
4. **Navigation is hand-rolled.** `hooks/useNavigation.ts` has a typed
   discriminated-union `NavState` synced to the URL. Don't import
   `react-router` — it was removed from `devDependencies` for a reason.
   When adding a new screen, extend `NavState` and the
   `pathFromState` / `stateFromPath` codec.

---

## Migration recipe: hand-rolled fetch → TanStack Query

Apply this **every time** you touch a hand-rolled fetcher (`useEffect`
+ `fetch` + `useState` + manual `.reload()`), even if your change is
small. We are draining the queue, not deferring it.

### Step 1 — add the cache key

In `ui/src/lib/queryClient.ts`, add the key under the right namespace:

```ts
export const qk = {
  quality: {
    all: ['quality'] as const,
    // ...
    cassettes: () => ['quality', 'cassettes'] as const,
    feedback: () => ['quality', 'feedback'] as const,
  },
  observability: {
    // ...
  },
} as const
```

Cache keys are tuples. **Always nest under a top-level prefix**
(`['quality', ...]` or `['observability', ...]`) so the WebSocket
invalidator can match by prefix.

### Step 2 — add the hook

In `ui/src/qw/shell/useQualityApi.ts`, use this template verbatim:

```ts
export function useQualityCassettes(): FetchState<readonly QualityCassetteRecord[]> {
  const key = qk.quality.cassettes()
  const q = useQuery<readonly QualityCassetteRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) =>
      fetchJson<readonly QualityCassetteRecord[]>('/api/quality/cassettes', signal),
  })
  return useAdapted(q, key)
}
```

`useAdapted(q, key)` returns the `{ data, loading, error, reload }`
shape every existing screen expects. **Don't return the raw `useQuery`
result** — call sites depend on the legacy field names.

For endpoints with options (filters, pagination):

```ts
export function useQualityRuns(opts?: QualityRunsOptions): FetchState<readonly QualityRunRecord[]> {
  // Memoize the cache key portion of the options to keep referential stability.
  const stableOpts = useMemo(() => ({ /* primitive fields only */ }), [/* deps */])
  const qs = buildRunsQuery(opts)
  const key = qk.quality.runs(stableOpts)
  const q = useQuery<readonly QualityRunRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => fetchJson(`/api/quality/runs${qs}`, signal),
  })
  return useAdapted(q, key)
}
```

For endpoints that take a single id:

```ts
export function useQualityRunDetail(traceId: string | null | undefined) {
  const key = qk.quality.run(traceId)
  const q = useQuery<QualityRunDetailRecord, Error>({
    queryKey: key,
    queryFn: ({ signal }) => fetchJson(`/api/quality/runs/${encodeURIComponent(traceId ?? '')}`, signal),
    enabled: Boolean(traceId), // <-- always gate optional id queries
  })
  return useAdapted(q, key)
}
```

For endpoints that should poll while data is in-flight (running runs,
streaming generations, anything with a status field):

```ts
const q = useQuery<MyRecord, Error>({
  queryKey: key,
  queryFn: ({ signal }) => fetchJson(path, signal),
  refetchInterval: (query) => {
    const status = query.state.data?.status
    if (!isTerminalStatus(status)) return 1000              // poll fast while live
    const elapsed = Date.now() - (query.state.dataUpdatedAt || 0)
    return elapsed < 60_000 ? 5_000 : false                 // taper after terminal
  },
})
```

### Step 3 — replace call sites

Search every `runtime.<sliceName>` read across `ui/src/qw/screens/`
(and elsewhere) and replace it with the hook. The destructure stays
the same:

```diff
-  const { qualityCassettes } = runtime
+  const { data: qualityCassettes = [] } = useQualityCassettes()
```

**Don't keep both paths.** If the data is on Query, delete the reducer
slice in the same PR — running both means cache divergence the next
time someone refactors.

### Step 4 — wire WebSocket invalidation

In `ui/src/hooks/useDevtools.ts`, the WS `onMessage` handler already
invalidates `qk.quality.all` on any `QualityEvent`. **Don't fan that
out per-endpoint.** Prefix-based invalidation is intentional: any
`['quality', ...]` cache entry refetches on a quality push, and Query
de-dupes the network calls. If a particular endpoint needs surgical
invalidation, do that in the handler with a `kind`-based switch:

```ts
if (tag === 'QualityEvent') {
  const kind = (msg as { kind?: string }).kind
  if (kind === 'cassette') {
    void queryClient.invalidateQueries({ queryKey: qk.quality.cassettes() })
  } else {
    void queryClient.invalidateQueries({ queryKey: qk.quality.all })
  }
}
```

But that's an optimization — start with the prefix.

### Step 5 — delete the on-connect REST fan-out

In `ui/src/hooks/useDevtools.ts`'s `onConnected` callback, remove the
`fetch(...)` call for the endpoint you just migrated. Query handles
initial fetch on hook mount; the on-connect block exists only for
slices the reducer still owns.

### Step 6 — delete the reducer slice (when fully migrated)

If you removed the last call site of `runtime.<sliceName>`, also
delete:

- The `SET_<SLICE>` action variant in `devtoolsReducer.ts`
- The slice field from `DevtoolsState` / `INITIAL_STATE`
- The slice from `flattenState()` in `qw/shell/viewState.ts`
- The dispatch in `useDevtools.ts`

`pnpm --filter @crux/devtools test` should still pass — `devtoolsReducer.test.ts` covers the remaining slices.

### Step 7 — verify

```bash
# Typecheck (this package only, OOM-safe per AGENTS.md)
turbo typecheck --filter=@crux/devtools

# Tests
pnpm --filter @crux/devtools test -- --run

# Live browser smoke test (preview mcp tool with WSL launch config)
# - Confirm the screen renders
# - Trigger a mutation, confirm UI updates without a manual refresh
# - Open React Query Devtools (dev only) and confirm the cache key
#   exists and refetches on WS events
```

---

## Mutation pattern

Mutations live in `ui/src/qw/shell/useQualityMutations.ts`. Use
`useMutation` with `onMutate` for optimistic updates and `onSettled` for
the canonical refetch:

```ts
export function useInsightMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ insightId, status }: { insightId: string; status: InsightStatus }) =>
      postJson(`/api/quality/insights/${insightId}/status`, { status }),

    // Optimistic: hide the dismissed insight before the round-trip lands.
    onMutate: async ({ insightId, status }) => {
      const key = qk.quality.insights()
      await client.cancelQueries({ queryKey: key })
      const prev = client.getQueryData<readonly QualityInsightRecord[]>(key)
      client.setQueryData<readonly QualityInsightRecord[]>(key, (old) =>
        (old ?? []).map((i) => (i.insightId === insightId ? { ...i, status } : i)),
      )
      return { prev }
    },

    // Rollback on failure
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) client.setQueryData(qk.quality.insights(), ctx.prev)
    },

    // Always reconcile with the server
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.quality.insights() })
    },
  })
}
```

The WS layer will *also* invalidate on the corresponding push event —
that's fine. Query dedupes overlapping refetches.

---

## What you must **not** do

- **Don't import `react-router`.** It was in `devDependencies` once and
  has been deliberately removed. The hand-rolled `useNavigation` is
  the right tool for our typed discriminated-union nav state.
- **Don't add Jotai or Redux Toolkit.** Zustand owns the runtime store;
  the pure `devtoolsReducer` (still in `hooks/devtoolsReducer.ts`) is
  its `dispatch` body, so the exhaustive `WsEvent` switch + immutability
  guarantees are preserved. Jotai's atomic model would fight the
  reducer's bundled-event shape; RTK pulls Redux without buying us
  anything Query + Zustand doesn't already give us.
- **Don't read the whole runtime store.** Always go through a selector
  hook (`useConnected`, `useJudgeEvents`, etc.). Adding a new selector
  for a new slice is one line in `runtimeStore.ts`.
- **Don't ship React Query Devtools to production.** It's gated
  behind `import.meta.env.DEV` in `main.tsx`. Don't unwrap that —
  devtools-of-devtools is genuinely confusing.
- **Don't add a global cache TTL** with `staleTime`. `staleTime: 0` is
  intentional — this is a *local* observability UI, traces move
  constantly, and every refetch is a sub-100ms localhost round-trip.
  If a particular query is expensive, set its own `staleTime` on that
  hook only.
- **Don't add `keepPreviousData`** as a default — it makes stale data
  feel fresh and is the wrong call for a debugging tool. Per-query
  opt-in only.
- **Don't use `useSuspenseQuery` yet.** Our screens render fallback
  states (`loading`, empty hints) and we don't have an `<ErrorBoundary>`
  / `<Suspense>` boundary mounted for it.

---

## State ownership matrix

When in doubt about *where* a piece of state lives:

| Kind of state                          | Where it lives                          |
|----------------------------------------|------------------------------------------|
| REST endpoint result (any kind)        | TanStack Query (`useQualityX`, `useCatalog`, `useObservability*`) |
| Push-only WS stream with no REST equivalent | Zustand runtime store, accessed via per-slice selectors (`useJudgeEvents`, `useAgentEvents`, etc.). Dispatch body is the pure `devtoolsReducer`. |
| WS event that mirrors a REST snapshot  | Store is bypassed; the WS handler calls either `queryClient.invalidateQueries({ queryKey: prefix })` or `queryClient.setQueryData(key, payload)` |
| URL / deep-linked nav state            | `useNavigation` discriminated union      |
| Ephemeral UI (selected span, etc.)     | `useState` in the component              |
| Theme                                  | `useTheme` (custom Context, persisted to localStorage) |
| Per-screen filter chips                | Component `useState` + reflected to URL through `navigate()` |

If your new piece of state doesn't fit any of these rows, that's a
signal — bring it up before adding a new store.

### Current Query coverage

Everything REST-shaped is on Query. The hooks live in
`ui/src/qw/shell/useQualityApi.ts` and `ui/src/hooks/`:

- `useQualityOverview`, `useQualityRuns`, `useQualityRunDetail`,
  `useQualitySuites`, `useQualitySuite`, `useQualityInsights`,
  `useQualityScorers`, `useQualityExperiments`, `useQualityComparisons`,
  `useQualityBaselines`, `useQualityFeedback`,
  `useQualityFeedbackAnnotations`, `useQualityFeedbackMemoryProposals`,
  `useQualityCassettes`
- `useObservabilityRuns`, `useObservabilityGraph`, `useObservabilityResourceActivity`
- `useCatalog` (prompts/contexts/tools)

### What lives in the Zustand runtime store (and why)

Only WS-pushed runtime state with no REST equivalent. As of the
last audit:

- `runtime.runtimeFlowRuns` — diff stream over `runtime-flow:*` events
- `runtime.judgeEvents`, `runtime.securityEvents`, `runtime.costEvents`,
  `runtime.embeddingEvents`, `runtime.retrievalEvents`, `runtime.memoryEvents`, etc.
- `runtime.traces`, `runtime.evalRuns`, `runtime.ragEvalRuns`,
  `runtime.flowRuns` (legacy eval/flow stores)
- `connected` flag (toggled by the WS connection)

Note: `runtimeFlowRuns` is hydrated by an initial REST snapshot
(`/api/runtime-flows` on connect) but **does not** belong in Query —
the WS stream applies diffs (step added, status changed, suspended,
resumed, cancelled, expired) and there is no REST endpoint that
returns the composed view. Keeping it in the store with the reducer
as dispatch body means the exhaustive `WsEvent` switch catches new
event types at compile time.

### Adding a new slice selector

When a new screen needs a slice that isn't already exposed via a
selector hook, add one line in `hooks/runtimeStore.ts`:

```ts
export const useNewSliceEvents = () => useRuntimeStore((s) => s.runtime.newSliceEvents)
```

Then in the screen: `const events = useNewSliceEvents()`. The screen
only re-renders when that slice's reference changes. **Don't read
multiple slices through `useRuntimeStore((s) => ({ a: s.a, b: s.b }))`**
— that creates a new object every render and defeats the comparison.
Call two separate selector hooks instead.

---

## Build & ship reminders

This package ships as part of the Go binary. The build order is
**non-negotiable**, see `AGENTS.md` for the full chain. The minimum
you should run before declaring a UI change done:

```bash
turbo typecheck --filter=@crux/devtools
pnpm --filter @crux/devtools test -- --run
pnpm --filter @crux/devtools build           # both server bundle + UI bundle
```

Verifying the production bundle didn't regress is more important here
than in a typical web app: a broken UI ships baked into the Go binary
and nobody catches it until it lands on someone's machine.

---

## When this file gets out of date

Re-read whenever you touch any of:

- `ui/src/hooks/useDevtools.ts`
- `ui/src/hooks/devtoolsReducer.ts`
- `ui/src/hooks/useNavigation.ts`
- `ui/src/lib/queryClient.ts`
- `ui/src/qw/shell/useQualityApi.ts`
- `ui/src/qw/shell/useQualityMutations.ts`

If you find a rule here you broke for a good reason, **update this file
in the same PR**. If you find a rule that doesn't make sense anymore,
delete it. Don't let it rot.
