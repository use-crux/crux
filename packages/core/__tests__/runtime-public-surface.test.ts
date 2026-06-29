/**
 * Characterization tests for the **runtime public surface** of `@use-crux/core`.
 *
 * Companion to `public-import-surface.test.ts`, scoped to the runtime/config/
 * plugin/hook domain that the structure refactor relocates into
 * `packages/core/runtime/`. Every assertion imports through the **package
 * specifier** (`@use-crux/core`), never a relative path, so the suite is immune
 * to internal file moves: when `config.ts`, `runtime.ts`, `plugin.ts`,
 * `middleware.ts`, `configure.ts`, and `execution-context.ts` migrate into the
 * `runtime/` domain, these tests must stay green without edits.
 *
 * What this suite pins:
 * - the documented runtime values resolve and are callable;
 * - `config()` applies persistence + returns a frozen `Crux`;
 * - the runtime hook store round-trips via `setRuntime`/`getRuntime`/
 *   `updateRuntime`/`resetRuntime`;
 * - `mergeRuntime`/`applyPlugins` compose plugin runtime patches;
 * - the execution-context helpers propagate session metadata.
 */

import { describe, it, expect } from 'vitest'
import {
  config,
  getRuntime,
  setRuntime,
  updateRuntime,
  resetRuntime,
  resolveStore,
  mergeRuntime,
  applyPlugins,
  withSession,
  createSessionId,
  getExecutionContext,
  runWithExecutionContext,
  inMemoryCruxStore,
} from '@use-crux/core'
import type { CruxPlugin, CruxRuntime } from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Documented runtime entry points
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core (runtime surface)', () => {
  it('exposes the documented runtime values', () => {
    expect(typeof config).toBe('function')
    expect(typeof getRuntime).toBe('function')
    expect(typeof setRuntime).toBe('function')
    expect(typeof updateRuntime).toBe('function')
    expect(typeof resetRuntime).toBe('function')
    expect(typeof resolveStore).toBe('function')
    expect(typeof mergeRuntime).toBe('function')
    expect(typeof applyPlugins).toBe('function')
    expect(typeof withSession).toBe('function')
    expect(typeof createSessionId).toBe('function')
    expect(typeof getExecutionContext).toBe('function')
    expect(typeof runWithExecutionContext).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────
// config() — single configuration entry point
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core config()', () => {
  it('applies persistence and returns a frozen Crux with the raw config', () => {
    const store = inMemoryCruxStore()
    const crux = config({ persistence: { store } })

    try {
      expect(Object.isFrozen(crux)).toBe(true)
      expect(crux.config.persistence?.store).toBe(store)
      expect(resolveStore()).toBe(store)
      expect(typeof crux.dispose).toBe('function')
    } finally {
      crux.dispose()
    }
  })
})

// ─────────────────────────────────────────────────────────────────
// Runtime hook store
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core runtime hook store', () => {
  it('round-trips runtime state and clears on reset', () => {
    resetRuntime()
    expect(getRuntime()).toEqual({})

    const middleware: NonNullable<CruxRuntime['middleware']> = (args, next) => next(args)
    setRuntime({ middleware })
    expect(getRuntime().middleware).toBe(middleware)

    updateRuntime({ semanticCacheInstalled: true })
    expect(getRuntime().middleware).toBe(middleware)
    expect(getRuntime().semanticCacheInstalled).toBe(true)

    resetRuntime()
    expect(getRuntime()).toEqual({})
  })

  it('getRuntime() returns a frozen snapshot', () => {
    resetRuntime()
    expect(Object.isFrozen(getRuntime())).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Plugin composition
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core plugin composition', () => {
  it('mergeRuntime fans out instrumentation hooks', () => {
    const calls: string[] = []
    const merged = mergeRuntime(
      { instrumentationHooks: { onToolStart: () => calls.push('a') } },
      { instrumentationHooks: { onToolStart: () => calls.push('b') } },
    )

    merged.instrumentationHooks?.onToolStart?.({ toolCallId: '1', toolName: 't', args: {} })
    expect(calls).toEqual(['a', 'b'])
  })

  it('applyPlugins installs ordered plugins and disposes in reverse', () => {
    const order: string[] = []
    const plugins: CruxPlugin[] = [
      { name: 'first', install: () => ({ dispose: () => order.push('dispose:first') }) },
      { name: 'second', install: () => ({ dispose: () => order.push('dispose:second') }) },
    ]

    const { runtime, dispose } = applyPlugins(plugins, {})
    expect(runtime).toBeDefined()
    dispose()
    expect(order).toEqual(['dispose:second', 'dispose:first'])
  })
})

// ─────────────────────────────────────────────────────────────────
// Execution context propagation
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core execution context', () => {
  it('propagates session id through runWithExecutionContext/withSession', () => {
    const sessionId = createSessionId()
    expect(sessionId).toMatch(/^session-/)

    const seen = runWithExecutionContext({ sessionId }, () => {
      return withSession('nested', () => getExecutionContext()?.sessionId)
    })

    expect(seen).toBe('nested')
    expect(getExecutionContext()).toBeUndefined()
  })
})
