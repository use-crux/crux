import { describe, expect, it } from 'vitest'
import { assertEvalRunnerProtocol, EvalRunnerProtocolMismatchError } from './eval-core-bridge'

describe('Eval Core bridge', () => {
  it('accepts protocol 1', () => {
    expect(() => assertEvalRunnerProtocol({ EVAL_RUNNER_PROTOCOL: 1 })).not.toThrow()
  })

  it('rejects missing and future protocols with version guidance', () => {
    expect(() => assertEvalRunnerProtocol({})).toThrow(EvalRunnerProtocolMismatchError)
    expect(() => assertEvalRunnerProtocol({ EVAL_RUNNER_PROTOCOL: 2 })).toThrow(/align.*Core.*Local/i)
  })
})
