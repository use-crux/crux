/** Provider-portable grouped assertion wire compiler. Internal. */

import { z } from 'zod'

export const ASSERTION_WIRE_COMPILER_VERSION = 1

const MAX_SCHEMA_DEPTH = 8
const MAX_SCHEMA_NODES = 128
const FORBIDDEN_KEYWORDS = new Set([
  'oneOf', 'anyOf', 'allOf', 'not', 'nullable', 'patternProperties',
  'additionalItems', 'contains', 'prefixItems', 'unevaluatedItems', 'unevaluatedProperties',
])

export type AssertionWireMode = 'typed' | 'json-string'

export interface AssertionWireSlot {
  readonly slot: `type_${number}`
  readonly type: string
  readonly mode: AssertionWireMode
  readonly schema: z.ZodType<unknown>
  readonly fallbackReason?: string
  readonly expectedShape: string
}

export interface AssertionWireManifest {
  readonly compilerVersion: number
  readonly slots: readonly AssertionWireSlot[]
}

export interface CompiledAssertionWire {
  readonly schema: z.ZodType<Record<string, unknown>>
  readonly manifest: AssertionWireManifest
}

export function compileAssertionWire(types: Record<string, z.ZodType<unknown>>): CompiledAssertionWire {
  const slots = Object.entries(types).sort(([left], [right]) => left.localeCompare(right)).map(([type, schema], index) => {
    const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
    const fallbackReason = portableSchemaIssue(json)
    return {
      slot: `type_${index}` as const,
      type,
      mode: fallbackReason === undefined ? 'typed' as const : 'json-string' as const,
      schema,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      expectedShape: describeShape(json),
    }
  })
  const evidence = z.array(z.object({
    kind: z.literal('chunk').describe('Evidence kind; always chunk.'),
    sourceId: z.string().describe('Source id shown in the prompt.'),
    chunkId: z.string().describe('Target chunk id shown in the prompt.'),
  }).strict().describe('One target chunk supporting this assertion.')).min(1)
  const provenance = z.enum(['exact', 'derived']).describe('Use exact for explicit claims and derived for supported inference.')
  const shape = Object.fromEntries(slots.map((entry) => {
    const data = entry.mode === 'typed'
      ? z.fromJSONSchema(z.toJSONSchema(entry.schema, { io: 'input' }) as never)
      : z.string().describe(`JSON-encoded assertion data. Expected shape: ${entry.expectedShape}`)
    const item = entry.mode === 'typed'
      ? z.object({ data, evidence, provenance }).strict()
      : z.object({ dataJson: data, evidence, provenance }).strict()
    return [entry.slot, z.array(item.strict()).describe(`Assertions of authored type "${entry.type}"; use [] when absent.`)]
  }))
  return {
    schema: z.object(shape).strict().describe('Grouped assertions; every slot is required and absent kinds use [].'),
    manifest: { compilerVersion: ASSERTION_WIRE_COMPILER_VERSION, slots },
  }
}

export function assertionWireFingerprintInput(types: Record<string, z.ZodType<unknown>>): unknown {
  const { manifest } = compileAssertionWire(types)
  return {
    compilerVersion: manifest.compilerVersion,
    slots: manifest.slots.map(({ slot, type, mode, fallbackReason, expectedShape }) => ({
      slot, type, mode, fallbackReason: fallbackReason ?? null, expectedShape,
    })),
  }
}

function portableSchemaIssue(root: Record<string, unknown>): string | undefined {
  let nodes = 0
  const visit = (value: unknown, depth: number): string | undefined => {
    if (depth > MAX_SCHEMA_DEPTH) return `schema exceeds maximum depth ${MAX_SCHEMA_DEPTH}`
    if (Array.isArray(value)) {
      for (const item of value) {
        const issue = visit(item, depth + 1)
        if (issue) return issue
      }
      return undefined
    }
    if (!isRecord(value)) return undefined
    nodes += 1
    if (nodes > MAX_SCHEMA_NODES) return `schema exceeds maximum size ${MAX_SCHEMA_NODES}`
    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (keyword in value) return `unsupported keyword ${keyword}`
    }
    if (Array.isArray(value.type) || value.type === 'null') return 'optional, nullable, or union types are unsupported'
    if (value.type === 'object') {
      if (!isRecord(value.properties) || value.additionalProperties !== false) return 'unconstrained objects and records are unsupported'
      const keys = Object.keys(value.properties)
      if (!Array.isArray(value.required) || keys.some((key) => !value.required!.includes(key))) {
        return 'optional object properties are unsupported'
      }
    }
    if (value.type === 'array' && !isRecord(value.items)) return 'arrays must have one homogeneous item schema'
    for (const child of Object.values(value)) {
      const issue = visit(child, depth + 1)
      if (issue) return issue
    }
    return undefined
  }
  return visit(root, 0)
}

function describeShape(schema: Record<string, unknown>): string {
  if (typeof schema.description === 'string') return schema.description
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(String).join(', ')}`
  if (schema.type === 'object' && isRecord(schema.properties)) {
    return `{ ${Object.entries(schema.properties).map(([key, value]) => `${key}: ${isRecord(value) ? describeShape(value) : 'value'}`).join(', ')} }`
  }
  if (schema.type === 'array' && isRecord(schema.items)) return `${describeShape(schema.items)}[]`
  return typeof schema.type === 'string' ? schema.type : 'JSON value'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
