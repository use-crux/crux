import { describe, expect, it } from 'vitest'
import {
  knowledgeAdjacencyInKey,
  knowledgeAdjacencyInPrefix,
  knowledgeAdjacencyOutKey,
  knowledgeAdjacencyOutPrefix,
  knowledgeAliasKey,
  knowledgeAssertionsItemKey,
  knowledgeClaimsKey,
  knowledgeCurrentKey,
  knowledgeEdgeKey,
  knowledgeEntityKey,
  knowledgeViewIndexKey,
  knowledgeViewRevisionKey,
} from '../../src/knowledge/keys'

describe('knowledge record keys', () => {
  it('builds exact persisted key strings under the indexed namespace prefix', () => {
    const refA = { kind: 'chunk' as const, sourceId: 'doc:1', chunkId: 'chunk%a' }
    const refB = { kind: 'entity' as const, entityId: 'Entity:100%' }

    expect(knowledgeCurrentKey('kb', 'tenant:a')).toBe('indexer:kb:namespace:tenant:a:knowledge:current')
    expect(knowledgeEdgeKey('kb', 'tenant:a', 'gen:1', 'edge:1')).toBe(
      'indexer:kb:namespace:tenant:a:knowledge:gen:gen:1:edge:edge:1',
    )
    expect(knowledgeAdjacencyOutKey('kb', 'tenant:a', 'gen:1', refA, 'mentions:%', 'edge:1')).toBe(
      'indexer:kb:namespace:tenant:a:knowledge:gen:gen:1:adj:out:chunk:doc%3A1:chunk%25a:mentions:%:edge:1',
    )
    expect(knowledgeAdjacencyInKey('kb', 'tenant:a', 'gen:1', refB, 'mentions:%', 'edge:1')).toBe(
      'indexer:kb:namespace:tenant:a:knowledge:gen:gen:1:adj:in:entity:Entity%3A100%25:mentions:%:edge:1',
    )
    expect(knowledgeEntityKey('kb', 'tenant:a', 'gen:1', 'Entity:100%')).toBe(
      'indexer:kb:namespace:tenant:a:knowledge:gen:gen:1:entity:Entity:100%',
    )
    expect(knowledgeAliasKey('kb', 'tenant:a', 'gen:1', 'Alias:100%', 'Entity:100%')).toBe(
      'indexer:kb:namespace:tenant:a:knowledge:gen:gen:1:alias:Alias:100%:Entity:100%',
    )
    expect(knowledgeClaimsKey('kb', 'tenant:a', 'stage:1', 'doc:1', 'hash:1')).toBe(
      'indexer:kb:namespace:tenant:a:claims:stage:1:source:doc:1:hash:1',
    )
    expect(knowledgeAssertionsItemKey('kb', 'tenant:a', 'stage:1', 'gen:1', 'assertion:1')).toBe(
      'indexer:kb:namespace:tenant:a:assertions:stage:1:gen:gen:1:item:assertion:1',
    )
    expect(knowledgeViewIndexKey('kb', 'tenant:a', 'view:1', 'field:1', 'value:1', 'doc:1')).toBe(
      'indexer:kb:namespace:tenant:a:view:view:1:index:field:1:value:1:doc:1',
    )
    expect(knowledgeViewRevisionKey('kb', 'tenant:a', 'view:1', 'revision:1')).toBe(
      'indexer:kb:namespace:tenant:a:view:view:1:revision:revision:1',
    )
  })

  it('builds adjacency prefixes that keep related edge keys grouped for sorted scans', () => {
    const ref = { kind: 'document' as const, sourceId: 'doc:1' }
    const outPrefix = knowledgeAdjacencyOutPrefix('kb', 'ns', 'gen', ref)
    const inPrefix = knowledgeAdjacencyInPrefix('kb', 'ns', 'gen', ref)

    expect(knowledgeAdjacencyOutKey('kb', 'ns', 'gen', ref, 'a', '2').startsWith(outPrefix)).toBe(true)
    expect(knowledgeAdjacencyOutKey('kb', 'ns', 'gen', ref, 'b', '1').startsWith(outPrefix)).toBe(true)
    expect(knowledgeAdjacencyInKey('kb', 'ns', 'gen', ref, 'a', '2').startsWith(inPrefix)).toBe(true)
    expect(knowledgeAdjacencyInKey('kb', 'ns', 'gen', ref, 'b', '1').startsWith(inPrefix)).toBe(true)

    expect(
      [
        knowledgeAdjacencyOutKey('kb', 'ns', 'gen', ref, 'b', '1'),
        knowledgeAdjacencyOutKey('kb', 'ns', 'gen', ref, 'a', '2'),
      ].sort(),
    ).toEqual([
      'indexer:kb:namespace:ns:knowledge:gen:gen:adj:out:document:doc%3A1:a:2',
      'indexer:kb:namespace:ns:knowledge:gen:gen:adj:out:document:doc%3A1:b:1',
    ])
  })
})
