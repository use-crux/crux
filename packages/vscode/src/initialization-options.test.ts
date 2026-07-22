import { describe, expect, it } from 'vitest'
import {
  createInitializationOptions,
  serverConfigurationSections,
} from './initialization-options.js'

describe('createInitializationOptions', () => {
  it('keeps workspace trust beside the existing Crux settings', () => {
    expect(createInitializationOptions({
      port: 4599,
      profile: 'strict',
      includeSuppressed: true,
      trace: 'messages',
      workspaceTrust: false,
    })).toEqual({
      workspaceTrust: false,
      clientCommands: { openDevtools: true },
      crux: {
        port: 4599,
        lint: { profile: 'strict', includeSuppressed: true },
        trace: 'messages',
      },
    })
  })
})

describe('serverConfigurationSections', () => {
  it('synchronizes only language-server settings', () => {
    expect(serverConfigurationSections).toEqual([
      'crux.port',
      'crux.lint',
      'crux.inlayHints',
      'crux.codeLens',
      'crux.trace',
    ])
    expect(serverConfigurationSections).not.toContain('crux.decorations')
  })
})
