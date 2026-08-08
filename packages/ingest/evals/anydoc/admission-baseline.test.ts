import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { admissionBaseline, admissionRunAttestation, renderAdmissionArtifacts, type AdmissionSuiteEvidence } from './admission-suite.js'
import { fixtureManifests } from './fixture-manifest.js'

const baselinePath = resolve(dirname(fileURLToPath(import.meta.url)), 'evidence-baseline-v1.json')
const adrPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/adr/0005-anydoc-phase-2-admission.md')
const admissionCliPath = resolve(dirname(fileURLToPath(import.meta.url)), 'admission-cli.mjs')
const pointerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'evidence-current-v1.json')
const execute = promisify(execFile)

describe('Anydoc admission evidence', () => {
  it('keeps host measurements in run attestation rather than the admission decision', async () => {
    const first = syntheticEvidence({ cacheIdentity: 'host-a-cache', wallMilliseconds: 100, peakRssBytes: 128 })
    const second = syntheticEvidence({ cacheIdentity: 'host-b-cache', wallMilliseconds: 900, peakRssBytes: 256 })

    expect(await admissionBaseline(first)).toEqual(await admissionBaseline(second))
    expect(admissionRunAttestation(first)).not.toEqual(admissionRunAttestation(second))
    expect(JSON.stringify(await admissionBaseline(first))).not.toContain('wallMilliseconds')
    expect(JSON.stringify(admissionRunAttestation(first))).toContain('wallMilliseconds')
  })

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
    for (const result of evidence.results) {
      const limits = fixtureManifests.find((fixture) => fixture.id === result.fixtureId)?.limits
      expect(limits).toBeDefined()
      for (const candidate of result.candidates.filter((item) => item.rolloutBudgetGate)) {
        expect(candidate.p95.wallMilliseconds).toBeLessThanOrEqual(limits!.wallMilliseconds / 2)
        if (candidate.p95.peakRssBytes !== undefined) {
          expect(candidate.p95.peakRssBytes).toBeLessThanOrEqual(limits!.peakRssBytes / 2)
        }
        if (candidate.p95.cpuMilliseconds !== undefined) {
          expect(candidate.p95.cpuMilliseconds).toBeLessThanOrEqual(limits!.cpuMilliseconds / 2)
        }
      }
    }
    if (evidence.runner.hardMemoryContainment === false) {
      expect(evidence.formats.filter((decision) => decision.parser === 'anydoc').every((decision) => !decision.admitted)).toBe(true)
      expect(evidence.results.find((result) => result.format === 'pptx')?.candidates[0]?.outcome).toEqual({ kind: 'failure', error: 'containment-unavailable' })
    }
    expect(artifacts.baseline).not.toContain('normalizedContent')
  }, 300_000)
})

function syntheticEvidence(options: { readonly cacheIdentity: string; readonly wallMilliseconds: number; readonly peakRssBytes: number }): AdmissionSuiteEvidence {
  const assertions = { fixtureId: 'fixture-v1', passed: true, admitted: true, assertions: [] }
  return {
    schemaVersion: 1,
    runner: { maxConcurrentChildren: 1, productionEquivalent: false, hardMemoryContainment: false },
    cacheIdentity: options.cacheIdentity,
    formats: [{ format: 'docx', parser: 'mammoth', admitted: true, blockers: [] }],
    docxDecision: { primary: 'mammoth', reason: 'passed' },
    results: [{
      fixtureId: 'fixture-v1', format: 'docx', role: 'candidate', sourceHash: 'source-hash', sourceHashMatches: true,
      candidates: [{
        parser: 'mammoth', selected: true, outcome: { kind: 'success' }, hashes: { native: 'native', core: 'core' },
        native: assertions, core: assertions, projectionLosses: [], rolloutBudgetGate: true,
        p95: { wallMilliseconds: options.wallMilliseconds, peakRssBytes: options.peakRssBytes },
      }],
    }],
  }
}

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
