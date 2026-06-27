import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { composeTools } from '../entity'
import type { CruxEntity } from '../entity'
import type { ToolDef } from '../types/tool'
import { context } from '../prompt/context'

/** Create a minimal CruxEntity stub for testing. */
function stubEntity(id: string, tools: Record<string, ToolDef>): CruxEntity {
  return {
    id,
    asContext(options?: { priority?: number }) {
      return context({
        id,
        description: `Stub context for ${id}`,
        priority: options?.priority ?? 50,
        system: () => '',
      })
    },
    asTools() {
      return tools
    },
  }
}

/** Create a minimal ToolDef stub. */
function stubTool(desc: string): ToolDef {
  return {
    description: desc,
    parameters: z.object({}),
    execute: async () => 'ok',
  }
}

describe('composeTools', () => {
  it('merges tools from multiple entities', () => {
    const a = stubEntity('a', { foo: stubTool('foo') })
    const b = stubEntity('b', { bar: stubTool('bar') })

    const merged = composeTools(a, b)

    expect(Object.keys(merged)).toEqual(['foo', 'bar'])
    expect(merged.foo.description).toBe('foo')
    expect(merged.bar.description).toBe('bar')
  })

  it('throws on duplicate tool names', () => {
    const a = stubEntity('a', { overlap: stubTool('from a') })
    const b = stubEntity('b', { overlap: stubTool('from b') })

    expect(() => composeTools(a, b)).toThrow('Tool name collision: "overlap" is defined by multiple entities')
  })

  it('accepts a mix of entities and plain tool records', () => {
    const entity = stubEntity('e', { alpha: stubTool('alpha') })
    const plain: Record<string, ToolDef> = { beta: stubTool('beta') }

    const merged = composeTools(entity, plain)

    expect(Object.keys(merged)).toEqual(['alpha', 'beta'])
  })

  it('returns an empty record when given no sources', () => {
    const merged = composeTools()
    expect(merged).toEqual({})
  })

  it('passes through a single source unchanged', () => {
    const tools = { solo: stubTool('solo') }
    const entity = stubEntity('s', tools)

    const merged = composeTools(entity)

    expect(Object.keys(merged)).toEqual(['solo'])
    expect(merged.solo.description).toBe('solo')
  })

  it('handles entities with empty tool sets', () => {
    const empty = stubEntity('empty', {})
    const full = stubEntity('full', { x: stubTool('x') })

    const merged = composeTools(empty, full, empty)

    expect(Object.keys(merged)).toEqual(['x'])
  })
})
