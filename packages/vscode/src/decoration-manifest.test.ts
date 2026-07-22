import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('decoration settings manifest', () => {
  it('declares client-only mode and length settings', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const properties = manifest.contributes?.configuration?.properties

    expect(properties?.['crux.decorations.mode']).toEqual({
      type: 'string',
      default: 'auto',
      enum: ['auto', 'on', 'off'],
      description: 'Controls client-side inline diagnostic decorations. This extension-only setting is not sent to the language server.',
    })
    expect(properties?.['crux.decorations.maxLength']).toEqual({
      type: 'number',
      default: 80,
      minimum: 1,
      description: 'Maximum client-side inline decoration length. This extension-only setting is not sent to the language server.',
    })
  })
})
