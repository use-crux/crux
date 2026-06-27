import type { IndexPatch, IndexPatchFacts } from '../patches'
import {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexFactEnvelope,
  type ProjectIndexFactEnvelopeFor,
  type ProjectIndexFactFidelity,
  type ProjectIndexFactProducer,
  type ProjectIndexPatchFactKind,
  type ProjectIndexPatchFactMap,
  type ProjectIndexWorkerEvent,
} from './types'
import type { ProjectModelProvenance } from '@use-crux/core/project-index'
import { semanticSourceProfileFromStreamFiles, sourceProfileBatches } from './source-profile-events'

const patchFactKinds = [
  'prompts',
  'contexts',
  'tools',
  'lint',
  'definitions',
  'relations',
  'sourceRefs',
  'diagnostics',
  'lintFindings',
  'ruleDescriptors',
  'sources',
  'sourceGraph',
] as const satisfies readonly ProjectIndexPatchFactKind[]

/** Options for converting an `IndexPatch` into worker stream events. */
export interface IndexPatchToWorkerEventsOptions {
  /** Transaction id shared by every event for this patch. */
  readonly transactionId: string
  /** Worker/backend identity attached to every fact envelope. */
  readonly producer: ProjectIndexFactProducer
  /** Evidence fidelity attached to each emitted fact. Defaults from the patch phase. */
  readonly fidelity?: ProjectIndexFactFidelity
  /** Provenance attached to each emitted fact. Defaults from the patch phase. */
  readonly provenance?: ProjectModelProvenance
  /** Maximum facts per `fact:batch` event. Defaults to 100. */
  readonly maxFactsPerBatch?: number
}

/**
 * Converts an `IndexPatch` into a complete V2 worker event sequence.
 *
 * The returned sequence always starts with `phase:start`, emits zero or more
 * ordered `fact:batch` events, and ends with `phase:done`.
 */
export function indexPatchToWorkerEvents(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
): ProjectIndexWorkerEvent[] {
  return [...indexPatchToWorkerEventStream(patch, options)]
}

/**
 * Streams V2 worker events for an index patch without materializing every
 * envelope and event at once.
 */
export function* indexPatchToWorkerEventStream(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
): Iterable<ProjectIndexWorkerEvent> {
  const maxFactsPerBatch = Math.max(1, options.maxFactsPerBatch ?? 100)
  let sequence = 0
  let sourceProfileSequence = 0
  let factCount = 0
  let batch: ProjectIndexFactEnvelope[] = []

  yield {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'phase:start',
    transactionId: options.transactionId,
    phase: patch.phase,
    root: patch.project.root,
    startedAt: patch.startedAt,
  }

  for (const fact of factEnvelopesForIndexPatch(patch, options)) {
    batch.push(fact)
    factCount += 1
    if (batch.length < maxFactsPerBatch) continue
    yield {
      protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
      type: 'fact:batch',
      transactionId: options.transactionId,
      sequence,
      facts: batch,
    }
    sequence += 1
    batch = []
  }

  if (batch.length > 0) {
    yield {
      protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
      type: 'fact:batch',
      transactionId: options.transactionId,
      sequence,
      facts: batch,
    }
  }

  for (const files of sourceProfileBatches(patch.semanticSourceProfile?.files ?? [], maxFactsPerBatch)) {
    yield {
      protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
      type: 'sourceProfile:batch',
      transactionId: options.transactionId,
      sequence: sourceProfileSequence,
      files,
    }
    sourceProfileSequence += 1
  }

  const { facts: _facts, semanticSourceProfile: _semanticSourceProfile, ...patchMetadata } = patch
  yield {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'phase:done',
    transactionId: options.transactionId,
    phase: patch.phase,
    patch: patchMetadata,
    summary: { factCount },
  }
}

/**
 * Reconstructs one `IndexPatch` from a V2 worker event sequence.
 *
 * This helper is intentionally small and test-oriented. The Go host performs
 * the production validation before applying streamed patches.
 */
export function indexPatchFromWorkerEvents(events: readonly ProjectIndexWorkerEvent[]): IndexPatch {
  const done = events.find((event): event is Extract<ProjectIndexWorkerEvent, { type: 'phase:done' }> => {
    return event.type === 'phase:done'
  })
  if (!done) throw new Error('worker event sequence is missing phase:done')

  const facts: MutableIndexPatchFacts = {}
  const sourceProfileFiles: Array<NonNullable<IndexPatch['semanticSourceProfile']>['files'][number]> = []
  for (const event of events) {
    if (event.type === 'fact:batch') {
      for (const envelope of event.facts) {
        addEnvelopeFact(facts, envelope)
      }
    }
    if (event.type === 'sourceProfile:batch') {
      sourceProfileFiles.push(...event.files)
    }
  }

  return {
    ...done.patch,
    facts,
    ...(sourceProfileFiles.length > 0
      ? { semanticSourceProfile: semanticSourceProfileFromStreamFiles(sourceProfileFiles) }
      : {}),
  }
}

/**
 * Converts patch facts into typed envelopes without exposing patch metadata.
 */
export function factEnvelopesFromIndexPatch(
  patch: IndexPatch,
  producer: ProjectIndexFactProducer,
): readonly ProjectIndexFactEnvelope[] {
  return [...factEnvelopesForIndexPatch(patch, { transactionId: 'fact-envelopes', producer })]
}

function* factEnvelopesForIndexPatch(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
): Iterable<ProjectIndexFactEnvelope> {
  for (const kind of patchFactKinds) {
    yield* factEnvelopesForKind(patch, options, kind)
  }
}

type MutableIndexPatchFacts = {
  -readonly [TKey in keyof IndexPatchFacts]: IndexPatchFacts[TKey]
}

function* factEnvelopesForKind<TKind extends ProjectIndexPatchFactKind>(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
  kind: TKind,
): Iterable<ProjectIndexFactEnvelope> {
  const value = patch.facts[kind]
  if (value === undefined) return

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const fact = value[index]
      yield factEnvelopeForKind(
        patch,
        options,
        kind,
        fact as unknown as ProjectIndexPatchFactMap[TKind],
        index,
      ) as ProjectIndexFactEnvelope
    }
    return
  }

  yield factEnvelopeForKind(
    patch,
    options,
    kind,
    value as unknown as ProjectIndexPatchFactMap[TKind],
    0,
  ) as ProjectIndexFactEnvelope
}

function factEnvelopeForKind<TKind extends ProjectIndexPatchFactKind>(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
  kind: TKind,
  fact: ProjectIndexPatchFactMap[TKind],
  index: number,
): ProjectIndexFactEnvelopeFor<TKind> {
  return {
    schemaVersion: 1,
    factId: indexPatchFactId(kind, fact, index),
    kind,
    phase: patch.phase,
    projectRoot: patch.project.root,
    producer: options.producer,
    fidelity: options.fidelity ?? defaultFactFidelity(patch),
    provenance: options.provenance ?? defaultFactProvenance(patch),
    fact,
  }
}

function defaultFactFidelity(patch: IndexPatch): ProjectIndexFactFidelity {
  return patch.phase === 'runtime' ? 'runtime-observed' : 'inferred'
}

function defaultFactProvenance(patch: IndexPatch): ProjectModelProvenance {
  return patch.phase === 'runtime'
    ? { kind: 'runtime', attribute: 'project-index.runtime' }
    : { kind: 'runtime', attribute: `project-index.${patch.phase}` }
}

function indexPatchFactId(kind: ProjectIndexPatchFactKind, fact: unknown, index: number): string {
  const candidate = objectRecord(fact)
  const stableId =
    stringValue(candidate.id) ??
    stringValue(candidate.file) ??
    stringValue(candidate.name) ??
    stringValue(candidate.ruleId) ??
    stringValue(candidate.ruleID)
  if (stableId) return `${kind}:${stableId}`
  return `${kind}:${index}`
}

function addEnvelopeFact(facts: MutableIndexPatchFacts, envelope: ProjectIndexFactEnvelope): void {
  switch (envelope.kind) {
    case 'prompts':
      facts.prompts = [...(facts.prompts ?? []), envelope.fact]
      return
    case 'contexts':
      facts.contexts = [...(facts.contexts ?? []), envelope.fact]
      return
    case 'tools':
      facts.tools = [...(facts.tools ?? []), envelope.fact]
      return
    case 'lint':
      facts.lint = envelope.fact
      return
    case 'definitions':
      facts.definitions = [...(facts.definitions ?? []), envelope.fact]
      return
    case 'relations':
      facts.relations = [...(facts.relations ?? []), envelope.fact]
      return
    case 'sourceRefs':
      facts.sourceRefs = [...(facts.sourceRefs ?? []), envelope.fact]
      return
    case 'diagnostics':
      facts.diagnostics = [...(facts.diagnostics ?? []), envelope.fact]
      return
    case 'lintFindings':
      facts.lintFindings = [...(facts.lintFindings ?? []), envelope.fact]
      return
    case 'ruleDescriptors':
      facts.ruleDescriptors = [...(facts.ruleDescriptors ?? []), envelope.fact]
      return
    case 'sources':
      facts.sources = [...(facts.sources ?? []), envelope.fact]
      return
    case 'sourceGraph':
      facts.sourceGraph = envelope.fact
      return
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
