import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimeConfigTransaction,
  type RuntimeConfigTransactionPorts,
} from '../runtime/config-transaction'
import type { CruxRuntime, HooksLayerToken } from '../runtime/runtime'
import { inMemoryRecordStore } from '../storage'

describe('runtime config transaction — inert mode', () => {
  it('keeps CRUX_INDEX mode inert and avoids every side-effect port', () => {
    const ports: RuntimeConfigTransactionPorts = {
      runtime: {
        get: vi.fn(() => ({ marker: true }) as CruxRuntime),
        set: vi.fn(),
        update: vi.fn(),
        pushLayer: vi.fn(() => fakeLayerToken),
        restoreLayer: vi.fn(),
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
    expect(ports.runtime?.pushLayer).not.toHaveBeenCalled()
    expect(ports.runtime?.restoreLayer).not.toHaveBeenCalled()
    expect(ports.observability?.createHttpTransport).not.toHaveBeenCalled()
    expect(ports.observability?.configure).not.toHaveBeenCalled()
    expect(ports.bridge?.connect).not.toHaveBeenCalled()
    expect(ports.tokenizer?.setTokenizer).not.toHaveBeenCalled()
    expect(ports.plugins?.apply).not.toHaveBeenCalled()
    expect(crux.config.observability?.serverUrl).toBe('https://collector.example.com')
  })
})

const fakeLayerToken = {} as HooksLayerToken
