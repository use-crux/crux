import { describe, expect, it } from 'vitest'
import {
  agentDefinitionRef,
  blackboardDefinitionRef,
  compositionDefinitionRef,
  flowDefinitionRef,
  retrieverDefinitionRef,
  sanitizeDefinitionSource,
} from '../../src/observability/definition-ref'

describe('sanitizeDefinitionSource', () => {
  it('passes through a repo-relative path and normalizes separators', () => {
    expect(
      sanitizeDefinitionSource({ file: 'src\\agent\\pipeline.ts', line: 12, column: 4 }),
    ).toEqual({ file: 'src/agent/pipeline.ts', line: 12, column: 4 })
  })

  it('strips a leading ./ segment', () => {
    expect(sanitizeDefinitionSource({ file: './src/a.ts', line: 3 })).toEqual({
      file: 'src/a.ts',
      line: 3,
    })
  })

  it('omits source when an absolute path has no project root to relativize against', () => {
    expect(
      sanitizeDefinitionSource({ file: '/home/secret/repo/src/a.ts', line: 5 }),
    ).toBeUndefined()
  })

  it('relativizes an absolute path under the project root and redacts the root', () => {
    const result = sanitizeDefinitionSource(
      { file: '/home/secret/repo/src/a.ts', line: 5, column: 2 },
      { projectRoot: '/home/secret/repo' },
    )
    expect(result).toEqual({ file: 'src/a.ts', line: 5, column: 2 })
    expect(JSON.stringify(result)).not.toContain('/home/secret')
  })

  it('omits source when an absolute path is outside the project root', () => {
    expect(
      sanitizeDefinitionSource(
        { file: '/etc/passwd', line: 1 },
        { projectRoot: '/home/secret/repo' },
      ),
    ).toBeUndefined()
  })

  it('relativizes a windows absolute path under a windows project root', () => {
    expect(
      sanitizeDefinitionSource(
        { file: 'C:\\Users\\me\\repo\\src\\a.ts', line: 9 },
        { projectRoot: 'C:\\Users\\me\\repo' },
      ),
    ).toEqual({ file: 'src/a.ts', line: 9 })
  })

  it('omits a relative path that traverses upward', () => {
    expect(sanitizeDefinitionSource({ file: '../secret.ts', line: 1 })).toBeUndefined()
    expect(
      sanitizeDefinitionSource({ file: 'src/../../secret.ts', line: 1 }),
    ).toBeUndefined()
  })

  it('omits source when the path escapes the project root via traversal', () => {
    expect(
      sanitizeDefinitionSource(
        { file: '/home/secret/repo/../other/a.ts', line: 1 },
        { projectRoot: '/home/secret/repo' },
      ),
    ).toBeUndefined()
  })

  it('omits source without a positive line number', () => {
    expect(sanitizeDefinitionSource({ file: 'src/a.ts', line: 0 })).toBeUndefined()
    expect(sanitizeDefinitionSource({ file: 'src/a.ts' })).toBeUndefined()
    expect(sanitizeDefinitionSource(undefined)).toBeUndefined()
  })

  it('drops a non-positive column but keeps the location', () => {
    expect(sanitizeDefinitionSource({ file: 'src/a.ts', line: 4, column: 0 })).toEqual({
      file: 'src/a.ts',
      line: 4,
    })
  })
})

describe('composition / blackboard definition refs', () => {
  it('builds a composition ref matching ProjectDefinition.ID (kind:safeId)', () => {
    expect(compositionDefinitionRef('pipeline', 'research-pipeline')).toEqual({
      id: 'composition.pipeline:research-pipeline',
      kind: 'composition.pipeline',
      role: 'invoked-composition',
    })
  })

  it('sanitizes the authored id the way the indexer safe_id does', () => {
    expect(compositionDefinitionRef('swarm', 'My Swarm!').id).toBe(
      'composition.swarm:My-Swarm',
    )
  })

  it('builds a blackboard ref with the blackboard:<safeId> canonical id', () => {
    expect(blackboardDefinitionRef('research-board')).toEqual({
      id: 'blackboard:research-board',
      kind: 'blackboard',
      role: 'invoked-blackboard',
    })
  })

  it('attaches sanitized source when provided', () => {
    expect(
      compositionDefinitionRef('parallel', 'p', { file: 'src/p.ts', line: 2 }),
    ).toEqual({
      id: 'composition.parallel:p',
      kind: 'composition.parallel',
      role: 'invoked-composition',
      source: { file: 'src/p.ts', line: 2 },
    })
  })
})

describe('safeDefinitionId fingerprint fallback (empty-after-sanitize)', () => {
  // Known indexer outputs from packages/indexer/src/indexer/definitions.ts
  // `safeId` → `fingerprint` (sha256(JSON.stringify(value)).slice(0, 16)) and
  // the Rust port crates/primitives/src/definition.rs `safe_id`. These must be
  // byte-identical or the runtime→index join silently breaks.
  it.each([
    ['!!!', '3614a738f9bd68a6'],
    ['@@@', '0109b085b18e8995'],
    ['→→→', 'b446c7cc369e6b13'],
    ['   ', '7c1e8804d7423330'],
    ['()[]{}', '171889b67faa6147'],
    ['日本語', 'd2b94e6e664483bb'],
    ['\t\n', '1f1a1a4546fdcf8c'],
  ])('hashes %j to the indexer fingerprint', (raw, fingerprint) => {
    expect(agentDefinitionRef(raw).id).toBe(`agent:${fingerprint}`)
    // Every ref builder shares the sanitizer, so the fallback is uniform.
    expect(flowDefinitionRef(raw).id).toBe(`flow:${fingerprint}`)
    expect(compositionDefinitionRef('swarm', raw).id).toBe(`composition.swarm:${fingerprint}`)
  })

  it('keeps ids that normalize to a non-empty safe id (no hashing)', () => {
    expect(agentDefinitionRef('...').id).toBe('agent:...')
    expect(agentDefinitionRef('::').id).toBe('agent:::')
    expect(agentDefinitionRef('a b').id).toBe('agent:a-b')
  })
})

describe('agent / flow / retriever definition refs', () => {
  it('builds an agent ref matching the indexer agent:<safeId(id)> construction', () => {
    // Mirrors crates/primitives/src/agent/facts.rs: `agent:{safe_id(local_id)}`
    // where local_id is the required authored `config.id`.
    expect(agentDefinitionRef('triage')).toEqual({
      id: 'agent:triage',
      kind: 'agent',
      role: 'invoked-agent',
    })
  })

  it('sanitizes the authored agent id the way the indexer safe_id does', () => {
    expect(agentDefinitionRef('Refund Bot!').id).toBe('agent:Refund-Bot')
  })

  it('builds a flow ref matching the indexer flow:<safeId(name)> construction', () => {
    // Mirrors crates/primitives/src/flow/facts.rs: `flow:{safe_id(definition_key)}`
    // where definition_key is the required first-arg name literal.
    expect(flowDefinitionRef('research')).toEqual({
      id: 'flow:research',
      kind: 'flow',
      role: 'invoked-flow',
    })
    expect(flowDefinitionRef('My Flow!').id).toBe('flow:My-Flow')
  })

  it('builds a retriever ref matching the indexer rag.retriever:<safeId(id)> construction', () => {
    // Mirrors crates/primitives/src/rag/facts.rs: `rag.retriever:{safe_id(local_id)}`
    // where local_id is the required authored `config.id`.
    expect(retrieverDefinitionRef('kb-docs')).toEqual({
      id: 'rag.retriever:kb-docs',
      kind: 'rag.retriever',
      role: 'invoked-retriever',
    })
    expect(retrieverDefinitionRef('Docs KB!').id).toBe('rag.retriever:Docs-KB')
  })

  it('attaches sanitized source when provided', () => {
    expect(agentDefinitionRef('a', { file: 'src/a.ts', line: 4 })).toEqual({
      id: 'agent:a',
      kind: 'agent',
      role: 'invoked-agent',
      source: { file: 'src/a.ts', line: 4 },
    })
  })
})
