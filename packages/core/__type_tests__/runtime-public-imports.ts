/**
 * Type-level characterization of the **runtime/config/plugin surface** of the
 * published `@use-crux/core` barrel.
 *
 * Companion to `public-root-imports.ts`, scoped to the types the structure
 * refactor relocates into `packages/core/runtime/` (`CruxConfig`, `CruxPlugin`,
 * `CruxHooks`, `CruxPluginResult`, `PromptMiddleware`). Imports come
 * exclusively from `@use-crux/core`, so the file must keep type-checking with
 * zero edits once the implementation moves into the `runtime/` domain.
 *
 * Runs under `tsc --noEmit` only — `expectTypeOf` assertions carry the
 * contract; nothing executes.
 *
 * Pins, per the naming/testing contract:
 * - `config()` accepts a `CruxConfig` and returns a `Crux` exposing the raw
 *   config;
 * - a `CruxPlugin.install()` returns a `CruxPluginResult` (partial hooks +
 *   optional dispose);
 * - the hook store is typed by `CruxHooks`;
 * - public runtime types stay strongly typed (no `any` leak);
 * - the surface uses TypeScript 5.5-compatible syntax.
 */

import { expectTypeOf } from 'vitest'
import {
  config,
  mergeHooks,
  applyPlugins,
  getHooks,
  pushHooksLayer,
  restoreHooksLayer,
} from '@use-crux/core'
import type {
  Crux,
  CruxConfig,
  CruxPlugin,
  CruxPluginResult,
  CruxHooks,
  HooksLayerToken,
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
// CruxPlugin — install returns a partial hook patch
// ─────────────────────────────────────────────────────────────────

const tracer: CruxPlugin = {
  name: 'tracer',
  install(hooks) {
    expectTypeOf(hooks).toEqualTypeOf<Readonly<CruxHooks>>()
    return {
      dispose: () => {},
    }
  },
}

expectTypeOf(tracer.install).returns.toEqualTypeOf<CruxPluginResult>()

// ─────────────────────────────────────────────────────────────────
// mergeHooks / applyPlugins / getHooks — hook-typed seams
// ─────────────────────────────────────────────────────────────────

expectTypeOf(mergeHooks).returns.toEqualTypeOf<CruxHooks>()
expectTypeOf(applyPlugins).returns.toMatchTypeOf<{ hooks: CruxHooks; dispose: () => void }>()
expectTypeOf(getHooks()).toEqualTypeOf<Readonly<CruxHooks>>()
expectTypeOf(pushHooksLayer).returns.toEqualTypeOf<HooksLayerToken>()
expectTypeOf(restoreHooksLayer).parameter(0).toEqualTypeOf<HooksLayerToken>()

// `middleware` on the hooks store is a `PromptMiddleware | undefined`, never `any`.
expectTypeOf<CruxHooks['middleware']>().toEqualTypeOf<PromptMiddleware | undefined>()
