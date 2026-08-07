/** Provider-portable grouped assertion wire compiler. Internal. */

import { z } from 'zod'

export const ASSERTION_WIRE_COMPILER_VERSION = 3

const MAX_SCHEMA_DEPTH = 8
const MAX_SCHEMA_NODES = 128
const ALLOWED_KEYWORDS = new Set([
  'type', 'description', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'minLength', 'maxLength', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems',
])
const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean'])
const ROOT_METADATA_KEYWORDS = new Set(['$schema'])

export type AssertionWireMode = 'typed' | 'json-string'

export interface AssertionWireSlot {
  readonly slot: `type_${number}`
  readonly type: string
  readonly mode: AssertionWireMode
  readonly schema: z.ZodType<unknown>
  readonly dataSchema: z.ZodType<unknown>
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
  const slots = Object.entries(types).sort(([left], [right]) => left.localeCompare(right))
    .map(([type, schema], index) => compileSlot(type, schema, index))
  const evidence = z.array(z.object({
    kind: z.literal('chunk').describe('Evidence kind; always chunk.'),
    sourceId: z.string().describe('Source id shown in the prompt.'),
    chunkId: z.string().describe('Target chunk id shown in the prompt.'),
  }).strict().describe('One target chunk supporting this assertion.')).min(1)
  const provenance = z.enum(['exact', 'derived']).describe('Use exact for explicit claims and derived for supported inference.')
  const shape = Object.fromEntries(slots.map((entry) => {
    const data = entry.mode === 'typed'
      ? entry.dataSchema
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

function compileSlot(type: string, schema: z.ZodType<unknown>, index: number): AssertionWireSlot {
  const slot = `type_${index}` as const
  const authoredIssue = authoredSchemaIssue(schema)
  if (authoredIssue !== undefined) return fallbackSlot(slot, type, schema, authoredIssue)
  let json: Record<string, unknown>
  try {
    json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  } catch {
    return fallbackSlot(slot, type, schema, 'schema conversion failed')
  }
  closePlainObjects(json)
  const fallbackReason = portableSchemaIssue(json)
  if (fallbackReason !== undefined) return fallbackSlot(slot, type, schema, fallbackReason, describeShape(json))
  try {
    const dataSchema = z.fromJSONSchema(json as never)
    return {
      slot, type, mode: 'typed', schema,
      dataSchema: schema.description ? dataSchema.describe(schema.description) : dataSchema,
      expectedShape: describeShape(json),
    }
  } catch {
    return fallbackSlot(slot, type, schema, 'schema reconstruction failed', describeShape(json))
  }
}

function closePlainObjects(value: unknown): void {
  if (!isRecord(value)) return
  if (value.type === 'object' && value.additionalProperties === undefined) value.additionalProperties = false
  if (isRecord(value.properties)) {
    for (const child of Object.values(value.properties)) closePlainObjects(child)
  }
  if (value.items !== undefined) closePlainObjects(value.items)
}

function authoredSchemaIssue(schema: z.ZodType<unknown>): string | undefined {
  const type = (schema as { _zod?: { def?: { type?: unknown } } })._zod?.def?.type
  if (type === 'any' || type === 'unknown') return `unconstrained ${type} schema is unsupported`
  if (type === 'pipe') return 'transformed schemas are unsupported'
  return undefined
}

function fallbackSlot(
  slot: `type_${number}`,
  type: string,
  schema: z.ZodType<unknown>,
  fallbackReason: string,
  expectedShape = schema.description || 'JSON value',
): AssertionWireSlot {
  return {
    slot, type, mode: 'json-string', schema,
    dataSchema: z.string().describe(`JSON-encoded assertion data. Expected shape: ${expectedShape}`),
    fallbackReason, expectedShape,
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
    for (const keyword of Object.keys(value)) {
      if (!ALLOWED_KEYWORDS.has(keyword) && !(depth === 0 && ROOT_METADATA_KEYWORDS.has(keyword))) {
        return `unsupported keyword ${keyword}`
      }
    }
    if (typeof value.type !== 'string') return 'unconstrained schema is unsupported'
    if (!PRIMITIVE_TYPES.has(value.type) && value.type !== 'object' && value.type !== 'array') return `unsupported type ${value.type}`
    if (value.type === 'object') {
      if (!isRecord(value.properties) || value.additionalProperties !== false) return 'unconstrained objects and records are unsupported'
      const keys = Object.keys(value.properties)
      if (keys.length === 0) return 'empty objects are unsupported'
      if (!Array.isArray(value.required) || keys.some((key) => !value.required!.includes(key))) {
        return 'optional object properties are unsupported'
      }
    }
    if (value.type === 'array' && !isRecord(value.items)) return 'arrays must have one homogeneous item schema'
    if (isRecord(value.properties)) {
      for (const child of Object.values(value.properties)) {
        const issue = visit(child, depth + 1)
        if (issue) return issue
      }
    }
    if (value.items !== undefined) return visit(value.items, depth + 1)
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
