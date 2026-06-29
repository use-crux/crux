/**
 * Type-level characterization of the **runtime/config/plugin surface** of the
 * published `@use-crux/core` barrel.
 *
 * Companion to `public-root-imports.ts`, scoped to the types the structure
 * refactor relocates into `packages/core/runtime/` (`CruxConfig`, `CruxPlugin`,
 * `CruxRuntime`, `CruxPluginResult`, `PromptMiddleware`). Imports come
 * exclusively from `@use-crux/core`, so the file must keep type-checking with
 * zero edits once the implementation moves into the `runtime/` domain.
 *
 * Runs under `tsc --noEmit` only — `expectTypeOf` assertions carry the
 * contract; nothing executes.
 *
 * Pins, per the naming/testing contract:
 * - `config()` accepts a `CruxConfig` and returns a `Crux` exposing the raw
 *   config;
 * - a `CruxPlugin.install()` returns a `CruxPluginResult` (partial runtime +
 *   optional dispose);
 * - the runtime store is typed by `CruxRuntime`;
 * - public runtime types stay strongly typed (no `any` leak);
 * - the surface uses TypeScript 5.5-compatible syntax.
 */

import { expectTypeOf } from 'vitest'
import { config, mergeRuntime, applyPlugins, getRuntime } from '@use-crux/core'
import type {
  Crux,
  CruxConfig,
  CruxPlugin,
  CruxPluginResult,
  CruxRuntime,
  PromptMiddleware,
} from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// config() — input/output contract
// ─────────────────────────────────────────────────────────────────

expectTypeOf(config).parameter(0).toEqualTypeOf<CruxConfig>()
expectTypeOf(config).returns.toEqualTypeOf<Crux>()

declare const crux: Crux
expectTypeOf(crux.config).toEqualTypeOf<Readonly<CruxConfig>>()
expectTypeOf(crux.dispose).toEqualTypeOf<() => void>()

// `generation.middleware` is a `PromptMiddleware`, not `any`.
expectTypeOf<NonNullable<NonNullable<CruxConfig['generation']>['middleware']>>().toEqualTypeOf<PromptMiddleware>()

// ─────────────────────────────────────────────────────────────────
// CruxPlugin — install returns a partial runtime patch
// ─────────────────────────────────────────────────────────────────

const tracer: CruxPlugin = {
  name: 'tracer',
  install(runtime) {
    expectTypeOf(runtime).toEqualTypeOf<Readonly<CruxRuntime>>()
    return {
      dispose: () => {},
    }
  },
}

expectTypeOf(tracer.install).returns.toEqualTypeOf<CruxPluginResult>()

// ─────────────────────────────────────────────────────────────────
// mergeRuntime / applyPlugins / getRuntime — runtime-typed seams
// ─────────────────────────────────────────────────────────────────

expectTypeOf(mergeRuntime).returns.toEqualTypeOf<CruxRuntime>()
expectTypeOf(applyPlugins).returns.toMatchTypeOf<{ runtime: CruxRuntime; dispose: () => void }>()
expectTypeOf(getRuntime()).toEqualTypeOf<Readonly<CruxRuntime>>()

// `middleware` on the runtime is a `PromptMiddleware | undefined`, never `any`.
expectTypeOf<CruxRuntime['middleware']>().toEqualTypeOf<PromptMiddleware | undefined>()
