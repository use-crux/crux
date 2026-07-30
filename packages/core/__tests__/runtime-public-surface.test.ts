/**
 * Characterization tests for the **runtime public surface** of `@use-crux/core`.
 *
 * Companion to `public-import-surface.test.ts`, scoped to the runtime/config/
 * plugin/hook domain that the structure refactor relocates into
 * `packages/core/src/runtime/`. Every assertion imports through the **package
 * specifier** (`@use-crux/core`), never a relative path, so the suite is immune
 * to internal file moves: when `config.ts`, `runtime.ts`, `plugin.ts`,
 * `middleware.ts`, `configure.ts`, and `execution-context.ts` migrate into the
 * `runtime/` domain, these tests must stay green without edits.
 *
 * What this suite pins:
 * - the documented runtime values resolve and are callable;
 * - `config()` applies persistence + returns a frozen `Crux`;
 * - the hooks store round-trips via `setHooks`/`getHooks`/
 *   `updateHooks`/`resetHooks`;
 * - `mergeHooks`/`applyPlugins` compose plugin hook patches;
 * - the execution-context helpers propagate session metadata.
 */

import { describe, it, expect } from 'vitest'
import {
  config,
  getHooks,
  pushHooksLayer,
  setHooks,
  updateHooks,
  resetHooks,
  restoreHooksLayer,
  resolveRecords,
  mergeHooks,
  applyPlugins,
  withSession,
  createSessionId,
  getExecutionContext,
  runWithExecutionContext,
  inMemoryRecordStore,
} from '@use-crux/core'
import type { CruxHooks, CruxPlugin } from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Documented runtime entry points
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core (runtime surface)', () => {
  it('exposes the documented runtime values', () => {
    expect(typeof config).toBe('function')
    expect(typeof getHooks).toBe('function')
    expect(typeof pushHooksLayer).toBe('function')
    expect(typeof setHooks).toBe('function')
    expect(typeof updateHooks).toBe('function')
    expect(typeof resetHooks).toBe('function')
    expect(typeof restoreHooksLayer).toBe('function')
    expect(typeof resolveRecords).toBe('function')
    expect(typeof mergeHooks).toBe('function')
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
  it('applies storage and returns a frozen Crux with the raw config', () => {
    const records = inMemoryRecordStore()
    const crux = config({ storage: { records } })

    try {
      expect(Object.isFrozen(crux)).toBe(true)
      expect(crux.config.storage?.records).toBe(records)
      expect(resolveRecords()).toBe(records)
      expect(typeof crux.dispose).toBe('function')
    } finally {
      crux.dispose()
    }
  })

  it('installs generation middleware and plugins through the public config surface', () => {
    resetHooks()
    const events: string[] = []
    const middleware: NonNullable<CruxHooks['middleware']> = (args, next) => next(args)
    const plugin: CruxPlugin = {
      name: 'public-config-plugin',
      install(hooks) {
        events.push(hooks.middleware === middleware ? 'saw-middleware' : 'missing-middleware')
        return { semanticCacheInstalled: true }
      },
    }

    const crux = config({
      generation: { middleware },
      plugins: [plugin],
    })

    try {
      expect(events).toEqual(['saw-middleware'])
      expect(getHooks().middleware).toBe(middleware)
      expect(getHooks().semanticCacheInstalled).toBe(true)
    } finally {
      crux.dispose()
    }
  })
})

// ─────────────────────────────────────────────────────────────────
// Runtime hook store
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core hooks store', () => {
  it('round-trips hook state and clears on reset', () => {
    resetHooks()
    expect(getHooks()).toEqual({})

    const middleware: NonNullable<CruxHooks['middleware']> = (args, next) => next(args)
    setHooks({ middleware })
    expect(getHooks().middleware).toBe(middleware)

    updateHooks({ semanticCacheInstalled: true })
    expect(getHooks().middleware).toBe(middleware)
    expect(getHooks().semanticCacheInstalled).toBe(true)

    resetHooks()
    expect(getHooks()).toEqual({})
  })

    it('getHooks() returns a frozen snapshot', () => {
    resetHooks()
    expect(Object.isFrozen(getHooks())).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Plugin composition
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core plugin composition', () => {
  it('applyPlugins installs ordered plugins and disposes in reverse', () => {
    const order: string[] = []
    const plugins: CruxPlugin[] = [
      { name: 'first', install: () => ({ dispose: () => order.push('dispose:first') }) },
      { name: 'second', install: () => ({ dispose: () => order.push('dispose:second') }) },
    ]

    const { hooks, dispose } = applyPlugins(plugins, {})
    expect(hooks).toBeDefined()
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
