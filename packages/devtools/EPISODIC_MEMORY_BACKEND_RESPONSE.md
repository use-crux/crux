# Episodic Memory — Backend Response & UI Handover

Response to *"Backend Ask — Populate the Episodic Memory devtools contract."* Backend work is **done, typechecked, tested, and uncommitted** in the working tree (crux submodule + Karyla `convex/agent/memory`). This doc is the contract you build against.

> **Activation:** the Go read-model changes are compiled into the CLI binary. They take effect only after `cd crux/packages/cli && make embed && make build`. Until then the live devtools still serves the old shape.

---

## TL;DR — the guiding principle

We populated **every field that has a real source** and **deliberately left the rest absent** rather than fabricate. Karyla's episodic store is, by design, a **recency/list-backed log with no vector index, no embeddings, no per-write confidence** (records happen inside Convex mutations, which can't make embedding calls). So the "Quality Workbench" renders **real-but-sparse**: rich on provenance/retention/tags, empty on vector-index/score/confidence — and that emptiness is the truth, not a wiring gap.

**Render the absence honestly.** When `state.index` is missing, show "Recency-backed · no vector index", not an empty index-health card. When `confidence`/`topScore` are absent, hide the chip — don't show `—` everywhere as if data failed to load.

---

## The JSON contract (what `GET /api/memory/stores/{id}` now returns)

### `state.entries[]`
| Field | Type | Populated for Karyla? | Source |
|---|---|---|---|
| `id` | string | ✅ | entry key |
| `content` | string | ✅ | episode text |
| `tags` | string[] | ✅ | `metadata.tags` (derived from `metadata.type` at record time) |
| `timestamp` | number (ms) | ✅ | updatedAt/createdAt |
| `writtenBy` | string | ✅ | subsystem origin, e.g. `"drafts/feedback"`, `"drafts/suggestions"`, `"drafts/publish"`, `"drafts/lifecycle"`, `"agent/conversation"` |
| `sourceRun` | string | ✅ | observability run id of the write |
| `sourceTraceId` | string | ⚪ usually absent | only present when the record path carries a `traceId` (the mutation path doesn't) |
| `confidence` | number 0..1 | ❌ absent | no source — episodes carry no confidence (only embedded `facts()`/`procedures()` do) |

### `state.queries[]`
| Field | Type | Populated? | Source |
|---|---|---|---|
| `eventId`, `query`, `timestamp` | | ✅ | |
| `k` | number | ✅ | result count |
| `latencyMs` | number | ✅ | read duration |
| `topScore` | number | ❌ absent | no vector recall → no score. (Wire is plumbed; populates automatically for any *embedded* store.) |
| `traceId`, `spanId` | string | ⚪ | when present |

### `state.writes[]`
| Field | Type | Populated? | Notes |
|---|---|---|---|
| `eventId`, `entryId`, `contentPreview`, `timestamp` | | ✅ | |
| `op` | string | ✅ | **Values are `"record"`, `"evict"`, `"delete"` — NOT `"append"`.** `record` = new episode, `evict` = retention GC sweep, `delete` = manual. Map these to your pills (e.g. `record`→append-style, `evict`→eviction-style). |
| `writtenBy` | string | ✅ | same subsystem origin as entries |
| `confidence` | number | ❌ absent | no source |
| `traceId`, `spanId` | string | ⚪ | when present |

### `state.index` — **absent for Karyla (by design)**
Only emitted when the episodes block has a real embedder (`hasEmbed`). The previous fabricated `status:"observed" · 10/10` is **gone**. For Karyla this key is **not present**. When an embedded store exists it carries `{ embeddingModel, dimensions, distance, indexedCount, targetCount, status }` (`status:"fresh"` when the store reports real telemetry, `"observed"` when inferred).

### `state.retention` — ✅ real
```jsonc
{ "policy": "90d", "lastGcAt": 1733000000000, "lastGcEvicted": 4 }
```
`policy` is always present (`"90d"`). `lastGcAt`/`lastGcEvicted` appear **after the daily GC cron has run at least once** (they come from real `evict` events the sweep emits). Before the first sweep, only `policy` is present.

### `detail.schema` — ✅ canonical `EpisodicEntry` (Task 7, Option A)
Attached for **all** `type:"episodic"` stores as a JSON-Schema object: `title:"EpisodicEntry"`, `properties` = `id, content, tags, writtenBy, sourceRun, createdAt` (+ `confidence, embedding` **only when the store is embedded**), `required:[id, content, createdAt]`, `x-authored:true`. This kills "PENDING AUTHORED SCHEMA". It's embedder-aware so the card never advertises fields the store doesn't persist.

---

## Your original tasks → outcome

| Task | Outcome |
|---|---|
| 1 — tags | ✅ tags real (from `metadata.type`). **confidence: dropped** (no source). |
| 2 — k/topScore/latency, op/confidence | ✅ k + latency real; op real (`record`/`evict`/`delete`). topScore + write-confidence: **absent** (no source; plumbed for embedded stores). |
| 3 — source_run / trace | ✅ `sourceRun` real; `sourceTraceId` usually absent (mutation path has no traceId). |
| 4 — written_by | ✅ **done** — real subsystem attribution (not a fabricated agent name). |
| 5 — real index health | ✅ **fixed by removal** — no more fake "observed"; recency stores show no index. |
| 6 — retention / GC | ✅ real `policy` + `lastGcAt`/`lastGcEvicted` from the actual 90-day sweep. |
| 7 — authored schema | ✅ **Option A** — canonical `EpisodicEntry` attached server-side. |

---

## UI work now greenlit (you flagged these as independent)

1. **Header chips** — swap to **Retention (`90d`)** and provenance-oriented chips instead of "Reads". Drop "Embedding" for recency stores (no index). Show **Avg writtenBy diversity / top source** instead of "Avg conf." (which is empty here).
2. **Tabs** — Recent / By-tag are great (tags are populated). **Drop "Highest-conf"** for recency stores (no confidence) or hide it when no entry has `confidence`.
3. **Schema card** — render `detail.schema` (the canonical `EpisodicEntry`). Static, always present.
4. **Entry rows** — render `writtenBy` ("written by · drafts/feedback") and `sourceRun` ("from run · <id>"). Conditionally render `confidence`/`sourceTraceId` only when present.
5. **Writes table** — pill from `op` (`record`/`evict`/`delete`), show `writtenBy`. Evictions (`op:"evict"`) are your GC activity.
6. **Index health card** — render only when `state.index` exists; otherwise a small "Recency-backed · no vector index" note. **Do not** render empty index health.
7. **Retention card** — `policy` always; show "Last GC · <lastGcAt> — evicted N" only when `lastGcAt` present.

---

## Gotchas

- **`op` is `"record"`, not `"append"`.** Update any pill mapping that assumed append.
- **`sourceTraceId` ≠ `sourceRun`.** `sourceRun` (run id) is populated; `sourceTraceId` (trace) usually isn't. Use `sourceRun` for "from run · …".
- **`confidence`, `topScore`, `state.index` are absent by design.** Degrade per-field; don't treat absence as an error/loading state.
- Field names are **camelCase** (`topScore`, `latencyMs`, `writtenBy`, `sourceRun`, `lastGcAt`) consistent with the rest of the read-model.

---

## Deferred (not in scope, parked intentionally)

**Embedded/semantic episodic recall** (which would make `topScore`, vector-index health, and `confidence` real) was scoped and **deferred** — nothing in the product consumes semantic episode recall today, and it carries real embedding cost. It's a product decision, not a devtools fix. If it ever happens, the agreed shape is dual-layer (Convex recency + async Upstash vector index, mirroring `semantic.ts`/`ingest.ts`), selective embedding, no backfill. Until then, the absent fields above stay absent — correctly.

---

## Backend files changed (for reference / review)

**crux submodule:** `packages/core/memory/block-system.ts` (`episodes()` gains `retention` + `evict()`), `packages/local/internal/devtools/library_readmodels.go` (+ test), `packages/local/internal/store/{event_types,memory_events}.go`, plus README/ARCHITECTURE/reference/episodic-guide docs.
**Karyla:** `convex/agent/memory/{episodic,episodes,lifecycle}.ts`.
