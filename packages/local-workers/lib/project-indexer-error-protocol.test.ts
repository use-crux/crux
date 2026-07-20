import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeProjectIndexArtifactError } from '../bin/project-indexer-protocol'

const packageRoot = resolve(__dirname, '..')
const builtWorker = resolve(packageRoot, 'dist/project-indexer.mjs')

describe('project index worker errors', () => {
  it('preserves typed codes and remediation', async () => {
    const events: unknown[] = []
    await writeProjectIndexArtifactError(
      async (event) => {
        events.push(event)
      },
      'runRuntimeOperation',
      'runtimeOperation',
      'runtime requires its host',
      'RUNTIME_HOST_ONLY',
      'generate host handlers',
    )

    expect(events).toEqual([
      expect.objectContaining({
        type: 'artifact:error',
        error: {
          message: 'runtime requires its host',
          code: 'RUNTIME_HOST_ONLY',
          remediation: 'generate host handlers',
        },
      }),
    ])
  })

  it('preserves typed errors through an assembled built-worker request', async () => {
    const root = await mkdtemp(join(packageRoot, '.tmp-worker-error-'))
    try {
      const source = join(root, 'src/review.ts')
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'crux.config.ts'), 'export default { runtime: "convex" }\n')
      await writeFile(source, 'export const reviewFlow = async () => undefined\n')

      const event = await runBuiltWorker({
        method: 'generateRuntimeArtifacts',
        protocolVersion: 2,
        root,
        definitions: [
          {
            id: 'flow:review',
            kind: 'flow',
            name: 'review',
            fidelity: 'resolved',
            source: { file: source, line: 1 },
            metadata: { exportName: 'reviewFlow' },
          },
        ],
      })

      expect(event).toEqual(
        expect.objectContaining({
          type: 'artifact:error',
          artifact: 'runtimeArtifacts',
          error: expect.objectContaining({
            code: 'SETUP_REQUIRED',
            remediation: expect.stringContaining('Fix crux.config.ts'),
          }),
        }),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

function runBuiltWorker(request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolveEvent, rejectEvent) => {
    const child = spawn(process.execPath, [builtWorker], {
      cwd: packageRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectEvent)
    child.on('close', (code) => {
      if (code !== 0) {
        rejectEvent(new Error(`project-indexer exited with ${code}: ${stderr.trim()}`))
        return
      }
      const event = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((candidate) => candidate.type === 'artifact:error')
      if (!event) {
        rejectEvent(new Error(`project-indexer did not emit an artifact error: ${stderr}`))
        return
      }
      resolveEvent(event)
    })
    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}
