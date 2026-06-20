import { describe, expect, it } from 'vitest'
import { semanticBackendSelectionFromConfig, semanticBackendSelectionFromEnv } from '../indexer/semantic/service'

describe('semantic backend selection', () => {
  it('selects the native backend from env selection', () => {
    expect(
      semanticBackendSelectionFromEnv({
        CRUX_INDEX_SEMANTIC_BACKEND: 'native',
      }),
    ).toEqual({ name: 'native', engine: undefined, tsserverPath: undefined })

    expect(
      semanticBackendSelectionFromEnv({
        CRUX_INDEX_SEMANTIC_BACKEND: 'native',
        CRUX_INDEX_NATIVE_ENGINE: 'tsgo',
        CRUX_INDEX_NATIVE_TSSERVER_PATH: '/opt/bin/tsgo',
      }),
    ).toEqual({ name: 'native', engine: 'tsgo', tsserverPath: '/opt/bin/tsgo' })
  })

  it('preserves explicit TypeScript env selection without experimental flags', () => {
    expect(
      semanticBackendSelectionFromEnv({
        CRUX_INDEX_SEMANTIC_BACKEND: 'typescript',
      }),
    ).toEqual({ name: 'typescript' })
  })

  it('selects the native backend from top-level experimental config', () => {
    expect(semanticBackendSelectionFromConfig({ indexer: { native: true } })).toEqual({
      name: 'native',
    })
  })

  it('passes the configured native engine options into backend selection', () => {
    expect(
      semanticBackendSelectionFromConfig({
        indexer: { native: { engine: 'tsgo', tsserverPath: '/opt/bin/tsgo' } },
      }),
    ).toEqual({
      name: 'native',
      engine: 'tsgo',
      tsserverPath: '/opt/bin/tsgo',
    })
  })

  it('leaves semantic selection on the TypeScript default when the native experiment is disabled', () => {
    expect(semanticBackendSelectionFromConfig(undefined)).toBeUndefined()
    expect(semanticBackendSelectionFromConfig({ indexer: { native: false } })).toBeUndefined()
  })
})
