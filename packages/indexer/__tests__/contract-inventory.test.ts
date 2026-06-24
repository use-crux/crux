import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nativeRuntimeContractInventory, nativeRuntimeContractIds } from './contract-inventory'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('native runtime contract inventory', () => {
  it('records every current cross-language contract group in migration order', () => {
    expect(nativeRuntimeContractInventory().map((entry) => entry.id)).toEqual(nativeRuntimeContractIds)
  })

  it('points every listed TypeScript contract and Go/Rust mirror at a tracked file', async () => {
    for (const entry of nativeRuntimeContractInventory()) {
      for (const file of entry.files) {
        await expect(access(join(repoRoot, file.path)), `${entry.id}: ${file.path}`).resolves.toBeUndefined()
      }
    }
  })

  it('keeps the tracked architecture baseline aligned with the inventory groups', async () => {
    const source = await readFile(join(repoRoot, 'packages/indexer/docs/native-runtime-architecture-baseline.md'), 'utf8')

    expect(source).toContain('## Ownership Map')
    expect(source).toContain('## Parity Fixture Gaps')
    expect(source).toContain('## Existing Parity Coverage')
    for (const entry of nativeRuntimeContractInventory()) {
      expect(source).toContain(`\`${entry.id}\``)
      expect(source).toContain(entry.fixtureGap)
    }
  })
})
