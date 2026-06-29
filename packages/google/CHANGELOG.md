# @use-crux/google

## 0.3.0

### Minor Changes

- 2e62441: Deepen Google CachedContent into a single `GoogleCachedContentLifecycle`. `createGoogle({ cachedContent })` now resolves one lifecycle that owns prefix detection, cache keying/reuse, SDK cache operations, and fallback policy, returning a request-ready config patch that both `generate()` and `stream()` merge.
  - Configure the built-in lifecycle with `GoogleCacheConfig` (`defaultTtlSeconds`, `maxEntries`, `onError: 'fallback' | 'throw'`, or a custom `GoogleCachedContentCachePort`), pass `false` to disable, or pass a fully custom `GoogleCachedContentLifecycle`.
  - Invalid TTL/config values are rejected (per-call TTL overrides fall back to the default; bad `defaultTtlSeconds`/`maxEntries` throw a clear error).
  - New exports: `GoogleCacheConfig`, `GoogleCacheName`, `GoogleCachedContentCachePort`, `GoogleCachedContentErrorMode`, `GoogleCachedContentLifecycle`, `GoogleCachedContentOption`, `GoogleCachedContentPlan`, `GoogleCachedContentPrepareArgs`.

### Patch Changes

- 53b04a3: Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- Updated dependencies [2cd8c52]
- Updated dependencies [890d660]
- Updated dependencies [53b04a3]
- Updated dependencies [5477724]
- Updated dependencies [a9fd8f9]
- Updated dependencies [fd4b17f]
- Updated dependencies [5a164be]
  - @use-crux/core@0.3.0

## 0.2.0

### Minor Changes

- 96fb6b7: Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.

### Patch Changes

- Updated dependencies [96fb6b7]
  - @use-crux/core@0.2.0
