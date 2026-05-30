# Memory store enrichment isn't reaching real call sites

**Severity:** UI parity. The Memory detail screens have card slots
(`Schema`, `Index health`, `Binding · owner/source/backend/conflict/eviction`)
gated on backend-shipped optional fields. The contract is correct, but
in practice **none of those fields land** on Karyla's three memory
stores even though the project clearly declares schemas + stores.

Per the prior handoff: *"missing still means 'not captured yet.' The
backend does not invent owner, eviction, exact adapter names, or
conflict policies when the source/runtime does not provide them."*
This ticket isn't asking to invent anything — it's asking the
indexer / runtime to **actually pick up the fields the source code
already provides**.

## What we observe (live `/api/memory/stores/{id}` against Karyla)

```
GET /api/memory/stores/thread:m57ew2v2g3s9vhf9gmykbwhb8x87491s
→ {
    id, type: "blackboard", scope, stats, lastTraceId, health,
    state: { type: "blackboard", fields: [], changeLog: [], collaborators: [] }
    // ← no schema, owner, source, backend, conflictPolicy, evictionPolicy
  }
```

Same for the semantic and episodic stores. All three return zero
authored metadata on the wire.

## What the source code actually declares

### 1. Blackboard — has Zod schema, store, owner agent

`packages/backend/convex/agent/coordination/blackboard.ts:33`:

```ts
const threadBlackboardSchema = z.object({
  constraints: z.array(z.string()).default([]),
  pendingActions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  researchFindings: z.object({
    synthesis: z.string(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
    keyFindings: z.array(z.string()),
  }).optional(),
  writerPlan: z.object({
    title: z.string(),
    sections: z.array(z.string()),
    intent: z.enum(['create', 'edit']),
  }).optional(),
  activePlanId: z.string().optional(),
  activeSkillIds: z.array(z.string()).default([]),
  seoAnalysis: z.object({
    score: z.number(),
    issues: z.array(z.string()),
    recommendations: z.array(z.string()),
  }).optional(),
})

export function createThreadBlackboard(sessionId: string, ctx: ActionCtx) {
  return blackboard({
    id: createMemoryId('blackboard', sessionId),  // → 'thread:<sessionId>'
    schema: threadBlackboardSchema,
    store: cruxConvexStore({
      component: components.crux,
      ctx: ctx as any,
    }),
    tool: { description: ... },
  })
}
```

Available to project onto the blackboard store detail:

- `schema` ← `threadBlackboardSchema` (10 fields, with Zod types,
  enums, optionality, nesting).
- `backend` ← `'cruxConvexStore'` (or whatever tag the indexer picks).
- `source` ← `convex/agent/coordination/blackboard.ts:83` (the
  `blackboard({ ... })` call site).
- `owner` ← `'support_swarm'` or whichever agent wraps the call. For
  Karyla today the closest signal is the file/module — `agent/coordination`.

The runtime store id (`thread:m57ew2v2g3s9vhf9gmykbwhb8x87491s`)
matches the authored id (`createMemoryId('blackboard', sessionId)` →
`thread:<sessionId>`), so the join is trivially `runtime.id ===
authored.id`.

### 2. Working state — has Zod schema

`packages/backend/convex/agent/memory/session.ts:36`:

```ts
const state = workingState({ id: 'state', schema: sessionSchema })
```

`workingState({ schema })` declares the typed shape. The indexer
should project `schema` onto any working memory store whose id ends
with the workingState's id (or however the runtime joins).

### 3. Episodic — has store, blocks, namespace

`packages/backend/convex/agent/memory/episodic.ts:12`:

```ts
const store = cruxConvexStore({ component: components.crux, ctx: ctx as any })
const memoryId = createMemoryId('episodic', userId, projectId)  // → 'user-episodes:<userId>:<projectId>'
const namespace = `user:${userId}:project:${projectId}`
const history = episodes({ id: 'episodes' })
const userMemory = memory({
  id: memoryId,
  store,
  namespace,
  blocks: [history],
  processing: { mode: 'inline' },
})
```

Available:

- `backend` ← `'cruxConvexStore'`.
- `source` ← `convex/agent/memory/episodic.ts:21`.
- The `blocks: [episodes({ id: 'episodes' })]` is the entry shape
  hint — the indexer could project `episodes`'s default schema as
  the entry shape if it's annotated upstream.

Same pattern for the semantic store in
`packages/backend/convex/agent/memory/semantic.ts`.

## The indexer already has the discovery wiring

The backend agent's last handoff said:

> Catalog indexer now projects authored memory/blackboard metadata:
>   memory({ store, blocks })
>   workingState({ schema })
>   blackboard({ store, schema })

But none of the Karyla `memory(...)` / `blackboard(...)` /
`workingState(...)` calls appear as definitions in `/api/catalog`:

```js
fetch('/api/catalog').then(r => r.json()).then(d =>
  d.definitions.filter(x => x.kind?.startsWith('memory') || x.kind === 'blackboard' || x.kind === 'workingState')
)
// → [] (empty)
```

So either:

- (a) The indexer's static discovery isn't matching these specific
  authoring patterns (probably because they're nested inside factory
  functions like `createThreadBlackboard(sessionId, ctx)` instead of
  being top-level `export const blackboard = blackboard({...})`); or
- (b) The discovery finds them but doesn't write a definition record
  to `catalog.definitions`; or
- (c) The runtime store detail handler doesn't join the runtime
  store id back to the authored definition.

Whichever it is, the result is the same: 0 of 3 Karyla stores are
enriched.

## What we need

For each `MemoryStoreDetail` returned by `/api/memory/stores/{id}`,
when the runtime can be matched to an authoring call site
(`blackboard / memory / workingState / episodes / semanticMemory`),
populate the fields the contract already defines:

```ts
interface MemoryStoreDetail extends MemoryStore {
  schema?: { name?, fields[], description? } | JSONSchema
  owner?: string
  source?: { file, line, column?, function? }
  backend?: string
  conflictPolicy?: string
  evictionPolicy?: string
  // + state.index / state.retention for episodic when known
}
```

Join key suggestion (cheap, works for Karyla today):

- Runtime `store.id` → authored `id` (e.g. `'thread:<sessionId>'`).
  Both come from `createMemoryId(type, ...)` so they're identical.
- For factory-function callsites, walk back to the `blackboard({...})`
  / `workingState({...})` / `memory({...})` literal inside the function
  body and use its `id` template + `schema` reference.

## Quick verification once shipped

```js
const ids = [
  'thread:m57ew2v2g3s9vhf9gmykbwhb8x87491s',
  'project-knowledge:k17bmq4xk58qnmnfgn738qspax80hjc4',
  'user-episodes:k971sr3hkax9tj3fbwe2ryrpax80hs20:k17bmq4xk58qnmnfgn738qspax80hjc4',
]
Promise.all(ids.map(id => fetch('/api/memory/stores/' + encodeURIComponent(id)).then(r=>r.json())))
  .then(rs => rs.map(d => ({
    id: d.id,
    type: d.type,
    hasSchema:   Boolean(d.schema),
    hasBackend:  Boolean(d.backend),
    hasSource:   Boolean(d.source?.file),
    hasOwner:    Boolean(d.owner),
    hasConflict: Boolean(d.conflictPolicy),
    hasEviction: Boolean(d.evictionPolicy),
    hasIndex:    d.state.type === 'episodic' ? Boolean(d.state.index) : 'n/a',
  })))
```

Expected after fix:

- Blackboard store: `hasSchema: true, hasBackend: true, hasSource: true`
- Episodic store:    `hasSource: true, hasBackend: true` (schema/index when shipped)
- Semantic store:    `hasSource: true, hasBackend: true`

The UI fills in automatically — every detail card is already gated on
field presence. The placeholder cards ("Pending authored schema",
"Pending index telemetry") will swap to the real content on first
refresh.

## Out of scope

- UI changes — already feature-detects every field.
- Inventing owner / eviction when not declared — keep the contract:
  missing means "not captured yet."
- Action endpoints (`Tail live` / `Diff` / `Re-ingest` / `Show
  conflicts`) — separate later ticket.
