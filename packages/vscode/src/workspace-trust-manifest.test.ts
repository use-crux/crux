import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('workspace trust manifest', () => {
  it('keeps the extension host-inert until workspace trust is granted', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

    expect(manifest.capabilities?.untrustedWorkspaces).toEqual({ supported: false })
    expect(manifest.enabledApiProposals).toBeUndefined()
  })
})
