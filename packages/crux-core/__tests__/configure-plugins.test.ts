import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configure } from '../configure'
import { prompt as cruxPrompt } from '../define'
import { getRuntime, resetRuntime } from '../runtime'
import type { CruxPlugin } from '../plugin'

function makePrompt(id: string) {
  return cruxPrompt({ id, system: `Prompt ${id}` })
}

describe('configure — plugins', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('calls plugin install() with the current runtime', () => {
    const install = vi.fn().mockReturnValue({})
    const plugin: CruxPlugin = { name: 'test-plugin', install }

    const reg = configure({ prompts: [makePrompt('a')], plugins: [plugin] })

    expect(install).toHaveBeenCalledOnce()
    // install receives a runtime object (frozen snapshot)
    const receivedRuntime = install.mock.calls[0][0]
    expect(receivedRuntime).toBeDefined()
    expect(typeof receivedRuntime).toBe('object')

    reg.dispose()
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

    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [plugin1, plugin2],
    })

    // plugin-2 should have seen plugin-1's executionHook
    expect(seenRuntimes[0].executionHook).toBeDefined()

    reg.dispose()
  })

  it('plugin hooks are active in the global runtime after configure', () => {
    const hook = vi.fn()
    const plugin: CruxPlugin = {
      name: 'hook-plugin',
      install() {
        return {
          instrumentationHooks: { onToolStart: hook },
        }
      },
    }

    const reg = configure({ prompts: [makePrompt('a')], plugins: [plugin] })

    // The hook should be installed in the global runtime
    const rt = getRuntime()
    rt.instrumentationHooks?.onToolStart?.({
      toolCallId: 'tc1',
      toolName: 'test',
      args: {},
    })
    expect(hook).toHaveBeenCalledOnce()

    reg.dispose()
  })

  it('dispose() calls plugin dispose in reverse order before resetRuntime', () => {
    const order: string[] = []
    const plugin1: CruxPlugin = {
      name: 'p1',
      install: () => ({ dispose: () => order.push('p1-dispose') }),
    }
    const plugin2: CruxPlugin = {
      name: 'p2',
      install: () => ({ dispose: () => order.push('p2-dispose') }),
    }

    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [plugin1, plugin2],
    })

    reg.dispose()
    expect(order).toEqual(['p2-dispose', 'p1-dispose'])
  })

  it('works unchanged when no plugins are provided', () => {
    const reg = configure({ prompts: [makePrompt('a')] })
    expect(reg.get('a')).toBeDefined()
    reg.dispose()
  })
})
