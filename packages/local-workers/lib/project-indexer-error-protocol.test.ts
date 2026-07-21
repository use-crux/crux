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
      [
        {
          code: 'RUNTIME_EVAL_INVALID',
          category: 'authored',
          featureKind: 'eval',
          featureId: 'answer-quality',
          arm: 'current',
          source: 'evals/answer.eval.ts',
          summary: "Eval 'answer-quality' is not ready.",
          reason: 'Eval task must be callable.',
          remediation: 'Pass a callable task to evaluate() and save the file.',
        },
      ],
    )

    expect(events).toEqual([
      expect.objectContaining({
        type: 'artifact:error',
        error: {
          message: 'runtime requires its host',
          code: 'RUNTIME_HOST_ONLY',
          remediation: 'generate host handlers',
          findings: [
            expect.objectContaining({
              code: 'RUNTIME_EVAL_INVALID',
              featureId: 'answer-quality',
              arm: 'current',
            }),
          ],
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
        protocolVersion: 3,
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
            code: 'RUNTIME_ARTIFACT_GENERATION_FAILED',
            findings: [
              expect.objectContaining({
                code: 'SETUP_REQUIRED',
                category: 'configuration',
                remediation: expect.stringContaining('Fix crux.config.ts'),
              }),
            ],
          }),
        }),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps every generation finding in deterministic order through the built worker', async () => {
    const root = await mkdtemp(join(packageRoot, '.tmp-worker-findings-'))
    try {
      const invalidDefinition = (name: string) => ({
        id: `eval:${name}`,
        kind: 'eval',
        name,
        fidelity: 'resolved',
        source: { file: join(root, `evals/${name}.eval.ts`), line: 1 },
        metadata: {
          exportName: 'default',
          evalContract: 'crux.eval',
          evalExecutionArms: [
            {
              name: 'current',
              status: 'invalid',
              code: 'task_not_callable',
              reason: 'Eval task must be callable.',
            },
          ],
        },
      })
      const event = await runBuiltWorker({
        method: 'generateRuntimeArtifacts',
        protocolVersion: 3,
        root,
        definitions: [invalidDefinition('zeta'), invalidDefinition('alpha')],
      })

      expect(event).toEqual(
        expect.objectContaining({
          type: 'artifact:error',
          error: expect.objectContaining({
            code: 'RUNTIME_ARTIFACT_GENERATION_FAILED',
            findings: [
              expect.objectContaining({
                featureId: 'alpha',
                code: 'RUNTIME_EVAL_INVALID',
              }),
              expect.objectContaining({
                featureId: 'zeta',
                code: 'RUNTIME_EVAL_INVALID',
              }),
            ],
          }),
        }),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('emits the exact setup envelope with generation children kept separate', async () => {
    const root = await mkdtemp(join(packageRoot, '.tmp-worker-setup-'))
    try {
      const event = await runBuiltWorker(
        {
          method: 'runSetupOperation',
          protocolVersion: 3,
          root,
          setupMode: 'apply',
          setupReport: {
            ok: true,
            mode: 'apply',
            findings: [],
            actions: [],
            applied: [],
          },
          generationFindings: [
            {
              code: 'PROJECT_INDEX_FAILED',
              category: 'internal',
              featureKind: 'runtime',
              featureId: 'project-index',
              summary: 'Crux could not inspect the project.',
              reason: 'Project indexing did not complete.',
            },
          ],
        },
        'artifact:done',
      )

      expect(event).toMatchObject({
        artifact: 'setupOperation',
        payload: {
          ok: false,
          setup: {
            findings: [
              expect.objectContaining({
                contributorId: 'runtime-artifacts',
                code: 'RUNTIME_ARTIFACT_GENERATION_FAILED',
              }),
            ],
          },
          generation: {
            status: 'failed',
            pendingFiles: [],
            changedFiles: [],
            findings: [expect.objectContaining({ code: 'PROJECT_INDEX_FAILED' })],
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

function runBuiltWorker(request: unknown, eventType = 'artifact:error'): Promise<Record<string, unknown>> {
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
        .find((candidate) => candidate.type === eventType)
      if (!event) {
        rejectEvent(new Error(`project-indexer did not emit an artifact error: ${stderr}`))
        return
      }
      resolveEvent(event)
    })
    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}
