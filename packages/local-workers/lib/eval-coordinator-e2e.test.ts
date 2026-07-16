import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const tsx = require.resolve('tsx/cli')
const coordinator = resolve(__dirname, '../bin/eval-coordinator.ts')
const project = resolve(__dirname, '__fixtures__/eval-project')

describe('Eval coordinator', () => {
  it('discovers one default Eval and emits a clean list stream', async () => {
    const result = await run(['--list'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'collect:done',
          evals: expect.arrayContaining([
            expect.objectContaining({ id: 'support', cases: [{ id: 'refund', origin: 'evals/support.eval.ts:inline:1' }] }),
            expect.objectContaining({
              id: 'managed',
              caseFiles: ['evals/fixtures/managed.json'],
            }),
          ]),
          errors: [],
        }),
        { type: 'run:done', exitCode: 0, runIds: [] },
      ]),
    )
  })

  it('plans exact actions without executing or writing a run', async () => {
    const result = await run(['support', '--plan'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'eval:plan', evalId: 'support' }),
        expect.objectContaining({ type: 'run:done', exitCode: 0, runIds: [] }),
      ]),
    )
  })

  it('executes an admitted managed task and reuses its exact evidence', async () => {
    await rm(resolve(project, '.crux'), { recursive: true, force: true })
    const first = await run(['managed', '--confirm-unknown-cost'])
    expect(first.code, first.stderr).toBe(0)
    expect(first.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eval:done',
          run: expect.objectContaining({
            status: 'complete',
            passed: true,
            cells: expect.arrayContaining([
              expect.objectContaining({ task: expect.objectContaining({ status: 'executed' }) }),
            ]),
          }),
        }),
      ]),
    )

    const second = await run(['managed'])
    expect(second.code, second.stderr).toBe(0)
    expect(second.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eval:done',
          run: expect.objectContaining({
            cells: expect.arrayContaining([
              expect.objectContaining({ task: expect.objectContaining({ status: 'reused' }) }),
            ]),
          }),
        }),
      ]),
    )
    await rm(resolve(project, '.crux'), { recursive: true, force: true })
  })

  it('refuses to promote a Case-filtered run', async () => {
    await rm(resolve(project, '.crux'), { recursive: true, force: true })
    const execution = await run([
      'managed',
      '--case',
      'hello',
      '--confirm-unknown-cost',
    ])
    expect(execution.code, execution.stderr).toBe(0)
    const completed = execution.events.find(
      (event): event is { type: 'eval:done'; run: { runId: string } } =>
        typeof event === 'object' &&
        event !== null &&
        (event as { type?: unknown }).type === 'eval:done',
    )
    expect(completed).toBeDefined()

    const promotion = await run(['--baseline-set', completed!.run.runId])
    expect(promotion.code).toBe(2)
    expect(promotion.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          scope: 'collect',
          message: expect.stringMatching(/filtered/i),
        }),
      ]),
    )
    await rm(resolve(project, '.crux'), { recursive: true, force: true })
  })
})

function run(args: readonly string[]): Promise<{ code: number; events: unknown[]; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsx, coordinator, ...args], {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      resolveRun({
        code: code ?? -1,
        events: stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown),
        stderr,
      })
    })
  })
}
