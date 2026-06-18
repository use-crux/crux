import type { IndexPatch, IndexPatchFacts } from '../patches'
import {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexFactEnvelope,
  type ProjectIndexFactEnvelopeFor,
  type ProjectIndexFactProducer,
  type ProjectIndexPatchFactKind,
  type ProjectIndexPatchFactMap,
  type ProjectIndexWorkerEvent,
} from './types'

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
  const facts = factEnvelopesFromIndexPatch(patch, options.producer)
  const maxFactsPerBatch = Math.max(1, options.maxFactsPerBatch ?? 100)
  const events: ProjectIndexWorkerEvent[] = [
    {
      protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
      type: 'phase:start',
      transactionId: options.transactionId,
      phase: patch.phase,
      root: patch.project.root,
      startedAt: patch.startedAt,
    },
  ]

  for (let offset = 0, sequence = 0; offset < facts.length; offset += maxFactsPerBatch, sequence += 1) {
    events.push({
      protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
      type: 'fact:batch',
      transactionId: options.transactionId,
      sequence,
      facts: facts.slice(offset, offset + maxFactsPerBatch),
    })
  }

  const { facts: _facts, ...patchMetadata } = patch
  events.push({
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'phase:done',
    transactionId: options.transactionId,
    phase: patch.phase,
    patch: patchMetadata,
    summary: { factCount: facts.length },
  })

  return events
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
  for (const event of events) {
    if (event.type !== 'fact:batch') continue
    for (const envelope of event.facts) {
      addEnvelopeFact(facts, envelope)
    }
  }

  return { ...done.patch, facts }
}

/**
 * Converts patch facts into typed envelopes without exposing patch metadata.
 */
export function factEnvelopesFromIndexPatch(
  patch: IndexPatch,
  producer: ProjectIndexFactProducer,
): readonly ProjectIndexFactEnvelope[] {
  const facts: ProjectIndexFactEnvelope[] = []
  for (const kind of patchFactKinds) {
    addFactsForKind(facts, patch, producer, kind)
  }
  return facts
}

type MutableIndexPatchFacts = {
  -readonly [TKey in keyof IndexPatchFacts]: IndexPatchFacts[TKey]
}

function addFactsForKind<TKind extends ProjectIndexPatchFactKind>(
  facts: ProjectIndexFactEnvelope[],
  patch: IndexPatch,
  producer: ProjectIndexFactProducer,
  kind: TKind,
): void {
  const value = patch.facts[kind]
  if (value === undefined) return

  if (Array.isArray(value)) {
    value.forEach((fact, index) => {
      facts.push(
        factEnvelopeForKind(
          patch,
          producer,
          kind,
          fact as unknown as ProjectIndexPatchFactMap[TKind],
          index,
        ) as ProjectIndexFactEnvelope,
      )
    })
    return
  }

  facts.push(
    factEnvelopeForKind(patch, producer, kind, value as unknown as ProjectIndexPatchFactMap[TKind], 0) as ProjectIndexFactEnvelope,
  )
}

function factEnvelopeForKind<TKind extends ProjectIndexPatchFactKind>(
  patch: IndexPatch,
  producer: ProjectIndexFactProducer,
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
    producer,
    fact,
  }
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
