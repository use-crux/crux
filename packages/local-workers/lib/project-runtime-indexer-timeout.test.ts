import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const BUILT_WORKER = resolve(__dirname, '../dist/project-runtime-indexer.mjs')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('built project-runtime-indexer import isolation', () => {
  it('terminates the worker instead of scheduling another import wave after a timeout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-runtime-timeout-'))
    roots.push(root)
    const evals = join(root, 'evals')
    const waveMarker = join(root, 'second-wave-started')
    await mkdir(evals, { recursive: true })
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        writeFile(
          join(evals, `${String(index).padStart(2, '0')}-slow.eval.ts`),
          'await new Promise((resolve) => setTimeout(resolve, 4500))\nexport default {}',
        ),
      ),
    )
    await writeFile(
      join(evals, '99-second-wave.eval.ts'),
      [
        "import { writeFileSync } from 'node:fs'",
        `writeFileSync(${JSON.stringify(waveMarker)}, 'started')`,
        'export default {}',
      ].join('\n'),
    )

    const result = await runRuntimeWorker(root)

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('"type":"phase:error"')
    expect(result.stdout).toContain('Timed out importing')
    await expect(access(waveMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)
})

async function runRuntimeWorker(root: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [BUILT_WORKER], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  child.stdin.end(
    `${JSON.stringify({
      method: 'indexProjectRuntime',
      protocolVersion: 2,
      root,
      previousIndex: {
        schemaVersion: 1,
        project: { root },
        indexedAt: new Date(0).toISOString(),
        prompts: [],
        contexts: [],
        definitions: [],
        relations: [],
        diagnostics: [],
        lintFindings: [],
        ruleDescriptors: [],
        sources: [],
      },
    })}\n`,
  )
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  })
  return { code, stdout, stderr }
}
