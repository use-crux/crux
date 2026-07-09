import { describe, expect, it } from 'vitest'
import { assertQualityRunnerProtocol, QualityRunnerProtocolMismatchError } from './quality-core-bridge'

describe('quality core bridge protocol checks', () => {
  it('rejects a project core without the runner protocol export', () => {
    expect(() => assertQualityRunnerProtocol({ createQualityRunner: () => ({}) })).toThrow(
      QualityRunnerProtocolMismatchError,
    )
    try {
      assertQualityRunnerProtocol({ createQualityRunner: () => ({}) })
    } catch (error) {
      expect(error).toBeInstanceOf(QualityRunnerProtocolMismatchError)
      if (!(error instanceof QualityRunnerProtocolMismatchError)) throw error
      expect(error.code).toBe('protocol-mismatch')
      expect(error.core).toBe('pre-versioning')
      expect(error.worker).toEqual([1])
    }
  })

  it('accepts protocol 1', () => {
    expect(() => assertQualityRunnerProtocol({ QUALITY_RUNNER_PROTOCOL: 1 })).not.toThrow()
  })
})
