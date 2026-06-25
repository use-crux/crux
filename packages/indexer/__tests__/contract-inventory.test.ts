import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { staticIndexRuntimeContractInventory, staticIndexRuntimeContractIds } from './contract-inventory'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('Static Index runtime contract inventory', () => {
  it('records every current cross-language contract group in migration order', () => {
    expect(staticIndexRuntimeContractInventory().map((entry) => entry.id)).toEqual(staticIndexRuntimeContractIds)
  })

  it('tracks Static Index as the canonical protocol row', () => {
    const entry = staticIndexRuntimeContractInventory().find((candidate) => candidate.id === 'static-index')

    expect(entry).toEqual(
      expect.objectContaining({
        id: 'static-index',
        label: 'Static Index compiler protocol',
      }),
    )
    expect(entry?.filesByOwner.typescript.some((file) => file.path.includes('/contracts/static-index/'))).toBe(true)
    expect(entry?.filesByOwner.typescript.some((file) => file.path.includes('/contracts/native-static/'))).toBe(false)
  })

  it('points every listed TypeScript contract and Go/Rust mirror at a tracked file', async () => {
    for (const entry of staticIndexRuntimeContractInventory()) {
      for (const file of entry.files) {
        await expect(access(join(repoRoot, file.path)), `${entry.id}: ${file.path}`).resolves.toBeUndefined()
      }
    }
  })

  it('keeps the tracked architecture baseline aligned with the inventory groups', async () => {
    const source = await readFile(join(repoRoot, 'packages/indexer/docs/static-index-runtime-architecture-baseline.md'), 'utf8')

    expect(source).toContain('## Ownership Map')
    expect(source).toContain('## Parity Fixture Gaps')
    expect(source).toContain('## Existing Parity Coverage')
    for (const entry of staticIndexRuntimeContractInventory()) {
      expect(source).toContain(`\`${entry.id}\``)
      expect(source).toContain(entry.fixtureGap)
    }
  })
})
