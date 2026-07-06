import { describe, expect, it } from 'vitest'

type EquivalenceScenario = 'plain' | 'structured-output' | 'tool-loop' | 'approval-suspend-resume' | 'validation-retry'

interface EquivalenceMatrixRow {
  readonly phase: 8 | 9
  readonly scenario: EquivalenceScenario
  readonly name: string
}

const EQUIVALENCE_MATRIX = [
  { phase: 8, scenario: 'plain', name: 'anthropic managed generate equals prepare/step for plain text' },
  {
    phase: 8,
    scenario: 'structured-output',
    name: 'anthropic managed generate equals prepare/step for structured output',
  },
  { phase: 8, scenario: 'tool-loop', name: 'anthropic managed generate equals prepare/step for tool loops' },
  {
    phase: 8,
    scenario: 'approval-suspend-resume',
    name: 'anthropic managed generate equals prepare/step for approval suspension and resume',
  },
  { phase: 8, scenario: 'validation-retry', name: 'anthropic managed generate equals prepare/step for validation retry' },
  { phase: 9, scenario: 'plain', name: 'all adapters generate, prepare/step, and transport agree for plain text' },
  {
    phase: 9,
    scenario: 'structured-output',
    name: 'all adapters generate, prepare/step, and transport agree for structured output',
  },
  { phase: 9, scenario: 'tool-loop', name: 'all adapters generate, prepare/step, and transport agree for tool loops' },
  {
    phase: 9,
    scenario: 'approval-suspend-resume',
    name: 'all adapters generate, prepare/step, and transport agree for approval suspension and resume',
  },
  {
    phase: 9,
    scenario: 'validation-retry',
    name: 'all adapters generate, prepare/step, and transport agree for validation retry',
  },
] as const satisfies readonly EquivalenceMatrixRow[]

describe('headless equivalence conformance scaffold', () => {
  it('enumerates the fixture matrix required by 03 §5', () => {
    expect(new Set(EQUIVALENCE_MATRIX.map((row) => row.scenario))).toEqual(
      new Set<EquivalenceScenario>(['plain', 'structured-output', 'tool-loop', 'approval-suspend-resume', 'validation-retry']),
    )
  })

  for (const row of EQUIVALENCE_MATRIX) {
    it.todo(`Phase ${row.phase}: ${row.name}`)
  }
})

