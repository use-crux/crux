---
'@use-crux/google': minor
---

Deepen Google CachedContent into a single `GoogleCachedContentLifecycle`. `createGoogle({ cachedContent })` now resolves one lifecycle that owns prefix detection, cache keying/reuse, SDK cache operations, and fallback policy, returning a request-ready config patch that both `generate()` and `stream()` merge.

- Configure the built-in lifecycle with `GoogleCacheConfig` (`defaultTtlSeconds`, `maxEntries`, `onError: 'fallback' | 'throw'`, or a custom `GoogleCachedContentCachePort`), pass `false` to disable, or pass a fully custom `GoogleCachedContentLifecycle`.
- Invalid TTL/config values are rejected (per-call TTL overrides fall back to the default; bad `defaultTtlSeconds`/`maxEntries` throw a clear error).
- New exports: `GoogleCacheConfig`, `GoogleCacheName`, `GoogleCachedContentCachePort`, `GoogleCachedContentErrorMode`, `GoogleCachedContentLifecycle`, `GoogleCachedContentOption`, `GoogleCachedContentPlan`, `GoogleCachedContentPrepareArgs`.
