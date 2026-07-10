import { describe, expect, it } from 'vitest'
import { resolveApprovalPolicy } from '../../src/tools/approval-policy'
import type { ApprovalDeclaration } from '../../src/tools/approval-policy'

describe('resolveApprovalPolicy', () => {
  it('chooses the closest exact declaration', () => {
    const declarations: ApprovalDeclaration[] = [
      { layer: 'context', key: 'deploy', policy: 'always', owner: 'deployment' },
      { layer: 'prompt', key: 'deploy', policy: 'never' },
      { layer: 'call', key: 'deploy', policy: 'always' },
    ]

    expect(resolveApprovalPolicy('deploy', declarations)).toMatchObject({
      policy: 'always',
      provenance: { layer: 'call', key: 'deploy' },
    })
  })

  it('never lets a wildcard override an exact declaration from a farther layer', () => {
    const declarations: ApprovalDeclaration[] = [
      { layer: 'context', key: 'deploy', policy: 'always', owner: 'deployment' },
      { layer: 'call', key: '*', policy: 'never' },
    ]

    expect(resolveApprovalPolicy('deploy', declarations)).toMatchObject({
      policy: 'always',
      provenance: { layer: 'context', key: 'deploy', owner: 'deployment' },
    })
  })

  it('uses wildcard declarations only when no exact declaration exists', () => {
    const declarations: ApprovalDeclaration[] = [
      { layer: 'context', key: '*', policy: 'always', owner: 'deployment' },
      { layer: 'prompt', key: '*', policy: 'never' },
    ]

    expect(resolveApprovalPolicy('search', declarations)).toMatchObject({
      policy: 'never',
      provenance: { layer: 'prompt', key: '*' },
    })
  })

  it('returns undefined when no declaration applies', () => {
    expect(resolveApprovalPolicy('search', [])).toBeUndefined()
  })
})
