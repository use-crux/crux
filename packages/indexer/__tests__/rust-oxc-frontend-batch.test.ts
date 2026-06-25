import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StaticSyntaxFileInput } from '../indexer/static/syntax-record'
import { createRustOxcStaticSyntaxFrontend } from '../testing/rust-oxc-frontend'

describe('Rust/Oxc syntax frontend batch protocol', () => {
  it('parses many files through one worker request', async () => {
    const worker = await writeFakeIndexerWorker()
    const previousWorker = process.env.CRUX_STATIC_INDEX_WORKER
    const previousBatch = process.env.CRUX_STATIC_INDEX_WORKER_BATCH
    process.env.CRUX_STATIC_INDEX_WORKER = worker
    process.env.CRUX_STATIC_INDEX_WORKER_BATCH = '1'
    try {
      const frontend = createRustOxcStaticSyntaxFrontend()
      expect(frontend.parseFiles).toBeTypeOf('function')

      const records = await frontend.parseFiles?.([
        syntaxInput('/fixture/src/a.ts', "export const a = 'a'"),
        syntaxInput('/fixture/src/b.ts', "export const b = 'b'"),
      ])

      expect(records?.map((record) => record.file)).toEqual(['/fixture/src/a.ts', '/fixture/src/b.ts'])
      expect(records?.map((record) => record.diagnostics[0]?.message)).toEqual(['batch:2:0', 'batch:2:1'])
    } finally {
      restoreEnv('CRUX_STATIC_INDEX_WORKER', previousWorker)
      restoreEnv('CRUX_STATIC_INDEX_WORKER_BATCH', previousBatch)
    }
  })

  it('can send a disk-source batch request without embedding source text', async () => {
    const worker = await writeFakeIndexerWorker()
    const previousWorker = process.env.CRUX_STATIC_INDEX_WORKER
    const previousBatch = process.env.CRUX_STATIC_INDEX_WORKER_BATCH
    const previousReadFiles = process.env.CRUX_STATIC_INDEX_WORKER_READ_FILES
    process.env.CRUX_STATIC_INDEX_WORKER = worker
    process.env.CRUX_STATIC_INDEX_WORKER_BATCH = '1'
    process.env.CRUX_STATIC_INDEX_WORKER_READ_FILES = '1'
    try {
      const frontend = createRustOxcStaticSyntaxFrontend()
      const records = await frontend.parseFiles?.([
        syntaxInput('/fixture/src/a.ts', "export const a = 'a'"),
        syntaxInput('/fixture/src/b.ts', "export const b = 'b'"),
      ])

      expect(records?.map((record) => record.diagnostics[0]?.message)).toEqual(['disk:2:0', 'disk:2:1'])
    } finally {
      restoreEnv('CRUX_STATIC_INDEX_WORKER', previousWorker)
      restoreEnv('CRUX_STATIC_INDEX_WORKER_BATCH', previousBatch)
      restoreEnv('CRUX_STATIC_INDEX_WORKER_READ_FILES', previousReadFiles)
    }
  })
})

function syntaxInput(file: string, source: string): StaticSyntaxFileInput {
  return { root: '/fixture', file, source }
}

async function writeFakeIndexerWorker(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'crux-rust-oxc-worker-'))
  const worker = join(dir, 'worker.mjs')
  await writeFile(
    worker,
    `#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)
  const files = request.files ?? [{ root: request.root, file: request.file, source: request.source }]
  const records = files.map((input, index) => ({
    schemaVersion: 1,
    frontend: { name: 'oxc-rust', version: 'fake-worker' },
    file: input.file,
    sourceHash: createHash('sha256').update(input.source ?? input.file).digest('hex'),
    imports: [],
    matches: [],
    localInitializers: [],
    diagnostics: [{
      id: 'fake:' + input.file,
      severity: 'info',
      code: 'fake',
      message: (input.readSourceFromDisk && input.source === undefined ? 'disk' : 'batch') + ':' + files.length + ':' + index,
      source: { file: input.file, line: 1, column: 1 },
    }],
  }))
  process.stdout.write(JSON.stringify(
    request.files
      ? { id: request.id, ok: true, records }
      : { id: request.id, ok: true, record: records[0] }
  ) + '\\n')
})
`,
    { mode: 0o755 },
  )
  return worker
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
