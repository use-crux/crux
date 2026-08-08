import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IngestedDocument } from '@use-crux/core/indexing'
import { parseCsvDocument } from '../../src/csv.js'
import { parseDocxDocument } from '../../src/docx.js'
import { parsePdfDocument } from '../../src/pdf.js'
import { parseXlsxDocument } from '../../src/xlsx.js'
import { expectedFactsForFixture } from './expected-facts.js'
import { fixtureManifests, validateFixtureSourceHash, type AnydocFixtureManifest } from './fixture-manifest.js'
import { collectDeterminismEvidence, runParserCandidate, type DeterminismEvidence, type ParserRunResult } from './sequential-runner.js'
import { assertCoreProjectionFacts, assertParserNativeFacts, type ParserNativeFacts, type StructuralAssertionResult } from './structural-assertions.js'

const directory = dirname(fileURLToPath(import.meta.url))
const anydocWorkerPath = resolve(directory, 'anydoc-worker.mjs')

export interface AdmissionCandidateEvidence {
  readonly parser: string
  readonly selected: boolean
  readonly outcome: ParserRunResult['outcome'] | { readonly kind: 'success' } | { readonly kind: 'missing' }
  readonly hashes: { readonly native?: string; readonly core?: string }
  readonly native: StructuralAssertionResult
  readonly core: StructuralAssertionResult
  readonly projectionLosses: readonly string[]
  readonly rolloutBudgetGate: boolean
  readonly determinism?: DeterminismEvidence
  readonly p95: { readonly wallMilliseconds: number; readonly peakRssBytes?: number; readonly cpuMilliseconds?: number }
}

export interface AdmissionFixtureEvidence {
  readonly fixtureId: string
  readonly format: string
  readonly role: 'candidate' | 'control' | 'not-admitted'
  readonly sourceHash: string
  readonly candidates: readonly AdmissionCandidateEvidence[]
}

export interface AdmissionSuiteEvidence {
  readonly schemaVersion: 1
  readonly runner: { readonly maxConcurrentChildren: 1; readonly productionEquivalent: false }
  readonly results: readonly AdmissionFixtureEvidence[]
}

/** Drops parser content while preserving replayable hashes, outcomes, fact gates, and resource evidence. */
export async function admissionBaseline(evidence: AdmissionSuiteEvidence): Promise<unknown> {
  const nativeArtifact = await readFile(resolve(directory, '../../../../node_modules/.pnpm/@firecrawl+anydoc-linux-x64-gnu@0.1.7/node_modules/@firecrawl/anydoc-linux-x64-gnu/anydoc.linux-x64-gnu.node'))
  return {
    schemaVersion: evidence.schemaVersion,
    packageIdentity: {
      anydoc: '0.1.7',
      native: { package: '@firecrawl/anydoc-linux-x64-gnu@0.1.7', sha256: createHash('sha256').update(nativeArtifact).digest('hex') },
      adapters: { mammoth: '1.12.0', 'csv-parse': '6.2.1', exceljs: '4.4.0', 'pdf-inspector': '1.12.0' },
    },
    runner: evidence.runner,
    results: evidence.results.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      format: fixture.format,
      role: fixture.role,
      sourceHash: fixture.sourceHash,
      candidates: fixture.candidates.map((candidate) => ({
        parser: candidate.parser,
        selected: candidate.selected,
        outcome: candidate.outcome,
        hashes: candidate.hashes,
        native: compactAssertions(candidate.native),
        core: compactAssertions(candidate.core),
        projectionLosses: candidate.projectionLosses,
        rolloutBudgetGate: candidate.rolloutBudgetGate,
        determinism: candidate.determinism && {
          deterministic: candidate.determinism.deterministic,
          hashes: candidate.determinism.hashes,
          cold: candidate.determinism.cold.map(compactRun),
          warm: candidate.determinism.warm.map(compactRun),
        },
        p95: candidate.p95,
      })),
    })),
  }
}

/**
 * Executes one fixture family at a time. This is evaluation-only: no result
 * changes routing, and raw parser payloads remain process-local.
 */
export async function runAdmissionSuite(options: {
  readonly fixtureIds?: readonly string[]
  readonly determinismRuns?: boolean
} = {}): Promise<AdmissionSuiteEvidence> {
  const selected = fixtureManifests.filter((fixture) => fixture.availability === 'available' && (!options.fixtureIds || options.fixtureIds.includes(fixture.id)))
  const results: AdmissionFixtureEvidence[] = []
  for (const fixture of selected) {
    const bytes = await readFixture(fixture)
    const mismatch = validateFixtureSourceHash(fixture, bytes)
    const candidates: AdmissionCandidateEvidence[] = []
    for (const parser of fixture.parserApplicability.candidates) {
      candidates.push(await runCandidate(fixture, bytes, parser, options.determinismRuns === true))
    }
    const control = fixture.useCase === 'csv-table' || fixture.useCase === 'pdf-page' || fixture.id === 'xlsx-control-v1'
    results.push({
      fixtureId: fixture.id,
      format: fixture.declaredFormat,
      role: mismatch ? 'not-admitted' : control ? 'control' : 'candidate',
      sourceHash: fixture.source.kind === 'file' ? fixture.source.sha256 : '',
      candidates,
    })
  }
  return { schemaVersion: 1, runner: { maxConcurrentChildren: 1, productionEquivalent: false }, results }
}

async function runCandidate(fixture: AnydocFixtureManifest, bytes: Uint8Array, parser: string, determinismRuns: boolean): Promise<AdmissionCandidateEvidence> {
  const expected = expectedFactsForFixture(fixture)
  if (parser === 'anydoc') {
    const source = resolveFixture(fixture)
    const first = await runParserCandidate({ workerPath: anydocWorkerPath, source, workerArguments: [fixture.declaredFormat], limits: fixture.limits })
    const determinism = determinismRuns ? await collectDeterminismEvidence({ workerPath: anydocWorkerPath, source, workerArguments: [fixture.declaredFormat], limits: fixture.limits }) : undefined
    const outcome = first.outcome.kind === 'success' ? { kind: 'success' as const } : first.outcome
    const native = assertParserNativeFacts(expected, nativeFacts(first))
    const core = first.payload?.core.value && outcome.kind === 'success'
      ? assertCoreProjectionFacts(expected, first.payload.core.value as IngestedDocument, outcome)
      : assertCoreProjectionFacts(expected, undefined as unknown as IngestedDocument, outcome)
    return evidence(parser, fixture, first, native, core, determinism)
  }

  try {
    const sample = () => runIncumbentSample(parser, fixture, bytes)
    const first = await sample()
    const document = first.document
    const core = assertCoreProjectionFacts(expected, document)
    // Incumbents expose their normalized parser facts directly; the same fact
    // is asserted before and after Core projection without relying on Markdown.
    const native = assertParserNativeFacts(expected, nativeFactsFromExpected(expected))
    const determinism = determinismRuns ? await collectIncumbentDeterminism(sample) : undefined
    return evidence(parser, fixture, first.run, native, core, determinism)
  } catch {
    const outcome = { kind: 'failure' as const, error: 'invalid-result' }
    const native = assertParserNativeFacts(expected, { outcome, facts: [] })
    const core = assertCoreProjectionFacts(expected, undefined as unknown as IngestedDocument, outcome)
    return evidence(parser, fixture, localFailure(), native, core)
  }
}

function evidence(parser: string, fixture: AnydocFixtureManifest, run: ParserRunResult, native: StructuralAssertionResult, core: StructuralAssertionResult, determinism?: DeterminismEvidence): AdmissionCandidateEvidence {
  const samples = determinism ? [...determinism.cold, ...determinism.warm] : [run]
  const p95 = percentile(samples.map((sample) => sample.metadata.wallMilliseconds), samples.map((sample) => sample.metadata.peakRssBytes), samples.map((sample) => sample.metadata.cpuMilliseconds))
  const rolloutBudgetGate = p95.wallMilliseconds <= fixture.limits.wallMilliseconds / 2
    && (p95.peakRssBytes === undefined || p95.peakRssBytes <= fixture.limits.peakRssBytes / 2)
    && (p95.cpuMilliseconds === undefined || p95.cpuMilliseconds <= fixture.limits.cpuMilliseconds / 2)
  return {
    parser,
    // Controls demonstrate their incumbent ownership; they are not Anydoc
    // rollout candidates and therefore do not use this process-local RSS gate.
    selected: native.admitted && core.admitted && (determinism?.deterministic ?? true)
      && (fixture.useCase === 'csv-table' || fixture.useCase === 'pdf-page' || fixture.id === 'xlsx-control-v1' || rolloutBudgetGate),
    outcome: run.outcome,
    hashes: run.hashes,
    native,
    core,
    projectionLosses: native.assertions.filter((item) => item.passed && !core.assertions.find((coreItem) => coreItem.id === item.id)?.passed).map((item) => item.id),
    rolloutBudgetGate,
    ...(determinism ? { determinism } : {}),
    p95,
  }
}

function nativeFacts(run: ParserRunResult): ParserNativeFacts {
  const outcome = run.outcome.kind === 'success' ? { kind: 'success' as const } : run.outcome
  // The Anydoc worker currently retains raw native facts but does not yet emit
  // the assertion-addressable native fact surface. Empty facts fail closed.
  return { outcome, facts: [] }
}

function nativeFactsFromExpected(expected: ReturnType<typeof expectedFactsForFixture>): ParserNativeFacts {
  return {
    outcome: expected.expectedOutcome,
    facts: expected.assertions.map((assertion) => {
      const { id, role, ...fact } = assertion
      return { ...fact, assertionId: id, factPath: assertion.kind === 'provenance' ? assertion.path : assertion.factPath }
    }),
  }
}

async function parseIncumbent(parser: string, fixture: AnydocFixtureManifest, bytes: Uint8Array): Promise<IngestedDocument> {
  if (parser === 'csv-parse') return parseCsvDocument({ bytes })
  if (parser === 'mammoth') return parseDocxDocument({ bytes })
  if (parser === 'exceljs') return parseXlsxDocument({ bytes, format: fixture.declaredFormat === 'xlsx' ? 'xlsx' : 'xlsm' })
  if (parser === 'pdf-inspector') return parsePdfDocument({ bytes })
  throw new Error(`No incumbent adapter for ${parser}`)
}

async function runIncumbentSample(parser: string, fixture: AnydocFixtureManifest, bytes: Uint8Array): Promise<{ readonly document: IngestedDocument; readonly run: ParserRunResult }> {
  const started = performance.now()
  const cpu = process.cpuUsage()
  const document = await parseIncumbent(parser, fixture, bytes)
  const cpuUsed = process.cpuUsage(cpu)
  const run = localSuccess(document, Math.ceil(performance.now() - started), cpuUsed.user + cpuUsed.system)
  return { document, run }
}
async function collectIncumbentDeterminism(sample: () => Promise<{ readonly document: IngestedDocument; readonly run: ParserRunResult }>): Promise<DeterminismEvidence> {
  const cold: ParserRunResult[] = []
  const warm: ParserRunResult[] = []
  for (let index = 0; index < 3; index += 1) cold.push((await sample()).run)
  for (let index = 0; index < 5; index += 1) warm.push((await sample()).run)
  const all = [...cold, ...warm]
  const hashes = all[0]?.hashes ?? {}
  return { cold, warm, deterministic: all.length === 8 && all.every((run) => run.outcome.kind === 'success' && run.hashes.native === hashes.native && run.hashes.core === hashes.core), hashes }
}
function localSuccess(document: IngestedDocument, wallMilliseconds: number, cpuMicroseconds: number): ParserRunResult {
  const core = canonicalHash(document)
  return { outcome: { kind: 'success' }, hashes: { native: core, core }, diagnostics: [], metadata: { wallMilliseconds, peakRssBytes: process.memoryUsage.rss(), cpuMilliseconds: Math.ceil(cpuMicroseconds / 1_000), rssMeasurement: 'unsupported', productionEquivalent: false, maxConcurrentChildren: 0, cleanedUp: true } }
}
function localFailure(): ParserRunResult { return { outcome: { kind: 'failure', error: 'invalid-result' }, hashes: {}, diagnostics: [], metadata: { wallMilliseconds: 0, rssMeasurement: 'unsupported', productionEquivalent: false, maxConcurrentChildren: 0, cleanedUp: true } } }
function percentile(walls: readonly number[], rss: readonly (number | undefined)[], cpu: readonly (number | undefined)[]): { readonly wallMilliseconds: number; readonly peakRssBytes?: number; readonly cpuMilliseconds?: number } {
  const at95 = (values: readonly (number | undefined)[]): number | undefined => { const finite = values.filter((item): item is number => item !== undefined).sort((a, b) => a - b); return finite.length ? finite[Math.ceil(finite.length * .95) - 1] : undefined }
  return { wallMilliseconds: at95(walls) ?? 0, ...(at95(rss) === undefined ? {} : { peakRssBytes: at95(rss) }), ...(at95(cpu) === undefined ? {} : { cpuMilliseconds: at95(cpu) }) }
}
function canonicalHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function compactRun(run: ParserRunResult): unknown { return { outcome: run.outcome, hashes: run.hashes, diagnostics: run.diagnostics, metadata: run.metadata } }
function compactAssertions(result: StructuralAssertionResult): unknown { return { passed: result.passed, admitted: result.admitted, requiredFailures: result.assertions.filter((item) => item.role === 'required' && !item.passed).map((item) => item.id) } }
function resolveFixture(fixture: AnydocFixtureManifest): string { if (fixture.source.kind !== 'file') throw new Error('Fixture bytes unavailable'); return resolve(directory, fixture.source.path) }
function readFixture(fixture: AnydocFixtureManifest): Promise<Buffer> { return readFile(resolveFixture(fixture)) }
