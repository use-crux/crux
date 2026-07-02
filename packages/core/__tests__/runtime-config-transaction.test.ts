import { describe, expect, it, vi } from 'vitest'
import type { CruxObservabilityTransport } from '../observability'
import type { CruxPlugin } from '../runtime/plugin'
import type { CruxRuntime } from '../runtime/runtime'
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
    expect(plan.configureOptions).toEqual({ prompts: [], plugins: undefined })
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

  it('plans devtools fallback and user plugins for configure() when observability does not own transport', () => {
    const plugin: CruxPlugin = { name: 'user-plugin', install: () => ({}) }

    const plan = planRuntimeConfig({
      config: {
        devtools: { serverUrl: 'http://localhost:4400' },
        plugins: [plugin],
      },
    })

    expect(plan.ownsObservability).toBe(false)
    expect(plan.plugins).toEqual([])
    expect(plan.configureOptions.devtools).toEqual({ serverUrl: 'http://localhost:4400' })
    expect(plan.configureOptions.plugins).toEqual([plugin])
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
    expect(plan.configureOptions.devtools).toBeUndefined()
    expect(plan.configureOptions.plugins).toBeUndefined()
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

    expect(events).toEqual(['observability:configure', 'runtime:update', 'plugin', 'runtime:set'])
    expect(installation.runtime.records).toBe(records)
    expect(installation.runtime.observabilityTransport).toBe(transport)

    installation.restore()
    expect(events.at(-1)).toBe('observability:restore')
  })

  it('restores plugin effects before observability ownership on dispose', () => {
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

    expect(events).toEqual(['observability:configure', 'plugins:apply', 'plugins:dispose', 'observability:restore'])
  })

  it('keeps CRUX_INDEX mode inert and avoids every side-effect port', () => {
    const ports: RuntimeConfigTransactionPorts = {
      runtime: {
        get: vi.fn(() => ({ marker: true }) as CruxRuntime),
        set: vi.fn(),
        update: vi.fn(),
      },
      observability: {
        createHttpTransport: vi.fn(),
        configure: vi.fn(),
      },
      bridge: {
        connect: vi.fn(),
      },
      tokenizer: {
        setTokenizer: vi.fn(),
      },
      plugins: {
        apply: vi.fn(),
      },
    }

    const transaction = createRuntimeConfigTransaction(
      {
        env: { CRUX_INDEX: '1' },
        config: {
          persistence: { records: inMemoryRecordStore() },
          generation: {
            middleware: async (args, next) => next(args),
            tokenizer: (text) => text.length,
          },
          observability: { serverUrl: 'https://collector.example.com' },
          devtools: { serverUrl: 'http://localhost:4400', bridge: true },
          plugins: [{ name: 'ignored-plugin', install: vi.fn(() => ({})) }],
        },
      },
      ports,
    )

    const installation = transaction.apply()
    const crux = transaction.createCrux()

    expect(transaction.inert).toBe(true)
    expect(installation.connectBridge({ ...crux })).toBeUndefined()
    expect(ports.runtime?.get).not.toHaveBeenCalled()
    expect(ports.runtime?.set).not.toHaveBeenCalled()
    expect(ports.runtime?.update).not.toHaveBeenCalled()
    expect(ports.observability?.createHttpTransport).not.toHaveBeenCalled()
    expect(ports.observability?.configure).not.toHaveBeenCalled()
    expect(ports.bridge?.connect).not.toHaveBeenCalled()
    expect(ports.tokenizer?.setTokenizer).not.toHaveBeenCalled()
    expect(ports.plugins?.apply).not.toHaveBeenCalled()
    expect(crux.config.observability?.serverUrl).toBe('https://collector.example.com')
  })
})
