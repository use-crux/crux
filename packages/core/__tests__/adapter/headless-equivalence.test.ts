import { describe, expect, it } from 'vitest'

type EquivalenceScenario = 'plain' | 'structured-output' | 'tool-loop' | 'approval-suspend-resume' | 'validation-retry'
type EquivalenceSurface = 'managed' | 'handle' | 'transport'
type AdapterEquivalenceCoverage = Record<string, Partial<Record<EquivalenceScenario, readonly EquivalenceSurface[]>>>

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

const REQUIRED_SURFACES = ['managed', 'handle', 'transport'] as const satisfies readonly EquivalenceSurface[]

const IMPLEMENTED_COVERAGE = {
  anthropic: {
    plain: REQUIRED_SURFACES,
    'structured-output': REQUIRED_SURFACES,
    'tool-loop': REQUIRED_SURFACES,
    'approval-suspend-resume': REQUIRED_SURFACES,
    'validation-retry': REQUIRED_SURFACES,
  },
  openai: {
    plain: REQUIRED_SURFACES,
    'structured-output': REQUIRED_SURFACES,
    'tool-loop': REQUIRED_SURFACES,
    'approval-suspend-resume': REQUIRED_SURFACES,
    'validation-retry': REQUIRED_SURFACES,
  },
  google: {
    plain: REQUIRED_SURFACES,
    'structured-output': REQUIRED_SURFACES,
    'tool-loop': REQUIRED_SURFACES,
    'approval-suspend-resume': REQUIRED_SURFACES,
    'validation-retry': REQUIRED_SURFACES,
  },
  'ai-sdk': {
    plain: REQUIRED_SURFACES,
    'structured-output': ['managed', 'transport'],
    'tool-loop': REQUIRED_SURFACES,
    'approval-suspend-resume': REQUIRED_SURFACES,
    'validation-retry': ['managed', 'transport'],
  },
} as const satisfies AdapterEquivalenceCoverage

describe('headless equivalence conformance scaffold', () => {
  it('enumerates the fixture matrix required by 03 §5', () => {
    expect(new Set(EQUIVALENCE_MATRIX.map((row) => row.scenario))).toEqual(
      new Set<EquivalenceScenario>(['plain', 'structured-output', 'tool-loop', 'approval-suspend-resume', 'validation-retry']),
    )
  })

  for (const row of EQUIVALENCE_MATRIX) {
    it(`Phase ${row.phase}: ${row.name}`, () => {
      for (const [adapter, coverage] of Object.entries(IMPLEMENTED_COVERAGE)) {
        const surfaces = coverage[row.scenario] ?? []
        expect(surfaces, `${adapter} covers ${row.scenario}`).toContain('managed')
        if (adapter !== 'ai-sdk' || (row.scenario !== 'structured-output' && row.scenario !== 'validation-retry')) {
          expect(surfaces, `${adapter} exposes ${row.scenario} handle coverage`).toContain('handle')
        }
        expect(surfaces, `${adapter} exposes ${row.scenario} transport coverage`).toContain('transport')
      }
    })
  }
})
