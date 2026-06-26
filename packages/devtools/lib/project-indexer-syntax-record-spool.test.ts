import { describe, expect, it } from 'vitest'
import { createProjectIndexSyntaxRecordSpool } from './project-indexer-syntax-record-spool'
import type { StaticSyntaxFileRecord } from './project-indexer-request'

describe('createProjectIndexSyntaxRecordSpool', () => {
  it('reads append-only records by byte offset through the provider', async () => {
    const spool = createProjectIndexSyntaxRecordSpool({ identity: { name: 'oxc-rust', version: 'test' } })
    const first = record('/repo/src/a.ts', 'alpha')
    const second = record('/repo/src/b.ts', 'emoji-✓')

    await spool.writeBatch([first])
    await spool.writeBatch([second])

    await expect(spool.provider.read('/repo/src/a.ts')).resolves.toEqual(first)
    await expect(spool.provider.read('/repo/src/b.ts')).resolves.toEqual(second)
    await expect(readSerializedRecord(spool.provider.readSerialized?.('/repo/src/b.ts'))).resolves.toEqual(second)
    spool.close()
    await expect(spool.provider.read('/repo/src/missing.ts')).resolves.toBeUndefined()
    await expect(spool.provider.readMany?.(['/repo/src/b.ts', '/repo/src/missing.ts', '/repo/src/a.ts'])).resolves.toEqual(
      new Map([
        ['/repo/src/b.ts', second],
        ['/repo/src/a.ts', first],
      ]),
    )
    await expect(readSerializedRecords(spool.provider.readManySerialized?.(['/repo/src/b.ts', '/repo/src/a.ts']))).resolves.toEqual(
      new Map([
        ['/repo/src/b.ts', second],
        ['/repo/src/a.ts', first],
      ]),
    )
    await spool.dispose()
  })

  it('rejects duplicate records before mutating the spool index', async () => {
    const spool = createProjectIndexSyntaxRecordSpool({ identity: { name: 'oxc-rust', version: 'test' } })
    const first = record('/repo/src/a.ts', 'first')
    const duplicate = record('/repo/src/a.ts', 'duplicate')

    await expect(spool.writeBatch([first, duplicate])).rejects.toThrow('Duplicate provided static syntax record')

    spool.close()
    await expect(spool.provider.read('/repo/src/a.ts')).resolves.toBeUndefined()
    await spool.dispose()
  })

  it('waits for live records until the producer writes or closes', async () => {
    const spool = createProjectIndexSyntaxRecordSpool({ identity: { name: 'oxc-rust', version: 'test' } })
    const first = record('/repo/src/a.ts', 'alpha')
    const read = Promise.resolve(spool.provider.read('/repo/src/a.ts'))
    let resolved = false
    read.then(() => {
      resolved = true
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolved).toBe(false)

    await spool.writeBatch([first])
    await expect(read).resolves.toEqual(first)

    const missing = spool.provider.read('/repo/src/missing.ts')
    spool.close()
    await expect(missing).resolves.toBeUndefined()
    await spool.dispose()
  })
})

function record(file: string, label: string): StaticSyntaxFileRecord {
  return {
    schemaVersion: 1,
    frontend: { name: 'oxc-rust', version: 'test' },
    file,
    sourceHash: label,
    imports: [],
    matches: [],
    localInitializers: [],
    diagnostics: [],
  }
}

async function readSerializedRecord(
  value:
    | ReturnType<NonNullable<ReturnType<typeof createProjectIndexSyntaxRecordSpool>['provider']['readSerialized']>>
    | undefined,
): Promise<StaticSyntaxFileRecord | undefined> {
  const resolved = await value
  return resolved ? (JSON.parse(Buffer.from(resolved).toString('utf8')) as StaticSyntaxFileRecord) : undefined
}

async function readSerializedRecords(
  value:
    | ReturnType<NonNullable<ReturnType<typeof createProjectIndexSyntaxRecordSpool>['provider']['readManySerialized']>>
    | undefined,
): Promise<ReadonlyMap<string, StaticSyntaxFileRecord>> {
  const resolved = (await value) ?? new Map()
  return new Map([...resolved].map(([file, record]) => [file, JSON.parse(Buffer.from(record).toString('utf8'))]))
}
