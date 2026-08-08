import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderAdmissionArtifacts, type AdmissionSuiteEvidence } from './admission-suite.js'

const baselinePath = resolve(dirname(fileURLToPath(import.meta.url)), 'evidence-baseline-v1.json')
const adrPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/adr/0005-anydoc-phase-2-admission.md')
const admissionCliPath = resolve(dirname(fileURLToPath(import.meta.url)), 'admission-cli.mjs')
const pointerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'evidence-current-v1.json')
const execute = promisify(execFile)

describe('Anydoc admission evidence', () => {
  it('replays the suite and keeps the baseline and ADR byte-consistent', async () => {
    const { stdout } = await execute(process.execPath, [admissionCliPath], { maxBuffer: 32 * 1024 * 1024 })
    const evidence = JSON.parse(stdout) as AdmissionSuiteEvidence
    const artifacts = await renderAdmissionArtifacts(evidence)

    if (process.env.UPDATE_ANYDOC_EVIDENCE === '1') {
      await writeArtifactsAtomically(artifacts)
    } else {
      expect(artifacts.baseline).toBe(await readFile(baselinePath, 'utf8'))
      expect(artifacts.adr).toBe(await readFile(adrPath, 'utf8'))
      expect(JSON.parse(await readFile(pointerPath, 'utf8'))).toEqual(pointerFor(artifacts))
    }

    expect(evidence.runner.maxConcurrentChildren).toBe(1)
    if (evidence.runner.hardMemoryContainment === false) {
      expect(evidence.formats.filter((decision) => decision.parser === 'anydoc').every((decision) => !decision.admitted)).toBe(true)
      expect(evidence.results.find((result) => result.format === 'pptx')?.candidates[0]?.outcome).toEqual({ kind: 'failure', error: 'containment-unavailable' })
    }
    expect(artifacts.baseline).not.toContain('normalizedContent')
  }, 300_000)
})

async function writeArtifactsAtomically(artifacts: { readonly baseline: string; readonly adr: string }): Promise<void> {
  await mkdir(dirname(baselinePath), { recursive: true })
  const baselineTemporary = `${baselinePath}.tmp`
  const adrTemporary = `${adrPath}.tmp`
  const pointerTemporary = `${pointerPath}.tmp`
  await Promise.all([writeFile(baselineTemporary, artifacts.baseline), writeFile(adrTemporary, artifacts.adr)])
  await Promise.all([rename(baselineTemporary, baselinePath), rename(adrTemporary, adrPath)])
  await writeFile(pointerTemporary, `${JSON.stringify(pointerFor(artifacts), null, 2)}\n`)
  await rename(pointerTemporary, pointerPath)
}

function pointerFor(artifacts: { readonly baseline: string; readonly adr: string }) {
  return {
    schemaVersion: 1,
    baselineSha256: createHash('sha256').update(artifacts.baseline).digest('hex'),
    adrSha256: createHash('sha256').update(artifacts.adr).digest('hex'),
  }
}
