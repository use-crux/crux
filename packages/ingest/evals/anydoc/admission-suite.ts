import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import type { IngestedDocument } from '@use-crux/core/indexing'
import { expectedFactsForCandidate, expectedFactsForFixture } from './expected-facts.js'
import { fixtureManifests, validateFixtureSourceHash, type AnydocFixtureManifest } from './fixture-manifest.js'
import { collectDeterminismEvidence, runParserCandidate, type DeterminismEvidence, type ParserRunResult } from './sequential-runner.js'
import { assertCoreProjectionFacts, assertParserNativeFacts, type ParserNativeFact, type ParserNativeFacts, type StructuralAssertionResult } from './structural-assertions.js'
import { phase2AnydocWorkerContainment } from './containment.js'

const directory = process.env.CRUX_ANYDOC_EVAL_DIRECTORY ?? dirname(fileURLToPath(import.meta.url))
const anydocWorkerPath = resolve(directory, 'anydoc-worker.mjs')
const incumbentWorkerEntry = resolve(directory, 'incumbent-worker.ts')
const incumbentWorkerPath = resolve(directory, '../../node_modules/.cache/crux-anydoc-eval/incumbent-worker.cjs')
let incumbentBuild: Promise<void> | undefined

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
  readonly sourceHashMatches: boolean
  readonly candidates: readonly AdmissionCandidateEvidence[]
}

export interface AdmissionSuiteEvidence {
  readonly schemaVersion: 1
  readonly runner: { readonly maxConcurrentChildren: 1; readonly productionEquivalent: false; readonly hardMemoryContainment?: boolean }
  readonly results: readonly AdmissionFixtureEvidence[]
  readonly formats: readonly AdmissionFormatDecision[]
  readonly docxDecision: { readonly primary: string | null; readonly qualityLeader?: string; readonly reason: string }
  readonly cacheIdentity?: string
}

export interface AdmissionFormatDecision {
  readonly format: string
  readonly parser: string
  readonly admitted: boolean
  readonly blockers: readonly string[]
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
    evidenceIdentity: {
      cacheIdentity: evidence.cacheIdentity ?? 'in-process-unkeyed',
      runtime: `${process.platform}-${process.arch}-node-${process.versions.node}`,
      hardMemoryContainment: evidence.runner.hardMemoryContainment ?? false,
      fixtureSha256: evidence.results.map((result) => ({ fixtureId: result.fixtureId, sha256: result.sourceHash })),
    },
    runner: evidence.runner,
    formats: evidence.formats,
    docxDecision: evidence.docxDecision,
    results: evidence.results.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      format: fixture.format,
      role: fixture.role,
      sourceHash: fixture.sourceHash,
      sourceHashMatches: fixture.sourceHashMatches,
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

export async function renderAdmissionArtifacts(evidence: AdmissionSuiteEvidence): Promise<{
  readonly baseline: string
  readonly adr: string
}> {
  const value = await admissionBaseline(evidence)
  const baseline = `${JSON.stringify(value, null, 2)}\n`
  const baselineSha256 = createHash('sha256').update(baseline).digest('hex')
  const docx = evidence.formats.filter((decision) => decision.format === 'docx')
  const primary = evidence.docxDecision.primary
  const metrics = evidence.results.find((fixture) => fixture.fixtureId === 'docx-structure-v1')?.candidates ?? []
  const rows = metrics.map((candidate) => `| ${candidate.parser} | ${candidate.native.passed} | ${candidate.core.passed} | ${candidate.determinism?.deterministic ?? false} | ${candidate.rolloutBudgetGate} | ${candidate.p95.wallMilliseconds} | ${candidate.p95.peakRssBytes ?? 'unavailable'} |`).join('\n')
  const blockers = docx.flatMap((decision) => decision.blockers.map((fixture) => `- \`${decision.parser}\`: \`${fixture}\``)).join('\n') || '- None.'
  const adr = `# ADR 0005: Anydoc Phase 2 Admission\n\nStatus: Accepted\n\nDate: 2026-08-08\n\nBaseline SHA-256: \`${baselineSha256}\`\n\n## Decision\n\nDOCX primary: ${primary ? `\`${primary}\`` : '**none**'}. Exactly one primary is selected only when one candidate passes every applicable fixture gate. No fallback trigger is admitted. This evaluation does not change production routing.\n\n## DOCX evidence\n\n| Parser | Native facts | Core facts | Deterministic | Resource <= 50% | p95 wall ms | p95 RSS bytes |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n## Format-wide blockers\n\n${blockers}\n\nMissing fixtures and source-hash mismatches are hard non-admission results; they are never inherited from another format or parser. The machine-readable baseline embeds every fixture outcome, deterministic hash, and resource sample used by this decision.\n`
  return { baseline, adr }
}

/**
 * Executes one fixture family at a time. This is evaluation-only: no result
 * changes routing, and raw parser payloads remain process-local.
 */
export async function runAdmissionSuite(options: {
  readonly fixtureIds?: readonly string[]
  readonly formats?: readonly string[]
  readonly determinismRuns?: boolean
} = {}): Promise<AdmissionSuiteEvidence> {
  const selected = fixtureManifests.filter((fixture) =>
    (!options.fixtureIds || options.fixtureIds.includes(fixture.id))
    && (!options.formats || options.formats.includes(fixture.declaredFormat)))
  const results: AdmissionFixtureEvidence[] = []
  for (const fixture of selected) {
    if (fixture.availability === 'missing') {
      results.push({ fixtureId: fixture.id, format: fixture.declaredFormat, role: 'not-admitted', sourceHash: '', sourceHashMatches: false, candidates: fixture.parserApplicability.candidates.map((parser) => missingEvidence(parser, fixture)) })
      continue
    }
    const bytes = await readFixture(fixture)
    const mismatch = validateFixtureSourceHash(fixture, bytes)
    const candidates: AdmissionCandidateEvidence[] = []
    for (const parser of fixture.parserApplicability.candidates) {
      candidates.push(parser === 'anydoc' && phase2AnydocWorkerContainment() === undefined
        ? unavailableContainmentEvidence(parser, fixture)
        : await runCandidate(fixture, bytes, parser, options.determinismRuns === true))
    }
    const control = fixture.useCase === 'csv-table' || fixture.useCase === 'pdf-page' || fixture.id === 'xlsx-control-v1'
    results.push({
      fixtureId: fixture.id,
      format: fixture.declaredFormat,
      role: mismatch ? 'not-admitted' : control ? 'control' : 'candidate',
      sourceHash: fixture.source.kind === 'file' ? createHash('sha256').update(bytes).digest('hex') : '',
      sourceHashMatches: mismatch === undefined,
      candidates,
    })
  }
  const quality = decideDocxQualityLeader(results)
  const formats = decideFormats(results).map((decision) => decision.parser === 'anydoc'
    ? { ...decision, admitted: false, blockers: [...new Set([...decision.blockers, 'hard-memory-containment'])] }
    : decision)
  const admittedDocx = formats.filter((decision) => decision.format === 'docx' && decision.admitted)
  return {
    schemaVersion: 1,
    runner: { maxConcurrentChildren: 1, productionEquivalent: false, hardMemoryContainment: false },
    results,
    formats,
    docxDecision: {
      primary: admittedDocx.length === 1 ? admittedDocx[0]!.parser : null,
      ...(quality.primary ? { qualityLeader: quality.primary } : {}),
      reason: admittedDocx.length === 1 ? 'Exactly one candidate passed every format-wide gate.' : 'No candidate passed every format-wide gate.',
    },
  }
}

async function runCandidate(fixture: AnydocFixtureManifest, bytes: Uint8Array, parser: string, determinismRuns: boolean): Promise<AdmissionCandidateEvidence> {
  let expected = expectedFactsForFixture(fixture)
  if (parser === 'anydoc') {
    const source = resolveFixture(fixture)
    const first = await runParserCandidate({ workerPath: anydocWorkerPath, source, workerArguments: [fixture.declaredFormat], limits: fixture.limits })
    const producer = producerOf(first)
    if (producer) expected = expectedFactsForCandidate(fixture, parser, producer)
    const determinism = determinismRuns ? await collectDeterminismEvidence({ workerPath: anydocWorkerPath, source, workerArguments: [fixture.declaredFormat], limits: fixture.limits }) : undefined
    const outcome = first.outcome.kind === 'success' ? { kind: 'success' as const } : first.outcome
    const core = first.payload?.core.value && outcome.kind === 'success'
      ? assertCoreProjectionFacts(expected, first.payload.core.value as IngestedDocument, outcome)
      : assertCoreProjectionFacts(expected, undefined as unknown as IngestedDocument, outcome)
    const native = assertParserNativeFacts(expected, nativeFacts(first))
    return evidence(parser, fixture, first, native, core, determinism)
  }

  try {
    await prepareIncumbentWorker()
    const source = resolveFixture(fixture)
    const sample = () => runParserCandidate({ workerPath: incumbentWorkerPath, source, workerArguments: [parser, fixture.declaredFormat], limits: fixture.limits })
    const first = await sample()
    const document = first.payload?.core.value as IngestedDocument
    const producer = producerOf(first)
    if (!producer) throw new Error(`Incumbent worker omitted its exact producer identity: ${JSON.stringify(first.outcome)}.`)
    expected = expectedFactsForCandidate(fixture, parser, producer)
    const core = assertCoreProjectionFacts(expected, document)
    const native = assertParserNativeFacts(expected, nativeFacts(first))
    const determinism = determinismRuns ? await collectDeterminismEvidence({ workerPath: incumbentWorkerPath, source, workerArguments: [parser, fixture.declaredFormat], limits: fixture.limits }) : undefined
    return evidence(parser, fixture, first, native, core, determinism)
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
    selected: native.passed && core.passed && (determinism?.deterministic ?? true)
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
  const native = run.payload?.native.value as { readonly outcome?: ParserNativeFacts['outcome']; readonly facts?: readonly ParserNativeFact[] } | undefined
  return { outcome: native?.outcome ?? outcome, facts: Array.isArray(native?.facts) ? native.facts : [] }
}
function localFailure(): ParserRunResult { return { outcome: { kind: 'failure', error: 'invalid-result' }, hashes: {}, diagnostics: [], metadata: { wallMilliseconds: 0, rssMeasurement: 'unsupported', productionEquivalent: false, maxConcurrentChildren: 0, cleanedUp: true } } }

async function prepareIncumbentWorker(): Promise<void> {
  incumbentBuild ??= (async () => {
    await mkdir(dirname(incumbentWorkerPath), { recursive: true })
    await build({
      entryPoints: [incumbentWorkerEntry],
      outfile: incumbentWorkerPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      sourcemap: false,
      external: ['@firecrawl/pdf-inspector', '@firecrawl/pdf-inspector-*', 'pdfjs-dist/*'],
    })
  })()
  await incumbentBuild
}

function producerOf(run: ParserRunResult): import('@use-crux/core/indexing').ParserIdentity | undefined {
  const value = run.payload?.core.value as { readonly producer?: import('@use-crux/core/indexing').ParserIdentity } | undefined
  return value?.producer
}

function missingEvidence(parser: string, fixture: AnydocFixtureManifest): AdmissionCandidateEvidence {
  const missing = { fixtureId: fixture.id, passed: false, admitted: false, assertions: [] }
  return { parser, selected: false, outcome: { kind: 'missing' }, hashes: {}, native: missing, core: missing, projectionLosses: [], rolloutBudgetGate: false, p95: { wallMilliseconds: 0 } }
}

function unavailableContainmentEvidence(parser: string, fixture: AnydocFixtureManifest): AdmissionCandidateEvidence {
  const outcome = { kind: 'failure' as const, error: 'containment-unavailable' as const }
  const expected = expectedFactsForFixture(fixture)
  const native = assertParserNativeFacts(expected, { outcome, facts: [] })
  const core = assertCoreProjectionFacts(expected, undefined as unknown as IngestedDocument, outcome)
  return { parser, selected: false, outcome, hashes: {}, native, core, projectionLosses: [], rolloutBudgetGate: false, p95: { wallMilliseconds: 0 } }
}

function decideFormats(results: readonly AdmissionFixtureEvidence[]): AdmissionFormatDecision[] {
  const formats = [...new Set(results.map((result) => result.format))].sort()
  return formats.flatMap((format) => {
    const fixtures = results.filter((result) => result.format === format)
    const parsers = [...new Set(fixtures.flatMap((fixture) => fixture.candidates.map((candidate) => candidate.parser)))].sort()
    return parsers.map((parser) => {
      const applicable = fixtures.filter((fixture) => fixture.candidates.some((candidate) => candidate.parser === parser))
      const blockers = applicable.flatMap((fixture) => {
        const candidate = fixture.candidates.find((item) => item.parser === parser)!
        return fixture.sourceHashMatches && candidate.selected ? [] : [fixture.fixtureId]
      })
      return { format, parser, admitted: blockers.length === 0 && applicable.length > 0, blockers }
    })
  })
}

/** Select DOCX quality independently from rollout-only missing stress recipes. */
export function decideDocxQualityLeader(results: readonly AdmissionFixtureEvidence[]): { readonly primary: string | null; readonly reason: string } {
  const fixture = results.find((result) => result.fixtureId === 'docx-structure-v1')
  if (!fixture || !fixture.sourceHashMatches) return { primary: null, reason: 'DOCX quality fixture is missing or has a source-hash mismatch.' }
  const passing = fixture.candidates.filter((candidate) => candidate.selected)
  if (passing.length === 1) return { primary: passing[0]!.parser, reason: 'Only one candidate passed the completed DOCX quality gates.' }
  if (passing.length === 0) return { primary: null, reason: 'No candidate passed the completed DOCX quality gates.' }
  const ranked = [...passing].sort((left, right) =>
    left.p95.wallMilliseconds - right.p95.wallMilliseconds
    || (left.p95.peakRssBytes ?? Number.MAX_SAFE_INTEGER) - (right.p95.peakRssBytes ?? Number.MAX_SAFE_INTEGER)
    || (left.parser === 'mammoth' ? -1 : right.parser === 'mammoth' ? 1 : left.parser.localeCompare(right.parser)))
  return { primary: ranked[0]!.parser, reason: 'Both candidates passed; the binding wall/RSS/dependency tie-breaker selected the primary.' }
}
function percentile(walls: readonly number[], rss: readonly (number | undefined)[], cpu: readonly (number | undefined)[]): { readonly wallMilliseconds: number; readonly peakRssBytes?: number; readonly cpuMilliseconds?: number } {
  const at95 = (values: readonly (number | undefined)[]): number | undefined => { const finite = values.filter((item): item is number => item !== undefined).sort((a, b) => a - b); return finite.length ? finite[Math.ceil(finite.length * .95) - 1] : undefined }
  const wall = at95(walls) ?? 0
  const peakRss = at95(rss)
  const cpuTime = at95(cpu)
  return {
    wallMilliseconds: bucket(wall, 1_000),
    ...(peakRss === undefined ? {} : { peakRssBytes: bucket(peakRss, 128 * 1024 * 1024) }),
    ...(cpuTime === undefined ? {} : { cpuMilliseconds: bucket(cpuTime, 1_000) }),
  }
}
function canonicalHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function compactRun(run: ParserRunResult): unknown {
  return {
    outcome: run.outcome,
    hashes: run.hashes,
    diagnostics: run.diagnostics,
    metadata: {
      sourceBytes: run.metadata.sourceBytes,
      rssMeasurement: run.metadata.rssMeasurement,
      productionEquivalent: run.metadata.productionEquivalent,
      maxConcurrentChildren: run.metadata.maxConcurrentChildren,
      cleanedUp: run.metadata.cleanedUp,
    },
  }
}
function bucket(value: number, width: number): number { return Math.ceil(value / width) * width }
function compactAssertions(result: StructuralAssertionResult): unknown { return { passed: result.passed, admitted: result.admitted, requiredFailures: result.assertions.filter((item) => item.role === 'required' && !item.passed).map((item) => item.id) } }
function resolveFixture(fixture: AnydocFixtureManifest): string { if (fixture.source.kind !== 'file') throw new Error('Fixture bytes unavailable'); return resolve(directory, fixture.source.path) }
function readFixture(fixture: AnydocFixtureManifest): Promise<Buffer> { return readFile(resolveFixture(fixture)) }
