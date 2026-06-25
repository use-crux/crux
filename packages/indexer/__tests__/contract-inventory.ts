/**
 * Current inventory for the Static Index runtime architecture refactor.
 *
 * The inventory is intentionally data-only and test-owned. It records the
 * canonical TypeScript contract spine plus the Go/Rust mirrors that must stay
 * aligned while the Static Index runtime boundary evolves.
 *
 * @module
 */

/** Contract groups that have to stay visible through the Static Index runtime split. */
export const staticIndexRuntimeContractIds = [
  'worker-events',
  'static-syntax-records',
  'static-index',
  'semantic-evidence',
] as const

/** Stable identifier for one current contract group. */
export type StaticIndexRuntimeContractId = (typeof staticIndexRuntimeContractIds)[number]

/** Language/runtime that owns or mirrors a contract file today. */
export type StaticIndexRuntimeContractOwner = 'typescript' | 'go' | 'rust'

/** Current file role inside a contract group. */
export type StaticIndexRuntimeContractFileKind =
  | 'canonical-types'
  | 'identity'
  | 'schema'
  | 'parser'
  | 'host-mirror'
  | 'native-mirror'
  | 'streaming'
  | 'test'

/** One source file that participates in a current cross-language contract. */
export interface StaticIndexRuntimeContractFile<TOwner extends StaticIndexRuntimeContractOwner = StaticIndexRuntimeContractOwner> {
  /** Runtime or language owner for this file. */
  readonly owner: TOwner
  /** Repository-relative path. */
  readonly path: string
  /** Short reason this file belongs in the contract inventory. */
  readonly role: string
  /** Machine-readable role used by the inventory test and docs. */
  readonly kind: StaticIndexRuntimeContractFileKind
}

/** Owner-bucketed file list for one contract group. */
export type StaticIndexRuntimeContractFilesByOwner = {
  readonly [TOwner in StaticIndexRuntimeContractOwner]: readonly StaticIndexRuntimeContractFile<TOwner>[]
}

/** Whether a current contract already has all intended language mirrors. */
export type StaticIndexRuntimeContractMirrorStatus = 'mirrored' | 'partial-mirror' | 'typescript-only'

interface StaticIndexRuntimeContractEntryBase<TId extends StaticIndexRuntimeContractId> {
  readonly id: TId
  readonly label: string
  readonly boundary: string
  readonly canonicalOwner: 'typescript'
  readonly mirrorStatus: StaticIndexRuntimeContractMirrorStatus
  readonly filesByOwner: StaticIndexRuntimeContractFilesByOwner
  readonly fixtureGap: string
}

/** Public inventory row with owner buckets and a flattened file list. */
export interface StaticIndexRuntimeContractEntry<TId extends StaticIndexRuntimeContractId = StaticIndexRuntimeContractId>
  extends StaticIndexRuntimeContractEntryBase<TId> {
  /** Flattened files in TypeScript, Go, Rust order. */
  readonly files: readonly StaticIndexRuntimeContractFile[]
}

type StaticIndexRuntimeContractIndex = {
  readonly [TId in StaticIndexRuntimeContractId]: StaticIndexRuntimeContractEntryBase<TId>
}

const contractOwners = ['typescript', 'go', 'rust'] as const satisfies readonly StaticIndexRuntimeContractOwner[]

const inventory = {
  'worker-events': {
    id: 'worker-events',
    label: 'Project Index worker events',
    boundary: 'Versioned NDJSON event stream that carries patch facts, source profiles, and artifacts.',
    canonicalOwner: 'typescript',
    mirrorStatus: 'partial-mirror',
    filesByOwner: {
      typescript: [
        contractFile(
          'typescript',
          'packages/indexer/contracts/worker-events/schema.ts',
          'Canonical contract-spine barrel for worker events, fact envelopes, artifacts, and stream helpers.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/worker-events/fixtures.ts',
          'TypeScript-owned worker-event fixtures used by schema and stream round-trip tests.',
          'test',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/fixtures/worker-event-cases.json',
          'Shared artifact, phase-error, and out-of-order worker-event case fixtures.',
          'test',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/worker-protocol/patch-events.ts',
          'Patch-to-event projection and event-to-patch reconstruction.',
          'parser',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/worker-protocol/artifact-events.ts',
          'Typed artifact event projection for Project Model and config read models.',
          'parser',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/worker-protocol/source-profile-events.ts',
          'Semantic source-profile batch projection for AST phase events.',
          'parser',
        ),
      ],
      go: [
        contractFile(
          'go',
          'packages/local/internal/projectindex/wire/worker_protocol.go',
          'Host-side V2 worker event collector and transaction validation.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/wire/worker_protocol_facts.go',
          'Fact envelope decoding into Go Project Index patch facts.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/wire/worker_protocol_source_profile.go',
          'Source-profile batch decoding for semantic preflight handoff.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/wire/worker_artifact.go',
          'Artifact event decoding outside the durable patch fact stream.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/wire/shared_fixtures_test.go',
          'Shared fixture decoder for the TypeScript-owned worker event stream JSON.',
          'test',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/protocol/src/worker.rs',
          'Rust worker response envelope and static syntax stream event ABI.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/static-compiler/src/finalizer/events.rs',
          'Rust static compiler finalizer emits Project Index worker protocol events as JSON values.',
          'native-mirror',
        ),
      ],
    },
    fixtureGap:
      'Shared worker-event fixtures are consumed by TypeScript, Go, and Rust for success, artifact, phase-error, and out-of-order stream cases.',
  },
  'static-syntax-records': {
    id: 'static-syntax-records',
    label: 'Static syntax records',
    boundary: 'Parser evidence records emitted by TypeScript or Rust/Oxc before Project Index projection.',
    canonicalOwner: 'typescript',
    mirrorStatus: 'mirrored',
    filesByOwner: {
      typescript: [
        contractFile(
          'typescript',
          'packages/indexer/contracts/static-syntax/schema.ts',
          'Canonical contract-spine barrel for static syntax frontend and record ABI.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/static/syntax-record/types.ts',
          'Implementation owner for static syntax frontend and record types.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/static/syntax-record/value-types.ts',
          'JSON-safe static value and match model used by syntax records.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/static/syntax-record/schema.ts',
          'Schema projection helpers over record-backed static values.',
          'schema',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/fixtures/static-syntax-record-cases.json',
          'Shared constructor, callback-summary, and diagnostic static syntax record cases.',
          'test',
        ),
      ],
      go: [
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/planner/build.go',
          'Go-owned static syntax plan sent to native parser hosts.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/syntax/record/request.go',
          'Static syntax plan to Rust/Oxc parser request conversion.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/syntax/record/collect.go',
          'Static syntax record collection from a configured parser host.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/syntax/event.go',
          'Streaming static syntax event decoder.',
          'streaming',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/syntax/shared_fixtures_test.go',
          'Shared fixture decoder for static syntax record JSON.',
          'test',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/protocol/src/static_syntax.rs',
          'Rust static syntax record, request, response, and stream event ABI.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/syntax-oxc/src/syntax/frontend.rs',
          'Rust/Oxc parser frontend that emits static syntax records before native fact projection.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/static-compiler/src/shared_fixtures_tests.rs',
          'Shared fixture decoder for static syntax record JSON.',
          'test',
        ),
      ],
    },
    fixtureGap:
      'Shared static syntax fixtures cover imports, call matches, object values, native fact packets, constructor matches, callback summaries, and parser diagnostics across TypeScript, Go, and Rust.',
  },
  'static-index': {
    id: 'static-index',
    label: 'Static Index compiler protocol',
    boundary: 'Static Index prepare, analyze, finalize, and compile handoff for source-only Project Index compilation.',
    canonicalOwner: 'typescript',
    mirrorStatus: 'mirrored',
    filesByOwner: {
      typescript: [
        contractFile(
          'typescript',
          'packages/indexer/contracts/static-index/schema.ts',
          'Canonical contract-spine barrel for Static Index protocol schemas.',
          'schema',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/static-index/fixtures.ts',
          'TypeScript-owned Static Index request/response fixtures.',
          'test',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/fixtures/static-index-protocol-cases.json',
          'Shared Static Index protocol worker-error and invalid stream case fixtures.',
          'test',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/fixtures/static-index-identity.json',
          'Shared cache-sensitive Static Index identity manifest used by TypeScript, Go, and Rust parity tests.',
          'identity',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/static-index/protocol/index.ts',
          'Static Index protocol barrel for request, response, identity, telemetry, and parser-interest contracts.',
          'schema',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/static-index/protocol/request.ts',
          'JSON parser and request validation entry point for source-only compiler requests.',
          'parser',
        ),
      ],
      go: [
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/protocol/types.go',
          'Go mirror of source-only compiler request, response, identity, plan, and telemetry structs.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/protocol/stream.go',
          'Go streaming decoder for analyze/finalize/compile Static Index events.',
          'streaming',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/protocol/validation.go',
          'Go protocol version, method, and worker response validation.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/protocol/identity.go',
          'Go construction of Static Index cache-sensitive run identity.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/protocol/shared_fixtures_test.go',
          'Shared fixture decoder for Static Index protocol JSON.',
          'test',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/protocol/src/static_index.rs',
          'Rust protocol ABI for Static Index request, response, identity, plan, and telemetry structs.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/static-compiler/src/shared_fixtures_tests.rs',
          'Shared fixture decoder for Static Index protocol JSON and pipeline behavior.',
          'test',
        ),
      ],
    },
    fixtureGap:
      'Shared Static Index protocol and identity fixtures are decoded by TypeScript, Go, and Rust for every method, cache-sensitive identity owner, worker-error, and invalid-stream case.',
  },
  'semantic-evidence': {
    id: 'semantic-evidence',
    label: 'Semantic evidence batches',
    boundary: 'Backend-neutral semantic facts streamed before shared Project Index projection.',
    canonicalOwner: 'typescript',
    mirrorStatus: 'typescript-only',
    filesByOwner: {
      typescript: [
        contractFile(
          'typescript',
          'packages/indexer/contracts/semantic/schema.ts',
          'Canonical contract-spine barrel for backend-neutral semantic evidence.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/semantic/evidence/projection.ts',
          'Implementation owner for semantic evidence batch kinds and projection helpers.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/semantic/service/types.ts',
          'Shared semantic backend/service contract over evidence-shaped results.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/semantic/backends/tsgo/types.ts',
          'TypeScript-Go semantic backend host types behind the evidence contract.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/contracts/fixtures/semantic-evidence.json',
          'TS-only semantic evidence fixture covering every evidence batch kind.',
          'test',
        ),
      ],
      go: [
        contractFile(
          'go',
          'packages/local/internal/projectindex/host/semantic/worker.go',
          'Go semantic worker host consumes Project Index patch events, not semantic evidence structs.',
          'host-mirror',
        ),
      ],
      rust: [],
    },
    fixtureGap:
      'A TS-only semantic evidence fixture covers definitions, relations, source refs, diagnostics, lint findings, and degraded/unsupported cases; Go hosts consume Project Index patch events today and Rust has no semantic evidence mirror.',
  },
} satisfies StaticIndexRuntimeContractIndex

/** Returns current contract groups in migration order. */
export function staticIndexRuntimeContractInventory(): readonly StaticIndexRuntimeContractEntry[] {
  return staticIndexRuntimeContractIds.map((id) => entryWithFiles(inventory[id]))
}

function entryWithFiles<TId extends StaticIndexRuntimeContractId>(
  entry: StaticIndexRuntimeContractEntryBase<TId>,
): StaticIndexRuntimeContractEntry<TId> {
  const files: StaticIndexRuntimeContractFile[] = []
  for (const owner of contractOwners) files.push(...entry.filesByOwner[owner])
  return {
    ...entry,
    files,
  }
}

function contractFile<TOwner extends StaticIndexRuntimeContractOwner>(
  owner: TOwner,
  path: string,
  role: string,
  kind: StaticIndexRuntimeContractFileKind,
): StaticIndexRuntimeContractFile<TOwner> {
  return { owner, path, role, kind }
}
