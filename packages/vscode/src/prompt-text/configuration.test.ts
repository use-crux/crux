import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  promptTextDecorationsConfiguration,
  readPromptTextDecorationsEnabled,
} from './configuration.js'

describe('PromptText decoration configuration', () => {
  it('publishes the exact client-only window-scoped off switch', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      readonly contributes?: {
        readonly configuration?: {
          readonly properties?: Record<string, unknown>
        }
      }
    }

    expect(
      manifest.contributes?.configuration?.properties?.[
        promptTextDecorationsConfiguration
      ],
    ).toEqual({
      type: 'boolean',
      default: true,
      scope: 'window',
    })
  })

  it('defaults to enabled and reads only the dedicated key', () => {
    const reads: string[] = []

    expect(
      readPromptTextDecorationsEnabled({
        get(section, fallback) {
          reads.push(section)
          return fallback
        },
      }),
    ).toBe(true)
    expect(reads).toEqual([promptTextDecorationsConfiguration])
  })
})
