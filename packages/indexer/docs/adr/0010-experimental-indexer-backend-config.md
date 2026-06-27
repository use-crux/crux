# ADR 0010: Experimental Native Indexer Backend Config

Status: Accepted

Date: 2026-06-19

## Context

Phase 8 introduced interchangeable semantic backends behind Crux-owned
`SemanticBackend` and `SemanticCompilerView` contracts. The JavaScript TypeScript compiler API backend
is the default correctness baseline. TypeScript-Go is the first native engine implementation and has
exact normalized fact parity for the current semantic contract, but it uses an unstable
native-preview API and must remain an explicit experiment until upstream API stability and benchmark
confidence justify a default switch.

Crux already has a stable `indexer` config domain for policy such as extension trust and configured
extension references. Putting backend experiments under `indexer.semantic` would make an unstable
implementation selector look like durable product policy and would create a legacy shape to unwind
when the backend graduates.

## Decision

Unstable indexer implementation choices live under top-level `experimental.indexer`, following the
same graduation pattern used by tools such as Next.js:

```ts
import { config } from '@use-crux/core'

export default config({
  experimental: {
    indexer: {
      native: true,
      // or:
      // native: { engine: 'tsgo', tsserverPath: '/path/to/tsgo' },
    },
  },
})
```

`experimental.indexer.native` accepts:

- `true`: enable the default native semantic backend.
- `{ engine?: 'tsgo'; tsserverPath?: string }`: enable the native backend
  and pass engine-specific options.
- `false` or omission: keep the TypeScript compiler API backend as the default.

The public config does not expose `unstableApi` or a top-level `tsgo` backend flag. TypeScript-Go is
the first internal native engine, while the product-facing switch is native so a future Rust or mixed
engine can keep the same user contract.

Do not add `indexer.semantic`, `indexer.experimental_backend`, or other stable-looking semantic
backend switches before launch. Do not add a TypeScript fallback field to native config. This is a
hard migration; no legacy compatibility layer is required.

## Consequences

- `@use-crux/core` remains provider-agnostic and stores only inert config data.
- `@use-crux/indexer` owns backend selection and maps `experimental.indexer.native` to the internal
  native backend and engine selection.
- `crux config inspect` shows the experimental selection as effective config so users can verify the
  active backend without reading worker logs.
- When native indexing stabilizes, Crux can graduate the option into a stable backend/default policy
  without keeping the pre-launch nested semantic config shape or a TypeScript-Go-specific public flag.
- TypeScript remains the default correctness backend until upstream TypeScript-Go API stability and
  benchmark evidence support a switch.

## Validation

Implementation must keep coverage at these boundaries:

1. Core type tests accept `experimental.indexer.native: true | { engine?: 'tsgo'; tsserverPath?: string }`.
2. Core type tests reject `indexer.semantic` and native TypeScript-fallback config fields.
3. Indexer backend-selection tests map the experimental config to the internal native backend
   selection and leave omitted/false config on the default TypeScript backend.
4. Semantic service tests prove project config can select the native backend and produce
   facts through the same service path.
5. Parity tests compare normalized fact output from the TypeScript and native backends for
   shared fixtures and representative real packages.
6. CLI config-inspect tests render the experimental section in both configured and default states.
