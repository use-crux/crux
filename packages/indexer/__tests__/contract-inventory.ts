/**
 * Current inventory for the native runtime architecture refactor.
 *
 * The inventory is intentionally data-only and test-owned. It records the
 * canonical TypeScript contract spine plus the Go/Rust mirrors that must stay
 * aligned while the native runtime boundary evolves.
 *
 * @module
 */

/** Contract groups that have to stay visible through the native runtime split. */
export const nativeRuntimeContractIds = [
  'worker-events',
  'static-syntax-records',
  'static-index',
  'semantic-evidence',
] as const

/** Stable identifier for one current contract group. */
export type NativeRuntimeContractId = (typeof nativeRuntimeContractIds)[number]

/** Legacy contract identifier kept only to make target replacement rows explicit. */
export type NativeRuntimeLegacyContractId = 'native-static-protocol'

/** Language/runtime that owns or mirrors a contract file today. */
export type NativeRuntimeContractOwner = 'typescript' | 'go' | 'rust'

/** Current file role inside a contract group. */
export type NativeRuntimeContractFileKind =
  | 'canonical-types'
  | 'schema'
  | 'parser'
  | 'host-mirror'
  | 'native-mirror'
  | 'streaming'
  | 'test'

/** One source file that participates in a current cross-language contract. */
export interface NativeRuntimeContractFile<TOwner extends NativeRuntimeContractOwner = NativeRuntimeContractOwner> {
  /** Runtime or language owner for this file. */
  readonly owner: TOwner
  /** Repository-relative path. */
  readonly path: string
  /** Short reason this file belongs in the contract inventory. */
  readonly role: string
  /** Machine-readable role used by the inventory test and docs. */
  readonly kind: NativeRuntimeContractFileKind
}

/** Owner-bucketed file list for one contract group. */
export type NativeRuntimeContractFilesByOwner = {
  readonly [TOwner in NativeRuntimeContractOwner]: readonly NativeRuntimeContractFile<TOwner>[]
}

/** Whether a current contract already has all intended language mirrors. */
export type NativeRuntimeContractMirrorStatus = 'mirrored' | 'partial-mirror' | 'typescript-only'

interface NativeRuntimeContractEntryBase<TId extends NativeRuntimeContractId> {
  readonly id: TId
  readonly label: string
  readonly boundary: string
  readonly renamesFrom?: NativeRuntimeLegacyContractId
  readonly canonicalOwner: 'typescript'
  readonly mirrorStatus: NativeRuntimeContractMirrorStatus
  readonly filesByOwner: NativeRuntimeContractFilesByOwner
  readonly fixtureGap: string
}

/** Public inventory row with owner buckets and a flattened file list. */
export interface NativeRuntimeContractEntry<TId extends NativeRuntimeContractId = NativeRuntimeContractId>
  extends NativeRuntimeContractEntryBase<TId> {
  /** Flattened files in TypeScript, Go, Rust order. */
  readonly files: readonly NativeRuntimeContractFile[]
}

type NativeRuntimeContractIndex = {
  readonly [TId in NativeRuntimeContractId]: NativeRuntimeContractEntryBase<TId>
}

const contractOwners = ['typescript', 'go', 'rust'] as const satisfies readonly NativeRuntimeContractOwner[]

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
          'packages/indexer/indexer/contracts/worker-events/schema.ts',
          'Canonical contract-spine barrel for worker events, fact envelopes, artifacts, and stream helpers.',
          'canonical-types',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/contracts/worker-events/fixtures.ts',
          'TypeScript-owned worker-event fixtures used by schema and stream round-trip tests.',
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
          'crates/crux-indexer-worker/src/index_compiler/finalizer/events.rs',
          'Rust index compiler finalizer emits Project Index worker protocol events as JSON values.',
          'native-mirror',
        ),
      ],
    },
    fixtureGap:
      'Shared success-path worker-event fixtures are consumed by TypeScript, Go, and Rust; remaining gaps are artifact, phase-error, and out-of-order stream fixtures.',
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
          'packages/indexer/indexer/contracts/static-syntax/schema.ts',
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
          'crates/crux-indexer-worker/src/shared_fixtures_tests.rs',
          'Shared fixture decoder for static syntax record JSON.',
          'test',
        ),
      ],
    },
    fixtureGap:
      'A shared static syntax record fixture covers imports, call matches, object values, and native fact packets; remaining gaps are constructor matches, callback summaries, and parser diagnostic cases.',
  },
  'static-index': {
    id: 'static-index',
    label: 'Static Index compiler protocol',
    boundary:
      'Target Static Index prepare, analyze, finalize, and compile handoff that replaces current native-static protocol naming.',
    renamesFrom: 'native-static-protocol',
    canonicalOwner: 'typescript',
    mirrorStatus: 'mirrored',
    filesByOwner: {
      typescript: [
        contractFile(
          'typescript',
          'packages/indexer/indexer/contracts/static-index/schema.ts',
          'Canonical contract-spine barrel for Static Index protocol schemas.',
          'schema',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/contracts/static-index/fixtures.ts',
          'TypeScript-owned Static Index request/response fixtures.',
          'test',
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
          'Go streaming decoder for analyze/finalize/compile native static events.',
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
          'Go construction of native static cache-sensitive run identity.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/staticindex/protocol/shared_fixtures_test.go',
          'Shared fixture decoder for native static protocol JSON.',
          'test',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/protocol/src/native_static.rs',
          'Rust protocol ABI to rename only when TS, Go, and Rust method names move together.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/shared_fixtures_tests.rs',
          'Shared fixture decoder for native static protocol JSON and pipeline behavior.',
          'test',
        ),
      ],
    },
    fixtureGap:
      'The current native static protocol fixture is decoded by TypeScript, Go, and Rust for every method; Phase 7 will rename it to Static Index while preserving explicit protocol-error and invalid-stream fixture gaps.',
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
          'packages/indexer/indexer/contracts/semantic/schema.ts',
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
      'Semantic backend parity compares normalized Project Index facts, but no shared semantic evidence fixture files cover definitions, relations, source refs, diagnostics, lint findings, and degraded/unsupported cases.',
  },
} satisfies NativeRuntimeContractIndex

/** Returns current contract groups in migration order. */
export function nativeRuntimeContractInventory(): readonly NativeRuntimeContractEntry[] {
  return nativeRuntimeContractIds.map((id) => entryWithFiles(inventory[id]))
}

function entryWithFiles<TId extends NativeRuntimeContractId>(
  entry: NativeRuntimeContractEntryBase<TId>,
): NativeRuntimeContractEntry<TId> {
  const files: NativeRuntimeContractFile[] = []
  for (const owner of contractOwners) files.push(...entry.filesByOwner[owner])
  return {
    ...entry,
    files,
  }
}

function contractFile<TOwner extends NativeRuntimeContractOwner>(
  owner: TOwner,
  path: string,
  role: string,
  kind: NativeRuntimeContractFileKind,
): NativeRuntimeContractFile<TOwner> {
  return { owner, path, role, kind }
}
