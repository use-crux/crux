import { describe, expect, it, vi } from 'vitest'
import { offerInstallHelp } from './install-help.js'

describe('offerInstallHelp', () => {
  it('opens installation documentation for npm and direct-download instructions', async () => {
    const showWarning = vi.fn().mockResolvedValue('View Installation Guide')
    const openExternal = vi.fn()

    await offerInstallHelp({ showWarning, openExternal })

    expect(showWarning).toHaveBeenCalledWith(
      'Crux binary not found. Install @use-crux/local or use a native release archive.',
      'View Installation Guide',
      'Open Binary Settings',
    )
    expect(openExternal).toHaveBeenCalledWith(
      'https://cruxjs.dev/docs/reference/lsp#install-the-extension-and-cli',
    )
  })

  it('keeps the explicit binary setting available as a secondary action', async () => {
    const openSettings = vi.fn()

    await offerInstallHelp({
      showWarning: async () => 'Open Binary Settings',
      openExternal: vi.fn(),
      openSettings,
    })

    expect(openSettings).toHaveBeenCalledOnce()
  })
})
