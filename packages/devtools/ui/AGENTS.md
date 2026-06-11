# Crux Devtools UI Agent Instructions

This folder is the Vite + React 19 SPA embedded into the `crux` Go binary.
It talks to the local devtools backend on the same origin through REST and
WebSocket endpoints. Keep changes local-first, single-user, and
behavior-preserving unless the task explicitly asks for product changes.

## Target Structure

Use this top-level layout under `ui/src`:

```txt
src/
  app/       app bootstrap, providers, routing, runtime wiring
  pages/     route-level composition only
  features/  product/domain workflows
  shared/    generic UI primitives, hooks, services, query helpers, utilities
```

Do not create empty convention folders. Once a feature has its first component,
put it in `components/`; once it has its first hook, put it in `hooks/`.
Feature roots are for feature-level modules such as `types.ts` only.

## Feature Convention

Feature folders should grow toward this shape as needed:

```txt
features/<feature>/
  components/   feature-owned React components
  hooks/        feature-owned React hooks, including TanStack Query hooks
  services/     plain async backend/client calls
  lib/          pure feature-specific helpers
  stores/       only if the feature owns state beyond component-local state
  types.ts      feature-specific types
```

Components should call hooks. Hooks call services. Services call shared IO
helpers such as `fetchJson`. Avoid components calling services directly unless
there is a very specific reason.

## Dependency Rules

Keep imports flowing in one direction:

```txt
app -> pages, features, shared
pages -> features, shared
features -> shared
shared -> external packages only
```

Feature-to-feature imports should be rare and deliberate. If two features need
the same component/helper, either move it to `shared` if it is genuinely
generic, or expose a narrow public module from the owning feature.

## Feature Slices

Use product/domain names, not technical layer names:

- `runs` - runs list, filters, grouping, run rows, run summaries
- `run-detail` - single run/trace inspection, span tree/detail, waterfall,
  replay/canvas-oriented UI
- `insights` - quality/security insights, anomaly/error/severity UI
- `experiments` - experiments, evals, comparisons
- `datasets` - datasets and dataset detail
- `baselines` - baseline management UI
- `feedback` - feedback list/detail workflows
- `cassettes` - cassette workflows
- `scorers` - scorer workflows
- `index` - prompts, contexts, tools, source resolution
- `memory` - memory instances and explorer UI
- `workspaces` - workspace/file browsing UI
- `plans` - plan cards, timelines, plan detail UI
- `observability` - reusable observability graphs/timelines/session/flow UI
- `search` - global search and navigation search behavior

## Shared Placement

Use `shared` only for code that is truly app-generic:

```txt
shared/
  components/
    ui/           shadcn/base UI primitives
    ai-elements/  generic AI rendering primitives
    charts/       chart primitives with no feature vocabulary
  hooks/          generic hooks
  lib/            generic pure helpers
  services/       generic IO helpers
  query/          QueryClient and cross-feature query key namespaces
  stores/         generic stores only
  types/          generic shared types only
```

Runtime WebSocket/bootstrap state is app infrastructure, not a reusable shared
store. Prefer `app/runtime/` for `useDevtools`, connection setup, the runtime
store, and reducer.

## Data Fetching Rules

- REST goes through TanStack Query hooks.
- Feature hooks live in `features/<feature>/hooks/`.
- Plain backend calls live in `features/<feature>/services/`.
- Shared fetch helpers live in `shared/services/`.
- Query client and top-level query key namespaces live in `shared/query/`.
- WebSocket push-only runtime state goes through the app runtime store.
- Local UI state stays component-local with `useState`.

## Migration Discipline

Use vertical, behavior-preserving slices:

1. Move one coherent slice.
2. Update imports.
3. Run focused type/tests where practical.
4. Update `FEATURE_STRUCTURE_PLAN.md` with the status.

Do not combine folder moves with behavior rewrites. If a hand-rolled fetcher is
touched, migrate it using the package-level TanStack Query guidance in
`../CLAUDE.md`.

## TypeScript Guidance

Prefer simple, explicit types over clever indirection. Preserve existing
discriminated unions for navigation/runtime events and keep exhaustiveness
checks intact. Avoid `any`; use `unknown` plus type guards when runtime input
needs narrowing.
