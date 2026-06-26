/**
 * Worker-event contract fixtures shared by TypeScript tests and future
 * Go/Rust fixture decoders.
 *
 * Fixtures are JSON-safe values that exercise the observable worker protocol:
 * phase lifecycle events, fact batches, source-profile batches, and patch
 * reconstruction.
 *
 * @module
 */

import type { IndexPatch } from '../../indexer/patches'
import type { IndexPatchToWorkerEventsOptions } from './schema'

/** Index patch fixture used to prove worker-event round trips. */
export const workerEventFixturePatch = {
  schemaVersion: 1,
  phase: 'ast',
  project: { root: '/repo', name: 'contract-spine', configFile: 'crux.config.ts' },
  startedAt: '2026-06-24T10:00:00.000Z',
  finishedAt: '2026-06-24T10:00:00.010Z',
  status: 'ok',
  invalidates: { all: true },
  facts: {
    definitions: [
      {
        id: 'prompt:contract-spine',
        kind: 'prompt',
        name: 'contractSpine',
        fidelity: 'partial',
        status: 'active',
        source: { file: '/repo/src/contract.ts', line: 2 },
      },
    ],
    diagnostics: [
      {
        id: 'diagnostic:contract-spine',
        severity: 'info',
        code: 'index.contract',
        message: 'contract fixture indexed',
        source: { file: '/repo/src/contract.ts', line: 2 },
      },
    ],
    sources: [
      {
        file: '/repo/src/contract.ts',
        status: 'indexed',
        shardId: '.',
        definitionIds: ['prompt:contract-spine'],
        diagnostics: ['diagnostic:contract-spine'],
      },
    ],
    sourceGraph: {
      schemaVersion: 1,
      producedBy: '@use-crux/indexer',
      capabilities: ['definition-ownership', 'diagnostic-ownership', 'project-shards'],
      shards: [{ id: '.', root: '/repo', packageFile: '/repo/package.json' }],
    },
  },
  semanticSourceProfile: {
    files: [
      {
        file: '/repo/src/contract.ts',
        sourceHash: 'sha256:contract',
        sourceBytes: 42,
        hints: { nativeDirectCruxCandidate: true, cruxCallNames: ['prompt'] },
      },
    ],
    dependencyClosure: ['/repo/src/contract.ts'],
    sourceBytes: 42,
    complete: true,
  },
} as const satisfies IndexPatch

/** Worker event conversion options for `workerEventFixturePatch`. */
export const workerEventFixtureOptions = {
  transactionId: 'tx-contract-spine-ast',
  producer: { name: '@use-crux/indexer', version: 'contract-spine' },
  maxFactsPerBatch: 2,
} as const satisfies IndexPatchToWorkerEventsOptions
