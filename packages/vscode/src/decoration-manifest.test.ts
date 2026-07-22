import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('P3 extension manifest', () => {
  it('declares server and client-only settings with bounded opacity', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const properties = manifest.contributes?.configuration?.properties

    expect(properties?.['crux.lint.includeSuppressed']).toEqual({
      type: 'boolean',
      default: false,
      description: 'Includes findings retained with suppression evidence.',
    })
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
    expect(properties?.['crux.decorations.opacity']).toEqual({
      type: 'number',
      default: 0.65,
      minimum: 0.1,
      maximum: 1,
      description: 'Controls the opacity of client-side inline diagnostic decorations. This extension-only setting is not sent to the language server.',
    })
    expect(properties?.['crux.inlayHints.enabled']).toEqual({
      type: 'boolean',
      default: true,
      description: 'Controls Crux inlay hint finding badges.',
    })
    expect(properties?.['crux.codeLens.enabled']).toEqual({
      type: 'boolean',
      default: true,
      description: 'Controls Crux code lens finding counts.',
    })
  })

  it('registers the client-side devtools command', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.contributes?.commands).toContainEqual({
      command: 'crux.openDevtools',
      title: 'Crux: Open Devtools',
    })
  })
})
