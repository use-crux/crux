import { describe, expect, it } from 'vitest'
import { discoverBinary, type DiscoveryHost } from './discovery.js'

const folder = '/workspace/crux'

function host(executable: string[], pathBinary?: string): DiscoveryHost {
  return {
    platform: 'linux',
    arch: 'x64',
    isExecutable: async (path) => executable.includes(path),
    findOnPath: async () => pathBinary,
  }
}

describe('discoverBinary', () => {
  it('uses an executable configured path before every fallback', async () => {
    await expect(discoverBinary('./bin/crux', folder, host(['/workspace/crux/bin/crux'], '/usr/bin/crux')))
      .resolves.toEqual({ path: '/workspace/crux/bin/crux', source: 'configured' })
  })

  it('rejects a configured non-executable path without falling through', async () => {
    await expect(discoverBinary('/missing/crux', folder, host([], '/usr/bin/crux')))
      .rejects.toThrow('Configured Crux binary is not executable: /missing/crux')
  })

  it('checks make local and platform bundle outputs before PATH', async () => {
    const local = '/workspace/crux/packages/local/crux'
    await expect(discoverBinary('', folder, host([local], '/usr/bin/crux')))
      .resolves.toEqual({ path: local, source: 'workspace' })

    const bundle = '/workspace/crux/packages/local/dist/crux-linux-x64/bin/crux'
    await expect(discoverBinary('', folder, host([bundle], '/usr/bin/crux')))
      .resolves.toEqual({ path: bundle, source: 'workspace' })
  })

  it('falls back to PATH and then reports no match', async () => {
    await expect(discoverBinary('', folder, host(['/usr/bin/crux'], '/usr/bin/crux')))
      .resolves.toEqual({ path: '/usr/bin/crux', source: 'path' })
    await expect(discoverBinary('', folder, host([]))).resolves.toBeUndefined()
  })
})
