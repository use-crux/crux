/**
 * Compiler-owned canonical structural validation of a rewritten occurrence.
 *
 * A rewrite is checked against a validator compiled from the canonical
 * (pre-lowering) schema node at its occurrence path: type, string/numeric
 * constraints, array bounds, enum/const, unions, nested objects, and
 * `$ref`/recursive resolution all fail closed before release. Provider lowering
 * artifacts never enter Safety semantics — an authored-optional property may be
 * absent — and with no compiled schema only serializability gates the rewrite.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import type { GuardrailContext } from '../../src/safety/guardrail/types'
import type { GuardrailBinding } from '../../src/safety/registry'
import { gateStructuredOccurrences, type StructuredGateOptions } from '../../src/safety/stream/structured-gating'
import type { JsonSchemaObject } from '../../src/adapter/structured-output'

const ctx: GuardrailContext = {
  promptId: 'p',
  model: 'm',
  messages: [],
  systemPrompt: undefined,
  traceId: undefined,
  metadata: {},
  stream: { segment: true, last: true, heldChars: 0, heldMs: 0 },
}

const canonical = (schema: z.ZodType): JsonSchemaObject => z.toJSONSchema(schema, { io: 'input' }) as JsonSchemaObject

function bindingFor(guard: ReturnType<typeof guardrail>): GuardrailBinding {
  return {
    kind: 'guardrail',
    policy: guard,
    boundary: (Array.isArray(guard.on) ? guard.on[0] : guard.on) as never,
    scope: 'call',
    mode: guard.mode,
    enabled: true,
  }
}

async function gate(
  value: unknown,
  guards: readonly ReturnType<typeof guardrail>[],
  canonicalSchema?: JsonSchemaObject,
): Promise<unknown> {
  const options: StructuredGateOptions = {
    guardContext: ctx,
    appendGuardrailAudit: () => {},
    ...(canonicalSchema ? { canonicalSchema } : {}),
  }
  return gateStructuredOccurrences(value, guards.map(bindingFor), options)
}

/** A guard that rewrites its whole occurrence to `next`. */
const rewriteWith = (id: string, on: unknown, next: unknown) =>
  guardrail({ id, on: on as never, run: () => ({ action: 'rewrite', value: next as never, rewrite: { kind: 'normalize' } }) })

describe('canonical structural validation of a rewritten occurrence', () => {
  it('enforces a string minLength constraint from the canonical node', async () => {
    const schema = z.object({ name: z.string().min(3) })
    const on = boundary.output.object<{ name: string }>().path('name')
    await expect(gate({ name: 'abcd' }, [rewriteWith('short', on, 'ab')], canonical(schema))).rejects.toThrow(
      /synchronize|schema/i,
    )
    expect(await gate({ name: 'abcd' }, [rewriteWith('ok', on, 'wxyz')], canonical(schema))).toEqual({ name: 'wxyz' })
  })

  it('enforces a numeric minimum from the canonical node', async () => {
    const schema = z.object({ age: z.number().min(18) })
    const on = boundary.output.object<{ age: number }>().path('age')
    await expect(gate({ age: 30 }, [rewriteWith('low', on, 5)], canonical(schema))).rejects.toThrow(/synchronize|schema/i)
    expect(await gate({ age: 30 }, [rewriteWith('ok', on, 21)], canonical(schema))).toEqual({ age: 21 })
  })

  it('enforces array bounds from the canonical node', async () => {
    const schema = z.object({ tags: z.array(z.string()).min(2) })
    const on = boundary.output.object<{ tags: readonly string[] }>().path('tags')
    await expect(gate({ tags: ['a', 'b'] }, [rewriteWith('one', on, ['x'])], canonical(schema))).rejects.toThrow(
      /synchronize|schema/i,
    )
    expect(await gate({ tags: ['a', 'b'] }, [rewriteWith('ok', on, ['x', 'y', 'z'])], canonical(schema))).toEqual({
      tags: ['x', 'y', 'z'],
    })
  })

  it('enforces an enum from the canonical node', async () => {
    const schema = z.object({ role: z.enum(['admin', 'user']) })
    const on = boundary.output.object<{ role: string }>().path('role')
    await expect(gate({ role: 'user' }, [rewriteWith('bad', on, 'ghost')], canonical(schema))).rejects.toThrow(
      /synchronize|schema/i,
    )
    expect(await gate({ role: 'user' }, [rewriteWith('ok', on, 'admin')], canonical(schema))).toEqual({ role: 'admin' })
  })

  it('accepts any matching branch of a union and rejects a non-matching value', async () => {
    const schema = z.object({ id: z.union([z.string(), z.number()]) })
    const on = boundary.output.object<{ id: string | number }>().path('id')
    await expect(gate({ id: 'x' }, [rewriteWith('bool', on, true)], canonical(schema))).rejects.toThrow(
      /synchronize|schema/i,
    )
    expect(await gate({ id: 'x' }, [rewriteWith('num', on, 7)], canonical(schema))).toEqual({ id: 7 })
  })

  it('validates a nested object node and allows extra keys under a strip object', async () => {
    const schema = z.object({ account: z.object({ email: z.string() }) })
    const on = boundary.output.object<{ account: { email: string } }>().path('account')
    // A default (strip) object allows extra keys — no false rejection.
    expect(
      await gate({ account: { email: 'a@b.io' } }, [rewriteWith('extra', on, { email: 'c@d.io', tag: 1 })], canonical(schema)),
    ).toEqual({ account: { email: 'c@d.io', tag: 1 } })
    // A mistyped nested field fails closed.
    await expect(
      gate({ account: { email: 'a@b.io' } }, [rewriteWith('bad', on, { email: 9 })], canonical(schema)),
    ).rejects.toThrow(/synchronize|schema/i)
  })

  it('permits an authored-optional property to be absent (no lowering artifact leaks in)', async () => {
    const schema = z.object({ name: z.string(), note: z.string().nullish() })
    const on = boundary.output.object<{ name: string; note?: string | null }>()
    // Omitting the authored-optional `note` is valid; a dropped required key is not.
    expect(await gate({ name: 'x' }, [rewriteWith('omit', on, { name: 'y' })], canonical(schema))).toEqual({ name: 'y' })
    await expect(gate({ name: 'x' }, [rewriteWith('drop', on, {})], canonical(schema))).rejects.toThrow(
      /synchronize|schema/i,
    )
  })

  it('resolves a recursive `$ref` node without crashing and still validates', async () => {
    const Category = z.object({
      name: z.string().min(1),
      get children() {
        return z.array(Category).optional()
      },
    })
    const on = boundary.output.object<{ name: string }>().path('name')
    const schema = canonical(Category)
    await expect(gate({ name: 'root' }, [rewriteWith('empty', on, '')], schema)).rejects.toThrow(/synchronize|schema/i)
    expect(await gate({ name: 'root' }, [rewriteWith('ok', on, 'branch')], schema)).toEqual({ name: 'branch' })
  })

  it('falls back to serializability alone when no canonical schema is provided', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(
      gate({ v: 'x' }, [rewriteWith('cyclic', boundary.output.object<{ v: string }>().path('v'), cyclic)]),
    ).rejects.toThrow(/synchronize|serializable/i)
  })
})
