import { describe, expect, it } from 'vitest'
import { createProjectIndexWorkerRequestAssembler, type ProjectIndexWorkerRequest } from './project-indexer-request'

type SyntaxRecord = NonNullable<ProjectIndexWorkerRequest['syntaxRecords']>[number]

describe('createProjectIndexWorkerRequestAssembler', () => {
  it('spools syntax records from chunked worker request events', async () => {
    const previousLiveProjection = process.env.CRUX_INDEXER_LIVE_SYNTAX_PROJECTION
    process.env.CRUX_INDEXER_LIVE_SYNTAX_PROJECTION = '1'
    try {
      const assemble = createProjectIndexWorkerRequestAssembler()
      const firstRecord = {
        schemaVersion: 1,
        frontend: { name: 'oxc-rust', version: 'test' },
        file: '/repo/src/a.ts',
      } as SyntaxRecord
      const secondRecord = {
        schemaVersion: 1,
        frontend: { name: 'oxc-rust', version: 'test' },
        file: '/repo/src/b.ts',
      } as SyntaxRecord

      const started = await assemble({
        protocolVersion: 2,
        method: 'indexProjectAstFromSyntaxRecords',
        requestId: 'syntax:1',
        requestKind: 'start',
        root: '/repo',
        syntaxFrontendIdentity: { name: 'oxc-rust', version: 'test' },
      })
      expect(started?.requestKind).toBeUndefined()
      expect(started?.syntaxRecords).toBeUndefined()
      expect(started?.liveSyntaxRecordProjection).toBe(true)

      await expect(
        assemble({
          protocolVersion: 2,
          method: 'indexProjectAstFromSyntaxRecords',
          requestId: 'syntax:1',
          requestKind: 'syntaxRecords',
          root: '/repo',
          syntaxRecordsBatch: [firstRecord],
        }),
      ).resolves.toBeUndefined()
      await expect(
        assemble({
          protocolVersion: 2,
          method: 'indexProjectAstFromSyntaxRecords',
          requestId: 'syntax:1',
          requestKind: 'syntaxRecords',
          root: '/repo',
          syntaxRecordsBatch: [secondRecord],
        }),
      ).resolves.toBeUndefined()

      const completed = await assemble({
        protocolVersion: 2,
        method: 'indexProjectAstFromSyntaxRecords',
        requestId: 'syntax:1',
        requestKind: 'done',
        root: '/repo',
      })

      expect(completed).toBeUndefined()
      await expect(started?.syntaxRecordProvider?.read('/repo/src/a.ts')).resolves.toEqual(firstRecord)
      await expect(started?.syntaxRecordProvider?.read('/repo/src/b.ts')).resolves.toEqual(secondRecord)
      await expect(started?.syntaxRecordProvider?.readMany?.(['/repo/src/a.ts', '/repo/src/b.ts'])).resolves.toEqual(
        new Map([
          ['/repo/src/a.ts', firstRecord],
          ['/repo/src/b.ts', secondRecord],
        ]),
      )
      await started?.cleanup?.()
    } finally {
      restoreEnv('CRUX_INDEXER_LIVE_SYNTAX_PROJECTION', previousLiveProjection)
    }
  })

  it('does not enable live projection from the low-RSS memory profile alone', async () => {
    const previousLiveProjection = process.env.CRUX_INDEXER_LIVE_SYNTAX_PROJECTION
    const previousMemoryProfile = process.env.CRUX_INDEXER_MEMORY_PROFILE
    delete process.env.CRUX_INDEXER_LIVE_SYNTAX_PROJECTION
    process.env.CRUX_INDEXER_MEMORY_PROFILE = 'low-rss'
    try {
      const assemble = createProjectIndexWorkerRequestAssembler()
      const started = await assemble({
        protocolVersion: 2,
        method: 'indexProjectAstFromSyntaxRecords',
        requestId: 'syntax:low-rss',
        requestKind: 'start',
        root: '/repo',
        syntaxFrontendIdentity: { name: 'oxc-rust', version: 'test' },
      })

      expect(started?.liveSyntaxRecordProjection).not.toBe(true)
      await assemble({
        protocolVersion: 2,
        method: 'indexProjectAstFromSyntaxRecords',
        requestId: 'syntax:low-rss',
        requestKind: 'done',
        root: '/repo',
      })
      await started?.cleanup?.()
    } finally {
      restoreEnv('CRUX_INDEXER_LIVE_SYNTAX_PROJECTION', previousLiveProjection)
      restoreEnv('CRUX_INDEXER_MEMORY_PROFILE', previousMemoryProfile)
    }
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
