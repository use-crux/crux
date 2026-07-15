/** Input media remains a guardrail-only boundary when TypeScript is bypassed. */

import { describe, expect, it, vi } from 'vitest'
import {
  boundary,
  constraint,
  createSafety,
  evaluateConstraint,
  SafetyConfigError,
} from '../../src/safety'

describe('constraint — input media boundary', () => {
  it('rejects unsafe-cast factory authoring before the callback can run', () => {
    const run = vi.fn(() => ({ pass: true as const }))

    const create = () =>
      constraint({
        id: 'invalid-media-factory',
        on: boundary.input.media(),
        run,
      } as never)

    expectMediaConstraintError(captureError(create), 'invalid-media-factory')
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a manually shaped media constraint during registry creation', () => {
    const run = vi.fn(() => ({ pass: true as const }))
    const manuallyShaped = Object.freeze({
      _tag: 'Constraint' as const,
      id: 'invalid-media-registry',
      on: boundary.input.media(),
      category: undefined,
      severity: 'assert' as const,
      maxRetries: 0,
      run,
    })

    const create = () =>
      createSafety({
        call: { constraints: [manuallyShaped as never] },
        promptId: 'prompt-1',
        model: 'model-1',
      })

    expectMediaConstraintError(captureError(create), 'invalid-media-registry')
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects standalone evaluation before entering the per-case loop', async () => {
    const run = vi.fn(() => ({ pass: true as const }))
    const manuallyShaped = Object.freeze({
      _tag: 'Constraint' as const,
      id: 'invalid-media-evaluator',
      on: boundary.input.media(),
      category: undefined,
      severity: 'assert' as const,
      maxRetries: 0,
      run,
    })

    const error = await evaluateConstraint(manuallyShaped as never, [
      { input: { text: 'output' }, expect: true },
    ]).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expectMediaConstraintError(error, 'invalid-media-evaluator')
    expect(run).not.toHaveBeenCalled()
  })
})

function captureError(run: () => unknown): unknown {
  try {
    run()
    return undefined
  } catch (error) {
    return error
  }
}

function expectMediaConstraintError(error: unknown, id: string): void {
  expect(error).toBeInstanceOf(SafetyConfigError)
  expect(error).toMatchObject({
    name: 'SafetyConfigError',
    boundaries: ['user.input.media'],
    kinds: ['constraint'],
  })
  expect((error as Error).message).toContain(`"${id}"`)
  expect((error as Error).message).toContain('"user.input.media"')
}
