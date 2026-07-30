import type { IndexPatch } from "../patches";
import {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexFactEnvelope,
  type ProjectIndexFactEnvelopeFor,
  type ProjectIndexFactFidelity,
  type ProjectIndexFactProducer,
  type ProjectIndexFactProvenance,
  type ProjectIndexPatchFactKind,
  type ProjectIndexPatchFactMap,
  type ProjectIndexWorkerEvent,
} from "./types";
import {
  canonicalDefinitionExtractors,
  canonicalFactExtractorMap,
  canonicalFactExtractors,
  type ProjectIndexFactExtractorProvenance,
} from "../fact-provenance";
import {
  projectIndexFactBatchEvents,
  projectIndexSourceProfileBatchEvents,
} from "./event-batches";
import { semanticSourceProfileFromStreamFiles } from "./source-profile-events";
import {
  factGroupsFromPatchFacts,
  prepareFactGroupReconstruction,
  projectIndexFactGroups,
  type MutableIndexPatchFacts,
} from "./fact-groups";

/** Options for converting an `IndexPatch` into worker stream events. */
export interface IndexPatchToWorkerEventsOptions {
  /** Transaction id shared by every event for this patch. */
  readonly transactionId: string;
  /** Worker/backend identity attached to every fact envelope. */
  readonly producer: ProjectIndexFactProducer;
  /** Evidence fidelity attached to each emitted fact. Defaults from the patch phase. */
  readonly fidelity?: ProjectIndexFactFidelity;
  /** Provenance attached to each emitted fact. Defaults from the patch phase. */
  readonly provenance?: ProjectIndexFactProvenance;
  /** Maximum facts per `fact:batch` event. Defaults to 100. */
  readonly maxFactsPerBatch?: number;
  /**
   * Maximum serialized bytes per worker event.
   *
   * This guards the host's per-line reader limit independently from the total
   * stream budget. Individual facts larger than this limit are emitted alone.
   */
  readonly maxEventBytes?: number;
}

/**
 * Converts an `IndexPatch` into a complete V3 worker event sequence.
 *
 * The returned sequence always starts with `phase:start`, emits zero or more
 * ordered `fact:batch` events, and ends with `phase:done`.
 */
export function indexPatchToWorkerEvents(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
): ProjectIndexWorkerEvent[] {
  return [...indexPatchToWorkerEventStream(patch, options)];
}

/**
 * Streams V3 worker events for an index patch without materializing every
 * envelope and event at once.
 */
export function* indexPatchToWorkerEventStream(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
): Iterable<ProjectIndexWorkerEvent> {
  const maxFactsPerBatch = Math.max(1, options.maxFactsPerBatch ?? 100);
  const factGroups = factGroupsFromPatchFacts(patch.facts);
  let factCount = 0;

  yield {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: "phase:start",
    transactionId: options.transactionId,
    phase: patch.phase,
    root: patch.project.root,
    startedAt: patch.startedAt,
  };

  for (const event of projectIndexFactBatchEvents(
    factEnvelopesForIndexPatch(patch, options),
    {
      transactionId: options.transactionId,
      maxItemsPerBatch: maxFactsPerBatch,
      maxEventBytes: options.maxEventBytes,
    },
  )) {
    factCount += event.facts.length;
    yield event;
  }

  for (const event of projectIndexSourceProfileBatchEvents(
    patch.semanticSourceProfile?.files ?? [],
    {
      transactionId: options.transactionId,
      maxItemsPerBatch: maxFactsPerBatch,
      maxEventBytes: options.maxEventBytes,
    },
  )) {
    yield event;
  }

  const {
    facts: _facts,
    definitionExtractors: _definitionExtractors,
    factExtractors: _factExtractors,
    ...patchMetadata
  } = patch;
  yield {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: "phase:done",
    transactionId: options.transactionId,
    phase: patch.phase,
    patch: patchMetadata,
    summary: { factCount, factGroups },
  };
}

/**
 * Reconstructs one `IndexPatch` from a V3 worker event sequence.
 *
 * This helper is intentionally small and test-oriented. The Go host performs
 * the production validation before applying streamed patches.
 */
export function indexPatchFromWorkerEvents(
  events: readonly ProjectIndexWorkerEvent[],
): IndexPatch {
  const done = events.find(
    (
      event,
    ): event is Extract<ProjectIndexWorkerEvent, { type: "phase:done" }> => {
      return event.type === "phase:done";
    },
  );
  if (!done) throw new Error("worker event sequence is missing phase:done");

  const definitionExtractors: Record<
    string,
    ProjectIndexFactExtractorProvenance[]
  > = {};
  const factExtractors: Record<string, ProjectIndexFactExtractorProvenance[]> =
    {};
  const sourceProfileFiles: Array<
    NonNullable<IndexPatch["semanticSourceProfile"]>["files"][number]
  > = [];
  const envelopes: ProjectIndexFactEnvelope[] = [];
  for (const event of events) {
    if (event.type === "fact:batch") {
      envelopes.push(...event.facts);
    }
    if (event.type === "sourceProfile:batch") {
      sourceProfileFiles.push(...event.files);
    }
  }
  const facts = prepareFactGroupReconstruction(done.summary, envelopes);
  for (const envelope of envelopes) {
    addEnvelopeFact(facts, envelope);
    addEnvelopeExtractors(definitionExtractors, factExtractors, envelope);
  }

  const semanticSourceProfile =
    done.patch.semanticSourceProfile ??
    (sourceProfileFiles.length > 0
      ? semanticSourceProfileFromStreamFiles(sourceProfileFiles)
      : undefined);
  const canonicalDefinitions =
    canonicalDefinitionExtractors(definitionExtractors);
  const canonicalFacts = canonicalFactExtractorMap(factExtractors);

  return {
    ...done.patch,
    facts,
    ...(canonicalDefinitions
      ? { definitionExtractors: canonicalDefinitions }
      : {}),
    ...(canonicalFacts ? { factExtractors: canonicalFacts } : {}),
    ...(semanticSourceProfile ? { semanticSourceProfile } : {}),
  };
}

/**
 * Converts patch facts into typed envelopes without exposing patch metadata.
 */
export function factEnvelopesFromIndexPatch(
  patch: IndexPatch,
  producer: ProjectIndexFactProducer,
): readonly ProjectIndexFactEnvelope[] {
  return [
    ...factEnvelopesForIndexPatch(patch, {
      transactionId: "fact-envelopes",
      producer,
    }),
  ];
}

function* factEnvelopesForIndexPatch(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
): Iterable<ProjectIndexFactEnvelope> {
  for (const kind of projectIndexFactGroups) {
    yield* factEnvelopesForKind(patch, options, kind);
  }
}

function* factEnvelopesForKind<TKind extends ProjectIndexPatchFactKind>(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
  kind: TKind,
): Iterable<ProjectIndexFactEnvelope> {
  const value = patch.facts[kind];
  if (value === undefined) return;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const fact = value[index];
      yield factEnvelopeForKind(
        patch,
        options,
        kind,
        fact as unknown as ProjectIndexPatchFactMap[TKind],
        index,
      ) as ProjectIndexFactEnvelope;
    }
    return;
  }

  yield factEnvelopeForKind(
    patch,
    options,
    kind,
    value as unknown as ProjectIndexPatchFactMap[TKind],
    0,
  ) as ProjectIndexFactEnvelope;
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
    provenance: factProvenance(patch, options, kind, fact),
    fact,
  };
}

function defaultFactFidelity(patch: IndexPatch): ProjectIndexFactFidelity {
  return patch.phase === "runtime" ? "runtime-observed" : "inferred";
}

function defaultFactProvenance(patch: IndexPatch): ProjectIndexFactProvenance {
  return patch.phase === "runtime"
    ? { kind: "runtime", attribute: "project-index.runtime" }
    : { kind: "runtime", attribute: `project-index.${patch.phase}` };
}

function factProvenance<TKind extends ProjectIndexPatchFactKind>(
  patch: IndexPatch,
  options: IndexPatchToWorkerEventsOptions,
  kind: TKind,
  fact: ProjectIndexPatchFactMap[TKind],
): ProjectIndexFactProvenance {
  const base = options.provenance ?? defaultFactProvenance(patch);
  const extractors = canonicalFactExtractors([
    ...(patch.factExtractors?.[factExtractorKey(kind, fact)] ?? []),
    ...(kind === "definitions" && typeof objectRecord(fact).id === "string"
      ? (patch.definitionExtractors?.[objectRecord(fact).id as string] ?? [])
      : []),
  ]);
  return extractors.length > 0 ? { ...base, extractors } : base;
}

function factExtractorKey(
  kind: ProjectIndexPatchFactKind,
  fact: unknown,
): string {
  const value = objectRecord(fact);
  if (kind === "sourceRefs") {
    const ref = objectRecord(value.ref);
    if (typeof value.definitionId === "string" && typeof ref.id === "string") {
      return `sourceRefs:${value.definitionId}:${ref.id}`;
    }
  }
  const id = stringValue(value.id);
  return id ? `${kind}:${id}` : `${kind}:unknown`;
}

function addEnvelopeExtractors(
  definitionExtractors: Record<string, ProjectIndexFactExtractorProvenance[]>,
  factExtractors: Record<string, ProjectIndexFactExtractorProvenance[]>,
  envelope: ProjectIndexFactEnvelope,
): void {
  const extractors = envelope.provenance.extractors;
  if (!extractors?.length) return;

  (factExtractors[factExtractorKey(envelope.kind, envelope.fact)] ??= []).push(
    ...extractors,
  );
  if (envelope.kind !== "definitions") return;

  const definitionId = stringValue(objectRecord(envelope.fact).id);
  if (!definitionId) return;
  (definitionExtractors[definitionId] ??= []).push(...extractors);
}

function indexPatchFactId(
  kind: ProjectIndexPatchFactKind,
  fact: unknown,
  index: number,
): string {
  const candidate = objectRecord(fact);
  const stableId =
    stringValue(candidate.id) ??
    stringValue(candidate.file) ??
    stringValue(candidate.name) ??
    stringValue(candidate.ruleId) ??
    stringValue(candidate.ruleID);
  if (stableId) return `${kind}:${stableId}`;
  return `${kind}:${index}`;
}

function addEnvelopeFact(
  facts: MutableIndexPatchFacts,
  envelope: ProjectIndexFactEnvelope,
): void {
  switch (envelope.kind) {
    case "prompts":
      facts.prompts = [...(facts.prompts ?? []), envelope.fact];
      return;
    case "contexts":
      facts.contexts = [...(facts.contexts ?? []), envelope.fact];
      return;
    case "tools":
      facts.tools = [...(facts.tools ?? []), envelope.fact];
      return;
    case "lint":
      facts.lint = envelope.fact;
      return;
    case "definitions":
      facts.definitions = [...(facts.definitions ?? []), envelope.fact];
      return;
    case "relations":
      facts.relations = [...(facts.relations ?? []), envelope.fact];
      return;
    case "sourceRefs":
      facts.sourceRefs = [...(facts.sourceRefs ?? []), envelope.fact];
      return;
    case "diagnostics":
      facts.diagnostics = [...(facts.diagnostics ?? []), envelope.fact];
      return;
    case "lintFindings":
      facts.lintFindings = [...(facts.lintFindings ?? []), envelope.fact];
      return;
    case "ruleDescriptors":
      facts.ruleDescriptors = [...(facts.ruleDescriptors ?? []), envelope.fact];
      return;
    case "sources":
      facts.sources = [...(facts.sources ?? []), envelope.fact];
      return;
    case "sourceGraph":
      facts.sourceGraph = envelope.fact;
      return;
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
