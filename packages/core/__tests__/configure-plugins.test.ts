import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../runtime/config'
import type { CruxPlugin } from '../runtime/plugin'
import { resetHooks } from '../runtime/runtime'

describe('config — plugins', () => {
  beforeEach(() => {
    resetHooks()
  })

  afterEach(() => {
    resetHooks()
  })

  it('calls plugin install() with the current hooks', () => {
    const install = vi.fn().mockReturnValue({})
    const plugin: CruxPlugin = { name: 'test-plugin', install }

    const crux = config({ plugins: [plugin] })

    try {
      expect(install).toHaveBeenCalledOnce()
      const receivedHooks = install.mock.calls[0][0]
      expect(Object.isFrozen(receivedHooks)).toBe(true)
    } finally {
      crux.dispose()
    }
  })

  it("second plugin sees first plugin's hooks", () => {
    const hook1 = vi.fn()
    const seenHooks: Record<string, unknown>[] = []
    const plugin1: CruxPlugin = {
      name: 'plugin-1',
      install() {
        return { executionHook: hook1 }
      },
    }
    const plugin2: CruxPlugin = {
      name: 'plugin-2',
      install(hooks) {
        seenHooks.push({ ...hooks })
        return {}
      },
    }

    const crux = config({ plugins: [plugin1, plugin2] })

    try {
      expect(seenHooks[0].executionHook).toBeDefined()
    } finally {
      crux.dispose()
    }
  })

  it('dispose() calls plugin dispose in reverse order', () => {
    const order: string[] = []
    const plugin1: CruxPlugin = {
      name: 'p1',
      install: () => ({ dispose: () => order.push('p1-dispose') }),
    }
    const plugin2: CruxPlugin = {
      name: 'p2',
      install: () => ({ dispose: () => order.push('p2-dispose') }),
    }

    const crux = config({ plugins: [plugin1, plugin2] })
    crux.dispose()

    expect(order).toEqual(['p2-dispose', 'p1-dispose'])
  })

  it('works unchanged when no plugins are provided', () => {
    const crux = config({})

    try {
      expect(crux.config).toEqual({})
    } finally {
      crux.dispose()
    }
  })
})
