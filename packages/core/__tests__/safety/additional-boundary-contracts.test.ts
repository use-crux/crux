/** Runtime contracts for additional Safety lifecycle boundary descriptors. */

import { describe, expect, it, vi } from 'vitest'
import {
  boundary,
  createSafety,
  guardrail,
  SafetyConfigError,
  SafetyResultError,
  type BoundaryDef,
  type ToolDefinitionSource,
} from '../../src/safety'
import {
  validateMemoryWriteGuardrailResult,
  validateToolDefinitionGuardrailResult,
} from '../../src/safety/guardrail/specialized-results'

describe('additional Safety boundary descriptors', () => {
  it('creates frozen serializable tool boundary forms with one canonical id', () => {
    const all = boundary.input.tools()
    const discovered = boundary.input.tools({ from: 'discovered' })
    const selected = boundary.input.tools({
      from: ['authored', 'discovered', 'authored'] as const,
    })
    const descriptions = selected.descriptions()

    expect([all, discovered, selected, descriptions].map((entry) => entry.id)).toEqual([
      'model.input.tools',
      'model.input.tools',
      'model.input.tools',
      'model.input.tools',
    ])
    expect(JSON.parse(JSON.stringify(all))).toEqual({
      _tag: 'Boundary',
      id: 'model.input.tools',
    })
    expect(JSON.parse(JSON.stringify(discovered))).toEqual({
      _tag: 'Boundary',
      id: 'model.input.tools',
      from: ['discovered'],
    })
    expect(JSON.parse(JSON.stringify(selected))).toEqual({
      _tag: 'Boundary',
      id: 'model.input.tools',
      from: ['authored', 'discovered'],
    })
    expect(JSON.parse(JSON.stringify(descriptions))).toEqual({
      _tag: 'Boundary',
      id: 'model.input.tools',
      from: ['authored', 'discovered'],
      selector: 'descriptions',
    })
    expect(Object.keys(all)).not.toContain('descriptions')
    expect([all, discovered, selected, descriptions].every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(discovered.from)).toBe(true)
    expect(Object.isFrozen(selected.from)).toBe(true)
    expect(Object.isFrozen(descriptions.from)).toBe(true)
  })

  it('rejects a dynamically empty tool source filter', () => {
    const sources: readonly ToolDefinitionSource[] = []

    expect(() => boundary.input.tools({ from: sources })).toThrow(
      /cannot be empty/i,
    )
  })

  it('includes the selector in duplicate binding identity', () => {
    const duplicate = guardrail({
      id: 'duplicate-tool-descriptions',
      on: [
        boundary.input.tools().descriptions(),
        boundary.input.tools({ from: 'discovered' }).descriptions(),
      ] as const,
      run: () => ({ action: 'allow' }),
    })

    expect(() =>
      createSafety({
        call: { guardrails: [duplicate] },
      }),
    ).toThrow(/model\.input\.tools:descriptions/)
  })

  it.each([
    [
      'root tool definitions',
      [boundary.input.tools(), boundary.input.text()],
    ],
    [
      'root and description tool definitions',
      [boundary.input.tools(), boundary.input.tools().descriptions()],
    ],
    [
      'tool descriptions and structured output',
      [
        boundary.input.tools().descriptions(),
        boundary.output.object<{ readonly answer: string }>(),
      ],
    ],
    [
      'memory writes and model output',
      [boundary.memory.write(), boundary.output.text()],
    ],
  ] satisfies ReadonlyArray<readonly [string, readonly BoundaryDef[]]>)(
    'rejects mixed %s families before policy execution',
    (_case, on) => {
      const run = vi.fn(() => ({ action: 'allow' as const }))
      const invalid = guardrail({
        id: 'invalid-specialized-family',
        on: on as never,
        run,
      })

      expect(() =>
        createSafety({
          call: { guardrails: [invalid] },
        }),
      ).toThrow(SafetyConfigError)
      expect(run).not.toHaveBeenCalled()
    },
  )

  it.each([
    { action: 'rewrite', value: 'changed', rewrite: { kind: 'normalize' } },
    { action: 'hold' },
    { action: 'strip', reason: '' },
    { action: 'unknown' },
  ])('fails closed for malformed root tool result $action', (result) => {
    expect(() =>
      validateToolDefinitionGuardrailResult(result, {
        policyId: 'tool-policy',
        boundary: 'model.input.tools',
      }),
    ).toThrow(SafetyResultError)
  })

  it.each([
    { action: 'hold' },
    { action: 'strip', reason: 'unsupported action' },
    { action: 'drop' },
    { action: 'rewrite', rewrite: { kind: 'normalize' } },
    { action: 'rewrite', value: 'changed', rewrite: { kind: 'unknown' } },
  ])('fails closed for malformed memory result $action', (result) => {
    expect(() =>
      validateMemoryWriteGuardrailResult(result, {
        policyId: 'memory-policy',
        boundary: 'memory.write',
      }),
    ).toThrow(SafetyResultError)
  })
})
