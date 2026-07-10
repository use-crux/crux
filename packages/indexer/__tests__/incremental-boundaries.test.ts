import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { planIndexFiles } from '../src/indexer/incremental'

const root = '/project'

describe('incremental boundary classification', () => {
  it.each(['crux.config.js', 'crux.config.mjs', 'pnpm-workspace.yaml'])(
    'falls back for resolver boundary file %s',
    (file) => {
      const decision = planIndexFiles({
        root,
        previousIndex: previousIndex(),
        files: [file],
      })

      expect(decision).toMatchObject({
        kind: 'full-reindex-required',
        reason: 'config-or-resolver-changed',
        graphConfidence: 'config-or-resolver-changed',
      })
    },
  )
})

function previousIndex(): ProjectIndexSnapshot {
  const source = join(root, 'src/prompt.ts')
  return {
    schemaVersion: 1,
    project: { root },
    indexedAt: '2026-06-20T00:00:00.000Z',
    prompts: [],
    contexts: [],
    definitions: [],
    relations: [],
    diagnostics: [],
    lintFindings: [],
    ruleDescriptors: [],
    sourceGraph: {
      schemaVersion: 1,
      producedBy: '@use-crux/indexer',
      capabilities: [
        'source-dependencies',
        'source-dependents',
        'definition-ownership',
        'diagnostic-ownership',
        'project-shards',
      ],
      shards: [{ id: '.', root }],
    },
    sources: [{ file: source, status: 'indexed', dependencies: [], dependents: [], shardId: '.' }],
  }
}
