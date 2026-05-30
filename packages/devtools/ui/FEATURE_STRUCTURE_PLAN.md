# Crux Devtools UI Feature Structure Plan

Goal: migrate `packages/devtools/ui/src` to a durable
`app/pages/features/shared` architecture without changing behavior.

This plan is intentionally detailed so work can resume safely after context
compaction. Update the status checkboxes as slices land.

## Architecture Decisions

- Scope the feature-folder refactor to `packages/devtools/ui`.
- Keep package-level runtime boundaries intact: `bin`, `server`, `lib`, `ui`.
- Use `app/`, `pages/`, `features/`, and `shared/` under `ui/src`.
- Do not create empty convention folders.
- Once a feature has a component, place it in `components/`, not the feature
  root.
- Split backend access into `services/` for plain async calls and `hooks/` for
  React/TanStack Query hooks.
- Avoid `repositories`; this is frontend REST/query code, not a persistence
  abstraction.
- Keep `shared` genuinely generic.
- Prefer `app/runtime/` for WebSocket/runtime store/reducer code.

## Dependency Rules

```txt
app -> pages, features, shared
pages -> features, shared
features -> shared
shared -> external packages only
```

Feature-to-feature imports require an explicit reason. If two features need the
same code, move that code to `shared` only when it has no feature vocabulary.

## Verification Strategy

Follow vertical slices:

1. Move one coherent slice.
2. Update imports.
3. Run focused verification.
4. Mark the slice status below.

Preferred commands:

```bash
turbo typecheck --filter=@crux/devtools
pnpm --filter @crux/devtools test -- --run
```

If a command cannot run locally, record the blocker here before continuing.

## Slice Status

### 0. Documentation And Guardrails

- [x] Create `ui/AGENTS.md` with structure rules.
- [x] Create `ui/CLAUDE.md` importing `@AGENTS.md`.
- [x] Create this migration plan.

### 1. Foundation

- [x] Create `src/app`, `src/pages`, `src/features`, `src/shared`.
- [x] Move app bootstrap/router composition out of `src/App.tsx` where useful.
- [x] Move navigation files to `src/app/navigation`.
- [x] Move runtime WebSocket/store/reducer files to `src/app/runtime`.
- [x] Move generic hooks to `src/shared/hooks`.
- [x] Move cross-feature API hooks out of `qw/shell` into
      `src/shared/hooks`.
- [x] Move generic utilities/query helpers to `src/shared/lib` or
      `src/shared/query`.
- [x] Move shared HTTP helpers into `src/shared/services`.
- [x] Remove old top-level `src/hooks` and `src/lib` after moving remaining
      shared/feature-specific files.
- [x] Update imports for moved files.
- [x] Verify typecheck/tests.

### 2. Shared Components

- [x] Move `src/components/ui` to `src/shared/components/ui`.
- [x] Move `src/components/ai-elements` to `src/shared/components/ai-elements`.
- [x] Move generic display/chart primitives to `src/shared/components` only
      when they have no feature vocabulary.
- [x] Update imports for moved shared component folders.
- [x] Verify typecheck/tests.

### 3. Search Feature

- [x] Create `src/features/search/components`.
- [x] Create `src/features/search/hooks`.
- [x] Move `GlobalSearch` and shortcut behavior into `features/search`.
- [x] Update imports.
- [x] Verify typecheck/tests.

### 3a. Overview Feature

- [x] Create `src/features/overview`.
- [x] Move overview page composition to `pages/OverviewPage.tsx`.
- [x] Move overview-owned UI into `features/overview/components`.
- [x] Update imports for the initial overview move.
- [x] Verify typecheck/tests.

### 4. Runs Feature

- [x] Create `src/features/runs`.
- [x] Move runs list screen composition to `pages/RunsPage.tsx`.
- [x] Move runs-owned UI into `features/runs/components`.
- [x] Move runs hooks into `features/runs/hooks`.
- [x] Keep runs service calls behind service-backed query hooks; runs-specific
      data composition now lives in `features/runs/hooks/useRuns.ts`.
- [x] Move runs pure helpers into `features/runs/lib`.
- [x] Update imports for the initial component/page move.
- [x] Verify typecheck/tests.

### 5. Run Detail Feature

- [x] Create `src/features/run-detail`.
- [x] Move run detail page composition to `pages/RunDetailPage.tsx`.
- [x] Move span tree/graph/detail panel into
      `features/run-detail/components`.
- [x] Move legacy run-detail visualization components into
      `features/run-detail/components`.
- [x] Move run-detail shell-owned replay/streaming components into
      `features/run-detail/components`.
- [ ] Move run-detail hooks/services/lib as needed.
- [x] Update imports for the initial screen/page move.
- [ ] Verify typecheck/tests.

### 6. Insights Feature

- [x] Create `src/features/insights`.
- [x] Move insights page composition to `pages/InsightsPage.tsx`.
- [x] Move initial insights screen UI into
      `features/insights/components`.
- [ ] Move insights hooks/services/lib as needed.
- [x] Update imports for the initial insights move.
- [ ] Verify typecheck/tests.

### 7. Experiments Feature

- [ ] Create `src/features/experiments`.
- [x] Create `src/features/experiments`.
- [x] Move compare page composition to `pages/ComparePage.tsx`.
- [x] Move experiments/evals page composition to pages.
- [x] Move eval matrix, eval case detail, flow case detail, and comparison UI
      into `features/experiments/components`.
- [ ] Move experiments hooks/services/lib as needed.
- [x] Move comparison UI into `features/experiments/components`.
- [x] Move experiments list/detail UI into `features/experiments/components`.
- [x] Update imports for the initial compare move.
- [ ] Verify typecheck/tests.

### 8. Datasets Feature

- [x] Create `src/features/datasets`.
- [x] Move datasets page/detail composition to pages.
- [x] Move datasets-owned UI into `features/datasets/components`.
- [ ] Move datasets hooks/services/lib as needed.
- [x] Update imports for the initial datasets move.
- [ ] Verify typecheck/tests.

### 9. Smaller Quality Features

- [x] Create/migrate `features/baselines`.
- [x] Create/migrate `features/feedback`.
- [x] Create/migrate `features/cassettes`.
- [x] Create/migrate `features/scorers`.
- [ ] Update imports and verify typecheck/tests after each feature.

### 10. Library Domain Features

- [x] Create/migrate `features/catalog`.
- [x] Create/migrate `features/memory`.
- [x] Create/migrate `features/workspaces`.
- [x] Create/migrate `features/plans`.
- [x] Extract pure memory/workspace/plan formatting helpers into
      feature-local `lib` modules.
- [ ] Keep shared library shell code in a feature only while it is
      library-specific; otherwise move generic shell code to `app` or `shared`.
- [ ] Update imports and verify typecheck/tests after each feature.

### 11. Observability Feature

- [x] Create `src/features/observability`.
- [x] Move initial observability graphs/timelines/session/flow UI here when it
      is not run-detail-specific.
- [x] Move legacy observability trace widgets into
      `features/observability/components`.
- [x] Move observability hooks/lib as needed.
- [x] Move observability REST calls into `features/observability/services`.
- [x] Update imports for the initial observability hook/lib move.
- [x] Verify typecheck/tests.

### 12. Legacy Views Cleanup

- [x] Audit `src/views` for mounted vs orphaned screens.
- [x] Migrate still-used views into pages/features.
- [x] Delete orphaned views only after confirming they are not mounted.
- [x] Update navigation aliases if needed.
- [ ] Verify typecheck/tests.

## Current Status

Documentation and guardrails are in place. Mounted screens now route through
`pages/*` into `features/*`; the old top-level `src/hooks`, `src/lib`, and
`src/qw/screens` directories have been drained. The old top-level
`src/components` and `src/views` directories have also been drained and
removed. The only mounted legacy view was `Catalog`, now moved to
`features/catalog/components/Catalog.tsx`; the other `src/views` files were
confirmed unreferenced before deletion. Next slice: continue shrinking
feature-internal large files by extracting hooks/services/lib where it reduces
real coupling. Cross-feature REST hooks have been moved from `qw/shell` to
`shared/hooks`, with common HTTP helpers in `shared/services/http.ts`. Router
composition now lives in `app/router/AppRouter.tsx`; `App.tsx` is provider and
runtime bootstrap focused. The first feature-internal helper extraction is in
place for memory, workspaces, and plans. `ReplayPlayer` and streaming chunk UI
now live with run detail. Runs has been split into feature `types`, `hooks`,
`lib`, and smaller `components`; `RunsView` now composes these pieces instead
of owning fetch/query mapping, row mapping, selection, grouping, export, and
table rendering inline. Observability REST calls now live behind
`features/observability/services/observability.ts`; the hooks map those service
functions into TanStack Query. `scripts/check-ui-architecture.mjs` guards
against reintroducing legacy root imports/directories and unapproved
feature-to-feature imports.

Second organization pass: plan detail is now split from the plans overview into
`features/plans/components/PlanDetailScreen.tsx`, with shared plan UI atoms in
`features/plans/components/PlanAtoms.tsx`. `PlansView.tsx` is back under 1k
lines and acts as route/overview composition. `SpanDetailPanel.tsx` still needs
renderer-level splitting, but its pure inspection/data helpers now live in
`features/run-detail/lib/span-detail-inspection.ts`, so the remaining file is
mostly tab rendering.

Third organization pass: memory's local library-detail atoms now live in
`features/memory/components/MemoryAtoms.tsx`, and `SpanDetail.tsx` now delegates
format/event helpers to `features/run-detail/lib/span-detail-format.ts` plus
render primitives to `features/run-detail/components/SpanDetailAtoms.tsx`.
`SpanDetail.tsx` dropped from ~2.8k lines to ~2.1k lines; `MemoryView.tsx`
dropped from ~2.5k lines to ~2.1k lines. A small server indexer type mismatch
in `server/indexer/graph/builder.ts` was fixed to keep the crux-devtools
TypeScript project green while this UI refactor is in progress.

Fourth organization pass: workspaces now has dedicated local components for
shared atoms, the file tree, and the file inspector:
`features/workspaces/components/WorkspaceAtoms.tsx`,
`WorkspaceFileTree.tsx`, and `WorkspaceFileInspector.tsx`. `WorkspacesView.tsx`
is now focused on route/overview/detail composition rather than owning every
sub-view inline, and is back under 1k lines. TypeScript also surfaced stale
server indexer import-resolution call sites after `collectImportBindings`
started requiring the project root; `server/indexer/paths.ts` and
`server/indexer/static-cache.ts` were updated to pass the root explicitly.

Fifth organization pass: catalog now delegates recursive JSON-schema rendering
to `features/catalog/components/CatalogSchema.tsx`, kind glyph/badge vocabulary
to `CatalogKind.tsx`, and kind-specific metadata panels to
`CatalogKindMetadata.tsx`. `Catalog.tsx` remains the route/detail/sidebar
composition layer and no longer owns those nested renderers inline.

Sixth organization pass: catalog's sidebar tree now lives in
`features/catalog/components/CatalogTree.tsx`, including tree construction,
kind normalization, and project-root path stripping. Insights now delegates
the large insight/occurrence card renderer to
`features/insights/components/InsightCard.tsx`, with shared severity labels
and relative time formatting in `features/insights/lib/insight-format.ts`.
`Catalog.tsx` is now ~800 lines and `InsightsView.tsx` is now ~600 lines.

Seventh organization pass: memory's shared route atoms were completed in
`features/memory/components/MemoryAtoms.tsx`, authored/inferred schema display
now lives in `MemorySchema.tsx`, and overview-specific panels now live in
`MemoryOverviewPanels.tsx` (`StoreCard`, spotlight panels, and cross-store
operation history). `MemoryView.tsx` is down to ~1.6k lines and is now mostly
overview/detail composition plus the four detail renderers.

Eighth organization pass: memory's shared definition binding card now lives in
`MemoryBinding.tsx`, Working detail moved to `MemoryWorkingDetail.tsx`, and
Episodic detail moved to `MemoryEpisodicDetail.tsx`. `MemoryView.tsx` is now
under 1k lines and acts as the memory route/overview/detail dispatcher plus the
remaining Semantic and Blackboard renderers.

Ninth organization pass: replay player formatting and kind vocabulary now live
in `features/run-detail/lib/replay-format.ts`. This is a preparatory slice for
the larger replay event-card extraction: playback state remains in
`ReplayPlayer.tsx`, while reusable canonical kind/color/icon/status/time/json
helpers are out of the component.

Verification note: `turbo typecheck --filter=@crux/devtools` cannot run in
the current shell because WSL has no Linux `node`, and Windows `pnpm` cannot
execute this Linux workspace cleanly from the UNC path. As a fallback, host
TypeScript was run directly with `node node_modules/typescript/bin/tsc -p
packages/devtools/tsconfig.json --noEmit --pretty false`, and it passes.

Additional reliability pass completed after the initial migration:

- Fixed clipped JSX/component identifiers and visible strings introduced by a
  mechanical rewrite (`+ filter`, `Clear filter`, `ChipPopover`, `header`,
  `Shimmer`, `RunsFilterBar`, `TableHeader`, `BulkActionsBar`,
  `ReplayPlayer`, `SpotlightPlaceholder`, `TreeFolder`).
- Fixed clipped TypeScript tokens/properties (`number`, `error`, `provider`,
  `order`, `hideTrigger`, comments ending in `filter`, `under`, `for`).
- Re-ran static import-path audit: passed.
- Re-ran targeted clipped-token scans: no remaining matches for the audited
  patterns.
- Ran host TypeScript directly with `node node_modules/typescript/bin/tsc`.
  The current crux-devtools TypeScript project passes.

Tenth organization pass: replay event rendering now lives in
`features/run-detail/components/ReplayEventCard.tsx`, while replay data shapes
live in `features/run-detail/types.ts`. `ReplayPlayer.tsx` is now focused on
playback state, scrubber controls, live tailing, and event list composition.
Run-detail canvas/inspect modes moved to `RunDetailModes.tsx`, and run-level
feedback/scores plus the save-as-case prompt moved to `RunLevelViews.tsx`.
`RunDetailView.tsx` is now under 1k lines; the remaining large run-detail
files are `SpanDetailPanel.tsx` and `SpanDetail.tsx`.

Eleventh organization pass: shared local atoms for the run-detail span panel
now live in `features/run-detail/components/SpanDetailPanelAtoms.tsx`.
`SpanDetailPanel.tsx` still needs tab-level extraction, with the Output tab as
the next safest slice, but the completed atom split is compiled and guarded.

Twelfth organization pass: pure span-detail tool and retrieval helpers moved
out of `SpanDetailPanel.tsx` into `features/run-detail/lib/span-detail-tool.ts`
and `features/run-detail/lib/span-detail-retrieval.ts`. The component still
owns the tab renderers, but tool payload resolution, tool-request collection,
and retrieval entry normalization are now feature lib code. TypeScript and the
UI architecture guard pass after this slice.

Thirteenth organization pass: smaller output rendering pieces moved from
`SpanDetailPanel.tsx` into `SpanDetailOutputRenderers.tsx`, keeping the larger
Output tab in place while extracting its toggle, text renderer, and
expected-vs-actual frame. `SpanDetail.tsx` also now delegates correlated-event
execution maps to `lib/span-detail-trace.ts` and SpanNode aggregation helpers
to `lib/span-node-aggregates.ts`. `SpanDetail.tsx` is now under 2k lines, and
TypeScript plus the architecture guard pass.
