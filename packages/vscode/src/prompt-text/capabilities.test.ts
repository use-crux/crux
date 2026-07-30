import type { ClientCapabilities } from 'vscode-languageclient/node'
import { describe, expect, it } from 'vitest'
import { createPromptTextRefreshFeature } from './capabilities.js'

describe('PromptText refresh capability', () => {
  it('fills the exact Crux capability without replacing adjacent experiments', () => {
    const capabilities: ClientCapabilities = {
      experimental: {
        neighbor: { enabled: true },
        crux: {
          existing: 'preserved',
          promptText: { previewSupport: true },
        },
      },
    }
    const feature = createPromptTextRefreshFeature()

    feature.fillClientCapabilities(capabilities)

    expect(capabilities.experimental).toEqual({
      neighbor: { enabled: true },
      crux: {
        existing: 'preserved',
        promptText: {
          previewSupport: true,
          refreshSupport: true,
        },
      },
    })
    expect(feature.getState()).toEqual({ kind: 'static' })
  })
})
