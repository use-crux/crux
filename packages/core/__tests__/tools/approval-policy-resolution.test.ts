import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compilePrompt } from '../../src/resolver/compile'
import { context } from '../../src/prompt/context'

const execute = async () => 'ok'

describe('toolApproval resolution', () => {
  it('collects context and prompt declarations with context ownership enforced', async () => {
    const deployment = context({
      id: 'deployment',
      system: 'Deployment tools',
      tools: { deploy: { description: 'Deploy', execute } },
      toolApproval: { deploy: 'always' },
    })

    const prompt = compilePrompt({
      system: 'S',
      use: [deployment],
      tools: { search: { description: 'Search', execute } },
      toolApproval: { '*': 'never' },
    })

    const resolved = (await prompt.resolve({})).args
    expect(resolved.toolApprovalDeclarations).toEqual([
      { layer: 'context', owner: 'context:deployment', key: 'deploy', policy: 'always', appliesTo: ['deploy'] },
      { layer: 'prompt', key: '*', policy: 'never' },
    ])

    await expect(prompt.inspect({})).resolves.toMatchObject({
      toolApprovals: [
        { toolName: 'deploy', policyKind: 'always', provenance: { layer: 'context', key: 'deploy' } },
        { toolName: 'search', policyKind: 'never', provenance: { layer: 'prompt', key: '*' } },
      ],
    })
  })

  it('rejects context-level approval for tool names the context does not contribute', async () => {
    const deployment = context({
      id: 'deployment',
      input: z.object({ enabled: z.boolean() }),
      system: 'Deployment tools',
      tools: () => ({ deploy: { description: 'Deploy', execute } }),
      toolApproval: { destroy: 'always' },
    })

    const prompt = compilePrompt({
      system: 'S',
      use: [deployment],
    })

    await expect(prompt.resolve({ input: { enabled: true } })).rejects.toThrow(
      'context:deployment declared toolApproval for "destroy"',
    )
  })
})
