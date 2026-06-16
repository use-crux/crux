import { describe, expect, it, vi } from 'vitest'
import { enableQualityRunnerObservability, flushQualityRunnerObservability } from './quality-observability'

describe('quality runner observability', () => {
  it('installs an HTTP transport when devtools gave the runner a server URL', () => {
    type Transport = { readonly id: string }
    let active: Transport | undefined
    const restore = vi.fn(() => {
      active = undefined
    })
    const core = {
      currentObservabilityTransport: () => active,
      createHttpObservabilityTransport: vi.fn((options: { serverUrl?: string }) => ({
        id: options.serverUrl ?? '',
      })),
      setObservabilityTransport: vi.fn((transport: Transport | undefined) => {
        active = transport
        return restore
      }),
      observe: { flush: vi.fn(async () => true) },
    }

    const cleanup = enableQualityRunnerObservability(core, 'http://localhost:4400')

    expect(core.createHttpObservabilityTransport).toHaveBeenCalledWith({ serverUrl: 'http://localhost:4400' })
    expect(core.setObservabilityTransport).toHaveBeenCalledWith({ id: 'http://localhost:4400' })
    cleanup?.()
    expect(restore).toHaveBeenCalled()
  })

  it('preserves an already configured project observability transport', () => {
    const existing = { id: 'project' }
    const core = {
      currentObservabilityTransport: () => existing,
      createHttpObservabilityTransport: vi.fn((options: { serverUrl?: string }) => ({
        id: options.serverUrl ?? '',
      })),
      setObservabilityTransport: vi.fn(() => () => undefined),
      observe: { flush: vi.fn(async () => true) },
    }

    const cleanup = enableQualityRunnerObservability(core, 'http://localhost:4400')

    expect(cleanup).toBeUndefined()
    expect(core.createHttpObservabilityTransport).not.toHaveBeenCalled()
    expect(core.setObservabilityTransport).not.toHaveBeenCalled()
  })

  it('ignores non-local devtools URLs from auto-attach input', () => {
    const core = {
      currentObservabilityTransport: () => undefined,
      createHttpObservabilityTransport: vi.fn((options: { serverUrl?: string }) => ({
        id: options.serverUrl ?? '',
      })),
      setObservabilityTransport: vi.fn(() => () => undefined),
      observe: { flush: vi.fn(async () => true) },
    }

    const cleanup = enableQualityRunnerObservability(core, 'https://telemetry.example.com')

    expect(cleanup).toBeUndefined()
    expect(core.createHttpObservabilityTransport).not.toHaveBeenCalled()
    expect(core.setObservabilityTransport).not.toHaveBeenCalled()
  })

  it('normalizes websocket loopback URLs before installing auto-attach', () => {
    const core = {
      currentObservabilityTransport: () => undefined,
      createHttpObservabilityTransport: vi.fn((options: { serverUrl?: string }) => ({
        id: options.serverUrl ?? '',
      })),
      setObservabilityTransport: vi.fn(() => () => undefined),
      observe: { flush: vi.fn(async () => true) },
    }

    enableQualityRunnerObservability(core, 'ws://127.0.0.1:4400/')

    expect(core.createHttpObservabilityTransport).toHaveBeenCalledWith({ serverUrl: 'http://127.0.0.1:4400' })
  })

  it('flushes queued observability records before the worker exits', async () => {
    const core = {
      observe: { flush: vi.fn(async () => true) },
    }

    await flushQualityRunnerObservability(core, 1234)

    expect(core.observe.flush).toHaveBeenCalledWith({ timeoutMs: 1234 })
  })
})
