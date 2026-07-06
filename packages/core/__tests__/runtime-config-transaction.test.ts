import { describe, expect, it, vi } from 'vitest'
import type { CruxObservabilityTransport } from '../observability'
import type { CruxPlugin } from '../runtime/plugin'
import type { CruxRuntime, HooksLayerToken } from '../runtime/runtime'
import { node } from '../runtime/public'
import { inMemoryRecordStore } from '../storage'
import {
  createRuntimeConfigTransaction,
  planRuntimeConfig,
  type RuntimeConfigTransactionPorts,
} from '../runtime/config-transaction'

describe('runtime config transaction', () => {
  it('plans default config without owning observability or plugins', () => {
    const plan = planRuntimeConfig({ config: {} })

    expect(plan.inert).toBe(false)
    expect(plan.ownsObservability).toBe(false)
    expect(plan.observability).toEqual({ kind: 'none' })
    expect(plan.runtimePatch).toEqual({})
    expect(plan.configureOptions).toEqual({ prompts: [] })
    expect(plan.plugins).toEqual([])
  })

  it('plans explicit observability as owned runtime state and suppresses devtools transport ownership', () => {
    const transport: CruxObservabilityTransport = { send: vi.fn() }

    const plan = planRuntimeConfig({
      config: {
        devtools: { serverUrl: 'http://localhost:4400' },
        observability: { transport, delivery: { maxPendingDeliveries: 2 } },
      },
    })

    expect(plan.inert).toBe(false)
    expect(plan.ownsObservability).toBe(true)
    expect(plan.runtimePatch).toMatchObject({
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

  it('plans disabled observability as an owned runtime clear before user plugins', () => {
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
    expect(plan.runtimePatch).toMatchObject({
      observabilityTransport: undefined,
      observabilityDelivery: undefined,
    })
    expect(plan.configureOptions).toEqual({ prompts: [] })
    expect(plan.plugins).toEqual([plugin])
  })

  it('plans generation policy and observability capture without installing a transport', () => {
    const middleware: NonNullable<CruxRuntime['middleware']> = async (args, next) => next(args)
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
    expect(plan.runtimePatch).toMatchObject({
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

    expect(plan.runtimePatch.runtimeEngine).toBe(runtime)
  })

  it('applies persistence and explicit observability before plugins run through ports', () => {
    const records = inMemoryRecordStore()
    const transport: CruxObservabilityTransport = { send: vi.fn() }
    const events: string[] = []
    let runtime: CruxRuntime = {}
    const plugin: CruxPlugin = {
      name: 'runtime-aware-plugin',
      install(pluginRuntime) {
        events.push('plugin')
        expect(pluginRuntime.records).toBe(records)
        expect(pluginRuntime.observabilityTransport).toBe(transport)
        return {}
      },
    }
    const ports: RuntimeConfigTransactionPorts = {
      runtime: {
        get() {
          return runtime
        },
        set(next) {
          runtime = { ...next }
          events.push('runtime:set')
        },
        update(patch) {
          runtime = { ...runtime, ...patch }
          events.push('runtime:update')
        },
        pushLayer(patch) {
          runtime = { ...runtime, ...patch }
          events.push('runtime:pushLayer')
          return fakeLayerToken
        },
        restoreLayer() {
          runtime = {}
          events.push('runtime:restoreLayer')
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

    expect(events).toEqual(['observability:configure', 'plugin', 'runtime:pushLayer'])
    expect(installation.runtime.records).toBe(records)
    expect(installation.runtime.observabilityTransport).toBe(transport)

    installation.restore()
    expect(events.at(-1)).toBe('observability:restore')
  })

  it('restores runtime layer and plugin effects before observability ownership on dispose', () => {
    const events: string[] = []
    let runtime: CruxRuntime = {}
    const ports: RuntimeConfigTransactionPorts = {
      runtime: {
        get: () => runtime,
        set(next) {
          runtime = { ...next }
        },
        update(patch) {
          runtime = { ...runtime, ...patch }
        },
        pushLayer(patch) {
          runtime = { ...runtime, ...patch }
          events.push('runtime:pushLayer')
          return fakeLayerToken
        },
        restoreLayer() {
          runtime = {}
          events.push('runtime:restoreLayer')
        },
      },
      observability: {
        configure() {
          events.push('observability:configure')
          return () => events.push('observability:restore')
        },
      },
      plugins: {
        apply(_plugins, currentRuntime) {
          events.push('plugins:apply')
          return {
            runtime: currentRuntime,
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
      'runtime:pushLayer',
      'runtime:restoreLayer',
      'plugins:dispose',
      'observability:restore',
    ])
  })

})

const fakeLayerToken = {} as HooksLayerToken
