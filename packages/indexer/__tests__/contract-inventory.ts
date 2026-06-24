/**
 * Baseline inventory for the native runtime architecture refactor.
 *
 * The inventory is intentionally data-only and test-owned. It records where the
 * current contract definitions and mirrors live before Phase 2 starts moving
 * them behind a visible contract spine.
 *
 * @module
 */

/** Contract groups that have to stay visible through the native runtime split. */
export const nativeRuntimeContractIds = [
  'worker-events',
  'static-syntax-records',
  'native-static-protocol',
  'semantic-evidence',
] as const

/** Stable identifier for one current contract group. */
export type NativeRuntimeContractId = (typeof nativeRuntimeContractIds)[number]

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
          'packages/indexer/indexer/worker-protocol/types.ts',
          'V2 event discriminated union, fact envelope map, and artifact payload map.',
          'canonical-types',
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
          'packages/local/internal/projectindex/worker_protocol.go',
          'Host-side V2 worker event collector and transaction validation.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/worker_protocol_facts.go',
          'Fact envelope decoding into Go Project Index patch facts.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/worker_protocol_source_profile.go',
          'Source-profile batch decoding for semantic preflight handoff.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindex/worker_artifact.go',
          'Artifact event decoding outside the durable patch fact stream.',
          'host-mirror',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/static_compiler/finalizer/events.rs',
          'Native static finalizer emits Project Index worker protocol events as JSON values.',
          'native-mirror',
        ),
      ],
    },
    fixtureGap:
      'No shared worker-event fixture files are consumed by TypeScript, Go, and Rust for success, error, artifact, and out-of-order stream cases.',
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
          'packages/indexer/indexer/static/syntax-record/types.ts',
          'Canonical static syntax frontend and record ABI.',
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
          'packages/local/internal/projectindex/static_plan.go',
          'Go-owned static syntax plan sent to native parser hosts.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindexer/syntaxrecord/request.go',
          'Static syntax plan to Rust/Oxc parser request conversion.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindexer/syntaxrecord/collect.go',
          'Static syntax record collection from a configured parser host.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindexer/syntax/event.go',
          'Streaming syntax worker event decoder.',
          'streaming',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/protocol/syntax_record.rs',
          'Rust static syntax record ABI structs and frontend identity.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/protocol/syntax_worker.rs',
          'Rust syntax worker request, response, and stream event ABI.',
          'native-mirror',
        ),
      ],
    },
    fixtureGap:
      'No shared static syntax record fixture directory covers imports, interests, constructor calls, object values, callbacks, diagnostics, and native fact packets across all three languages.',
  },
  'native-static-protocol': {
    id: 'native-static-protocol',
    label: 'Native static compiler protocol',
    boundary: 'Go/Rust native static prepare, analyze, finalize, and compile handoff.',
    canonicalOwner: 'typescript',
    mirrorStatus: 'mirrored',
    filesByOwner: {
      typescript: [
        contractFile(
          'typescript',
          'packages/indexer/indexer/worker-protocol/native-static.ts',
          'Zod schemas and inferred TypeScript types for native static requests and responses.',
          'schema',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/worker-protocol/native-static-parser-interests.ts',
          'Shared parser-interest schema fragment used by native static and syntax records.',
          'schema',
        ),
        contractFile(
          'typescript',
          'packages/indexer/indexer/worker-protocol/native-static-parse.ts',
          'JSON parser and validation entry point for native static compiler requests.',
          'parser',
        ),
      ],
      go: [
        contractFile(
          'go',
          'packages/local/internal/projectindexer/staticprotocol/types.go',
          'Go mirror of native static request, response, identity, plan, and telemetry structs.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindexer/staticprotocol/stream.go',
          'Go streaming decoder for analyze/finalize/compile native static events.',
          'streaming',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindexer/staticprotocol/validation.go',
          'Go protocol version, method, and worker response validation.',
          'host-mirror',
        ),
        contractFile(
          'go',
          'packages/local/internal/projectindexer/staticprotocol/identity.go',
          'Go construction of native static cache-sensitive run identity.',
          'host-mirror',
        ),
      ],
      rust: [
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/protocol/static_compiler.rs',
          'Rust native static request, response, identity, plan, and telemetry ABI.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/protocol/static_compile.rs',
          'Rust compile request ABI split from other native static methods.',
          'native-mirror',
        ),
        contractFile(
          'rust',
          'crates/crux-indexer-worker/src/static_compiler/protocol/tests.rs',
          'Rust realistic JSON round-trip tests for native static protocol structs.',
          'test',
        ),
      ],
    },
    fixtureGap:
      'TypeScript and Rust have in-memory protocol JSON tests, but there is no shared fixture set decoded by TypeScript, Go, and Rust for every method, telemetry shape, stream event, and error case.',
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
          'packages/indexer/indexer/semantic/evidence.ts',
          'Canonical semantic evidence batch kinds and projection helpers.',
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
          'packages/indexer/indexer/semantic/native/types.ts',
          'Native semantic backend host types behind the evidence contract.',
          'canonical-types',
        ),
      ],
      go: [
        contractFile(
          'go',
          'packages/local/internal/projectindexer/semantic/worker.go',
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
