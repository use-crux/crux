import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { admissionBaseline, runAdmissionSuite } from './admission-suite.js'

const baselinePath = resolve(dirname(fileURLToPath(import.meta.url)), 'evidence-baseline-v1.json')

describe('Anydoc admission evidence', () => {
  it.skipIf(process.env.UPDATE_ANYDOC_EVIDENCE !== '1')('replays all available fixtures sequentially and writes bounded evidence', async () => {
    const evidence = await runAdmissionSuite({ determinismRuns: true })
    const baseline = await admissionBaseline(evidence)
    await mkdir(dirname(baselinePath), { recursive: true })
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)

    expect(evidence.runner.maxConcurrentChildren).toBe(1)
    expect(JSON.stringify(baseline)).not.toContain('normalizedContent')
  }, 180_000)
})
