import { describe, expect, it } from 'vitest'
import { checkStaticRulesForProject } from '../host/static-compat'

describe('static extension host native lint finalization', () => {
  it('returns raw extension rule facts when native finalization owns linting', async () => {
    const result = await checkStaticRulesForProject({
      root: '/project',
      graph: {
        definitions: [
          {
            id: 'prompt:missing-schema',
            kind: 'prompt',
            name: 'missing-schema',
            fidelity: 'resolved',
            status: 'active',
          },
        ],
        relations: [],
      },
    })

    expect(result.outputs.map((finding) => finding.ruleId)).not.toContain('prompt.missing_input_schema')
    expect(result.ruleDescriptors.map((descriptor) => descriptor.id)).not.toContain('prompt.missing_input_schema')
    expect(result.facts).toEqual({
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'index.config_not_found' })]),
    })
  })
})
