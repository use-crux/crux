import { describe, expect, it, vi } from 'vitest'
import type { CruxObservabilityTransport } from '../src/observability'
import type { CruxPlugin } from '../src/runtime/plugin'
import type { CruxHooks, HooksLayerToken } from '../src/runtime/runtime'
import { node } from '../src/runtime/public'
import { inMemoryRecordStore } from '../src/storage'
import {
  createRuntimeConfigTransaction,
  planRuntimeConfig,
  type RuntimeConfigTransactionPorts,
} from '../src/runtime/config-transaction'

describe('runtime config transaction', () => {
  it('installs identity without taking transport ownership or suppressing devtools', () => {
    const identity = { projectId: 'checkout', deploymentId: 'preview-9' }
    const configure = vi.fn(() => () => undefined)
    const plan = planRuntimeConfig({
      config: {
        devtools: { serverUrl: 'http://localhost:4400' },
        observability: { identity },
      },
    })

    expect(plan.ownsObservability).toBe(false)
    expect(plan.observability).toEqual({ kind: 'identity', identity })
    expect(plan.plugins.map((plugin) => plugin.name)).toContain('crux:devtools')

    createRuntimeConfigTransaction(
      { config: { observability: { identity } } },
      { observability: { configure } },
    ).apply()

    expect(configure).toHaveBeenCalledWith({ identity })
  })

  it('rejects malformed identity while planning, before effect ports run', () => {
    expect(() =>
      createRuntimeConfigTransaction({
        config: {
          observability: {
            identity: { projectId: ' checkout ' },
            serverUrl: 'http://localhost:4400',
          },
        },
      }),
    ).toThrow()
  })

  it('plans default config without owning observability or plugins', () => {
    const plan = planRuntimeConfig({ config: {} })

    expect(plan.inert).toBe(false)
    expect(plan.ownsObservability).toBe(false)
    expect(plan.observability).toEqual({ kind: 'none' })
    expect(plan.hooksPatch).toEqual({})
    expect(plan.configureOptions).toEqual({ prompts: [] })
    expect(plan.plugins).toEqual([])
  })

  it('plans explicit observability as owned hook state and suppresses devtools transport ownership', () => {
    const transport: CruxObservabilityTransport = { send: vi.fn() }

    const plan = planRuntimeConfig({
      config: {
        devtools: { serverUrl: 'http://localhost:4400' },
        observability: { transport, delivery: { maxPendingDeliveries: 2 } },
      },
    })

    expect(plan.inert).toBe(false)
    expect(plan.ownsObservability).toBe(true)
    expect(plan.hooksPatch).toMatchObject({
      observabilityTransport: transport,
      observabilityDelivery: { maxPendingDeliveries: 2 },
    })
    expect(plan.configureOptions.devtools).toBeUndefined()
    expect(plan.bridgeOptions.devtools).toEqual({ serverUrl: 'http://localhost:4400' })
  })

  it('plans devtools fallback and user plugins for transaction install when observability does not own transport', () => {
    const plugin: CruxPlugin = { name: 'user-plugin', install: () => ({}) }

    const plan = planRuntimeConfig({
      config: {
        devtools: { serverUrl: 'http://localhost:4400' },
        plugins: [plugin],
      },
    })

    expect(plan.ownsObservability).toBe(false)
    expect(plan.plugins.map((plannedPlugin) => plannedPlugin.name)).toEqual([
      'crux:devtools',
      'user-plugin',
    ])
    expect(plan.plugins[1]).toBe(plugin)
    expect(plan.configureOptions).toEqual({ prompts: [] })
  })

  it('plans disabled observability as an owned hook clear before user plugins', () => {
    const plugin: CruxPlugin = { name: 'user-plugin', install: () => ({}) }

    const plan = planRuntimeConfig({
      config: {
        devtools: { serverUrl: 'http://localhost:4400' },
        observability: { enabled: false },
        plugins: [plugin],
      },
    })

    expect(plan.ownsObservability).toBe(true)
    expect(plan.observability).toEqual({ kind: 'owned' })
    expect(plan.hooksPatch).toMatchObject({
      observabilityTransport: undefined,
      observabilityDelivery: undefined,
    })
    expect(plan.configureOptions).toEqual({ prompts: [] })
    expect(plan.plugins).toEqual([plugin])
  })

  it('plans generation policy and observability capture without installing a transport', () => {
    const middleware: NonNullable<CruxHooks['middleware']> = async (args, next) => next(args)
    const tokenizer = (text: string) => text.length

    const plan = planRuntimeConfig({
      config: {
        generation: {
          middleware,
          tokenizer,
          autoEscape: false,
          securityWarnings: false,
        },
        observability: {
          recordInputs: false,
          recordOutputs: false,
        },
      },
    })

    expect(plan.ownsObservability).toBe(false)
    expect(plan.hooksPatch).toMatchObject({
      middleware,
      observabilityCapture: {
        recordInputs: false,
        recordOutputs: false,
      },
    })
    expect(plan.tokenizer).toBe(tokenizer)
    expect(plan.configureOptions.autoEscape).toBe(false)
    expect(plan.configureOptions.securityWarnings).toBe(false)
  })

  it('plans top-level runtime as an installed Runtime Engine definition', () => {
    const runtime = node({ autoStartMaintenance: false })

    const plan = planRuntimeConfig({ config: { runtime } })

    expect(plan.hooksPatch.runtimeEngine).toBe(runtime)
  })

  it('applies persistence and explicit observability before plugins run through ports', () => {
    const records = inMemoryRecordStore()
    const transport: CruxObservabilityTransport = { send: vi.fn() }
    const events: string[] = []
    let hooks: CruxHooks = {}
    const plugin: CruxPlugin = {
      name: 'hooks-aware-plugin',
      install(pluginHooks) {
        events.push('plugin')
        expect(pluginHooks.records).toBe(records)
        expect(pluginHooks.observabilityTransport).toBe(transport)
        return {}
      },
    }
    const ports: RuntimeConfigTransactionPorts = {
      hooks: {
        get() {
          return hooks
        },
        set(next) {
          hooks = { ...next }
          events.push('hooks:set')
        },
        update(patch) {
          hooks = { ...hooks, ...patch }
          events.push('hooks:update')
        },
        pushLayer(patch) {
          hooks = { ...hooks, ...patch }
          events.push('hooks:pushLayer')
          return fakeLayerToken
        },
        restoreLayer() {
          hooks = {}
          events.push('hooks:restoreLayer')
        },
      },
      observability: {
        configure() {
          events.push('observability:configure')
          return () => events.push('observability:restore')
        },
      },
    }

    const installation = createRuntimeConfigTransaction(
      {
        config: {
          persistence: { records },
          observability: { transport },
          plugins: [plugin],
        },
      },
      ports,
    ).apply()

    expect(events).toEqual(['observability:configure', 'plugin', 'hooks:pushLayer'])
    expect(installation.hooks.records).toBe(records)
    expect(installation.hooks.observabilityTransport).toBe(transport)

    installation.restore()
    expect(events.at(-1)).toBe('observability:restore')
  })

  it('restores hooks layer and plugin effects before observability ownership on dispose', () => {
    const events: string[] = []
    let hooks: CruxHooks = {}
    const ports: RuntimeConfigTransactionPorts = {
      hooks: {
        get: () => hooks,
        set(next) {
          hooks = { ...next }
        },
        update(patch) {
          hooks = { ...hooks, ...patch }
        },
        pushLayer(patch) {
          hooks = { ...hooks, ...patch }
          events.push('hooks:pushLayer')
          return fakeLayerToken
        },
        restoreLayer() {
          hooks = {}
          events.push('hooks:restoreLayer')
        },
      },
      observability: {
        configure() {
          events.push('observability:configure')
          return () => events.push('observability:restore')
        },
      },
      plugins: {
        apply(_plugins, currentHooks) {
          events.push('plugins:apply')
          return {
            hooks: currentHooks,
            dispose() {
              events.push('plugins:dispose')
            },
          }
        },
      },
    }

    const installation = createRuntimeConfigTransaction(
      {
        config: {
          observability: { transport: { send: vi.fn() } },
          plugins: [{ name: 'plugin', install: () => ({}) }],
        },
      },
      ports,
    ).apply()

    installation.restore()
    installation.restore()

    expect(events).toEqual([
      'observability:configure',
      'plugins:apply',
      'hooks:pushLayer',
      'hooks:restoreLayer',
      'plugins:dispose',
      'observability:restore',
    ])
  })

})

const fakeLayerToken = {} as HooksLayerToken
