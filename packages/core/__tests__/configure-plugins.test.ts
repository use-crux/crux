import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../runtime/config'
import type { CruxPlugin } from '../runtime/plugin'
import { resetRuntime } from '../runtime/runtime'

describe('config — plugins', () => {
  beforeEach(() => {
    resetRuntime()
  })

  afterEach(() => {
    resetRuntime()
  })

  it('calls plugin install() with the current runtime', () => {
    const install = vi.fn().mockReturnValue({})
    const plugin: CruxPlugin = { name: 'test-plugin', install }

    const crux = config({ plugins: [plugin] })

    try {
      expect(install).toHaveBeenCalledOnce()
      const receivedRuntime = install.mock.calls[0][0]
      expect(Object.isFrozen(receivedRuntime)).toBe(true)
    } finally {
      crux.dispose()
    }
  })

  it("second plugin sees first plugin's hooks in the runtime", () => {
    const hook1 = vi.fn()
    const seenRuntimes: Record<string, unknown>[] = []
    const plugin1: CruxPlugin = {
      name: 'plugin-1',
      install() {
        return { executionHook: hook1 }
      },
    }
    const plugin2: CruxPlugin = {
      name: 'plugin-2',
      install(runtime) {
        seenRuntimes.push({ ...runtime })
        return {}
      },
    }

    const crux = config({ plugins: [plugin1, plugin2] })

    try {
      expect(seenRuntimes[0].executionHook).toBeDefined()
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
