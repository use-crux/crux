import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimeConfigTransaction,
  type RuntimeConfigTransactionPorts,
} from '../src/runtime/config-transaction'
import type { CruxHooks, HooksLayerToken } from '../src/runtime/runtime'
import { inMemoryRecordStore } from '../src/storage'

describe('runtime config transaction — inert mode', () => {
  it('keeps CRUX_INDEX mode inert and avoids every side-effect port', () => {
    const ports: RuntimeConfigTransactionPorts = {
      hooks: {
        get: vi.fn(() => ({ marker: true }) as CruxHooks),
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
          storage: { records: inMemoryRecordStore() },
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
    expect(ports.hooks?.get).not.toHaveBeenCalled()
    expect(ports.hooks?.set).not.toHaveBeenCalled()
    expect(ports.hooks?.update).not.toHaveBeenCalled()
    expect(ports.hooks?.pushLayer).not.toHaveBeenCalled()
    expect(ports.hooks?.restoreLayer).not.toHaveBeenCalled()
    expect(ports.observability?.createHttpTransport).not.toHaveBeenCalled()
    expect(ports.observability?.configure).not.toHaveBeenCalled()
    expect(ports.bridge?.connect).not.toHaveBeenCalled()
    expect(ports.tokenizer?.setTokenizer).not.toHaveBeenCalled()
    expect(ports.plugins?.apply).not.toHaveBeenCalled()
    expect(crux.config.observability?.serverUrl).toBe('https://collector.example.com')
  })
})

const fakeLayerToken = {} as HooksLayerToken
