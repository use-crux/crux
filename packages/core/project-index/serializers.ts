/**
 * Serialize Prompt and Context instances into JSON-safe metadata
 * for transmission to the devtools UI.
 *
 * Uses Zod v4's built-in `z.toJSONSchema()` for schema conversion.
 *
 * @module
 */

import { z } from 'zod'
import type { AnyPrompt, Context } from '../types'
import type { FlowToolDef } from '../testing'
import type {
  PromptMeta,
  ContextMeta,
  ToolMeta,
  JsonSchema,
  ProjectDefinition,
  ProjectRelation,
  ProjectIndexSnapshot,
  ProjectIdentity,
  CruxLintConfig,
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleCatalogEntry,
  IndexSourceFile,
} from './index'
import { getPromptDefinitionSource } from '../define'
import { getContextDefinitionSource } from '../context'

/**
 * Convert a Zod schema to JSON Schema using Zod v4's static `z.toJSONSchema()`.
 */
function zodToJson(schema: unknown): JsonSchema | undefined {
  if (!schema || typeof schema !== 'object') return undefined

  // Zod v4: use static z.toJSONSchema(schema)
  try {
    return toJsonSafeSchema(z.toJSONSchema(schema as z.ZodType))
  } catch {
    // Fall through to manual extraction
  }

  // Fallback: manual extraction from Zod v4 internals
  const extracted = extractFromZodDef(schema)
  return extracted ? toJsonSafeSchema(extracted) : undefined
}

function toJsonSafeSchema(value: unknown): JsonSchema {
  return JSON.parse(JSON.stringify(value)) as JsonSchema
}

/**
 * Manual extraction from Zod v4 internals when .toJSONSchema() isn't available.
 */
function extractFromZodDef(schema: unknown): JsonSchema | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  const s = schema as Record<string, unknown>

  // Zod v4: schema has .def and .type at top level
  const def = s.def as Record<string, unknown> | undefined
  const type = s.type as string | undefined

  if (!def) return undefined

  if (type === 'object' && def.shape && typeof def.shape === 'object') {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
      const fieldSchema = extractFieldType(value)
      properties[key] = fieldSchema
      if (!isOptional(value)) {
        required.push(key)
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    }
  }

  if (type === 'array') {
    return {
      type: 'array',
      items: def.element ? extractFieldType(def.element) : {},
    }
  }

  if (typeof type === 'string') {
    return { type }
  }

  return undefined
}

/** Extract a JSON Schema type representation from a single Zod field, recursing into nested types. */
function extractFieldType(schema: unknown): JsonSchema {
  if (!schema || typeof schema !== 'object') return {}
  const s = schema as Record<string, unknown>
  const def = s.def as Record<string, unknown> | undefined
  const type = s.type as string | undefined
  const description = s.description as string | undefined

  if (type === 'optional' && def?.innerType) {
    const inner = extractFieldType(def.innerType)
    return description ? { ...inner, description } : inner
  }

  if (type === 'nullable' && def?.innerType) {
    const inner = extractFieldType(def.innerType)
    const result = { ...inner, nullable: true }
    return description ? { ...result, description } : result
  }

  if (type === 'array') {
    const result: JsonSchema = {
      type: 'array',
      items: def?.element ? extractFieldType(def.element) : {},
    }
    return description ? { ...result, description } : result
  }

  if (type === 'object' && def?.shape) {
    const result = extractFromZodDef(schema) ?? { type: 'object' }
    return description ? { ...result, description } : result
  }

  if (type === 'enum' && def?.entries) {
    const result: JsonSchema = {
      type: 'string',
      enum: Object.keys(def.entries as object),
    }
    return description ? { ...result, description } : result
  }

  if (typeof type === 'string') {
    return description ? { type, description } : { type }
  }

  return {}
}

const MAX_SOURCE_LENGTH = 10_000

/** Extract function source via `.toString()`, with a size guard. */
function fnSource(fn: Function): string | null {
  try {
    const src = fn.toString()
    return src.length <= MAX_SOURCE_LENGTH ? src : null
  } catch {
    return null
  }
}

/** Check whether a Zod schema represents an optional field (type === 'optional'). */
function isOptional(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false
  return (schema as { type?: unknown }).type === 'optional'
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function fingerprint(value: unknown): string {
  const input = stableStringify(value)
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function fallbackId(kind: string, name: string | undefined, index: number): string {
  const base = name?.trim() || `anonymous-${index + 1}`
  return `${kind}:${base}`
}

/**
 * Serialize a `Prompt` instance into JSON-safe metadata for the devtools index.
 *
 * Extracts the prompt's ID, description, tags, input/output schemas (converted to
 * JSON Schema), context references, and settings.
 *
 * @param prompt - The prompt instance to serialize.
 * @returns A `PromptMeta` object ready for transmission to the devtools server.
 */
export function serializePrompt(prompt: AnyPrompt): PromptMeta {
  const meta: PromptMeta = {
    id: prompt.id,
    description: prompt.description,
    tags: prompt.tags,
    inputSchema: zodToJson(prompt.inputSchema),
    outputSchema: prompt.hasOutput ? zodToJson(prompt.outputSchema) : undefined,
    contextIds: prompt.contexts
      .filter(
        (c): c is Context<z.ZodType> =>
          !!c && typeof c === 'object' && '_tag' in c && (c as { _tag: unknown })._tag === 'Context',
      )
      .map((c) => c.id),
    hasOutput: !!prompt.hasOutput,
    settings: (prompt.config.settings as Record<string, unknown>) ?? {},
  }

  // Extract system template
  const sys = prompt.config.system
  if (typeof sys === 'string') meta.systemTemplate = sys
  else if (typeof sys === 'function') meta.systemTemplate = fnSource(sys)

  // Extract prompt template
  const pr = prompt.config.prompt
  if (typeof pr === 'string') meta.promptTemplate = pr
  else if (typeof pr === 'function') meta.promptTemplate = fnSource(pr)

  // Messages mode
  if (prompt.config.messages) meta.hasMessages = true

  // Definition-site source location (for source map resolution)
  const defSource = getPromptDefinitionSource(prompt)
  if (defSource) meta.definitionSource = defSource

  return meta
}

/**
 * Serialize a `Context` instance into JSON-safe metadata for the devtools index.
 *
 * Includes the context's ID, description, priority, input schema, whether it's static,
 * and which prompts reference it (computed via `usedBy`).
 *
 * @param ctx - The context instance to serialize.
 * @param prompts - All known prompts, used to compute the `usedBy` list.
 * @returns A `ContextMeta` object ready for transmission to the devtools server.
 */
export function serializeContext(ctx: Context<z.ZodType>, prompts: AnyPrompt[]): ContextMeta {
  const usedBy = prompts.filter((p) => p.contexts.some((c) => c === ctx)).map((p) => p.id)

  const meta: ContextMeta = {
    id: ctx.id,
    description: ctx.description,
    priority: ctx.priority,
    inputSchema: zodToJson(ctx.inputSchema),
    isStatic: typeof ctx.systemFn === 'function' && ctx.inputSchema === undefined,
    usedBy,
  }

  // Extract system text for static contexts (no input schema → safe to call with {})
  if (ctx.inputSchema === undefined && typeof ctx.systemFn === 'function') {
    try {
      const result = ctx.systemFn({})
      // Static contexts return strings synchronously; async contexts return Promises
      meta.systemTemplate = typeof result === 'string' ? result : fnSource(ctx.systemFn)
    } catch {
      meta.systemTemplate = fnSource(ctx.systemFn)
    }
  } else if (ctx.inputSchema !== undefined) {
    meta.systemTemplate = fnSource(ctx.systemFn)
  }

  // Definition-site source location (for source map resolution)
  const defSource = getContextDefinitionSource(ctx)
  if (defSource) meta.definitionSource = defSource

  return meta
}

/**
 * Serialize a `FlowToolDef` into JSON-safe metadata for the devtools index.
 */
export function serializeTool(tool: FlowToolDef): ToolMeta {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJson(tool.parameters),
  }
}

/**
 * Serialize a full index of prompts, contexts, and tools.
 *
 * @param prompts - All prompt instances to serialize.
 * @param contexts - Explicit context instances (auto-collected from prompts too).
 * @param paths - Optional namespace paths from tree builders (id → path segments).
 * @param tools - Optional tool definitions to include in the index.
 */
export function serializeIndex(
  prompts: AnyPrompt[],
  contexts: Context<z.ZodType>[],
  paths?: Map<string, string[]>,
  tools?: FlowToolDef[],
): { prompts: PromptMeta[]; contexts: ContextMeta[]; tools?: ToolMeta[] } {
  // Collect all unique contexts from prompts + explicit contexts
  const allContexts = new Set<Context<z.ZodType>>(contexts)
  for (const p of prompts) {
    for (const c of p.contexts) {
      if (c && typeof c === 'object' && '_tag' in c && (c as { _tag: unknown })._tag === 'Context') {
        allContexts.add(c as Context<z.ZodType>)
      }
    }
  }

  const result: {
    prompts: PromptMeta[]
    contexts: ContextMeta[]
    tools?: ToolMeta[]
  } = {
    prompts: prompts.map((p) => {
      const meta = serializePrompt(p)
      if (paths && p.id && paths.has(p.id)) {
        meta.path = paths.get(p.id)
      }
      return meta
    }),
    contexts: [...allContexts].map((c) => {
      const meta = serializeContext(c, prompts)
      if (paths && c.id && paths.has(c.id)) {
        meta.path = paths.get(c.id)
      }
      return meta
    }),
  }

  if (tools && tools.length > 0) {
    result.tools = tools.map((t) => {
      const meta = serializeTool(t)
      if (paths && paths.has(t.name)) {
        meta.path = paths.get(t.name)
      }
      return meta
    })
  }

  return result
}

export function indexDefinitionsFromSnapshot(index: {
  prompts: PromptMeta[]
  contexts: ContextMeta[]
  tools?: ToolMeta[]
}): {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: IndexDiagnostic[]
  sources: IndexSourceFile[]
} {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const diagnostics: IndexDiagnostic[] = []
  const sourceFiles = new Map<string, IndexSourceFile>()

  function trackSource(definitionId: string, source: { file: string } | undefined): void {
    if (!source) return
    const existing = sourceFiles.get(source.file) ?? {
      file: source.file,
      status: 'indexed' as const,
      definitionIds: [],
    }
    existing.definitionIds = [...(existing.definitionIds ?? []), definitionId]
    sourceFiles.set(source.file, existing)
  }

  index.prompts.forEach((prompt, index) => {
    const id = fallbackId('prompt', prompt.id, index)
    const definition: ProjectDefinition = {
      id,
      kind: 'prompt',
      name: prompt.id ?? id,
      description: prompt.description,
      tags: [...prompt.tags],
      path: prompt.path,
      source: prompt.definitionSource,
      fidelity: prompt.id ? 'resolved' : 'partial',
      status: 'active',
      fingerprint: fingerprint({
        kind: 'prompt',
        id: prompt.id,
        description: prompt.description,
        tags: prompt.tags,
        inputSchema: prompt.inputSchema,
        outputSchema: prompt.outputSchema,
        contextIds: prompt.contextIds,
        systemTemplate: prompt.systemTemplate,
        promptTemplate: prompt.promptTemplate,
        hasMessages: prompt.hasMessages,
      }),
      metadata: {
        inputSchema: prompt.inputSchema,
        outputSchema: prompt.outputSchema,
        hasOutput: prompt.hasOutput,
        settings: prompt.settings,
      },
    }
    definitions.push(definition)
    trackSource(id, prompt.definitionSource)

    if (!prompt.id) {
      diagnostics.push({
        id: `diagnostic:${id}:missing-id`,
        severity: 'warning',
        code: 'missing-definition-id',
        message: 'Prompt has no explicit id; Crux derived a local fallback id.',
        source: prompt.definitionSource,
        relatedDefinitionIds: [id],
        suggestedFix: 'Add a stable prompt id for history, baselines, and affected-eval tracking.',
      })
    }

    prompt.contextIds.forEach((contextId, relationIndex) => {
      if (!contextId) return
      relations.push({
        id: `relation:${id}:uses-context:${contextId}:${relationIndex}`,
        type: 'prompt.uses_context',
        from: id,
        to: `context:${contextId}`,
        fidelity: 'resolved',
        source: prompt.definitionSource,
      })
    })
  })

  index.contexts.forEach((context, index) => {
    const id = fallbackId('context', context.id, index)
    const definition: ProjectDefinition = {
      id,
      kind: 'context',
      name: context.id ?? id,
      description: context.description,
      path: context.path,
      source: context.definitionSource,
      fidelity: context.id ? 'resolved' : 'partial',
      status: 'active',
      fingerprint: fingerprint({
        kind: 'context',
        id: context.id,
        description: context.description,
        priority: context.priority,
        inputSchema: context.inputSchema,
        isStatic: context.isStatic,
        systemTemplate: context.systemTemplate,
      }),
      metadata: {
        inputSchema: context.inputSchema,
        priority: context.priority,
        isStatic: context.isStatic,
        usedBy: context.usedBy,
      },
    }
    definitions.push(definition)
    trackSource(id, context.definitionSource)

    if (!context.id) {
      diagnostics.push({
        id: `diagnostic:${id}:missing-id`,
        severity: 'warning',
        code: 'missing-definition-id',
        message: 'Context has no explicit id; Crux derived a local fallback id.',
        source: context.definitionSource,
        relatedDefinitionIds: [id],
        suggestedFix: 'Add a stable context id so prompts and index relations remain durable.',
      })
    }
  })
  ;(index.tools ?? []).forEach((tool, index) => {
    const id = fallbackId('tool', tool.name, index)
    definitions.push({
      id,
      kind: 'tool',
      name: tool.name,
      description: tool.description,
      path: tool.path,
      fidelity: tool.name ? 'resolved' : 'partial',
      status: 'active',
      fingerprint: fingerprint({
        kind: 'tool',
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }),
      metadata: {
        inputSchema: tool.inputSchema,
      },
    })
  })

  return {
    definitions,
    relations,
    diagnostics,
    sources: [...sourceFiles.values()],
  }
}

export function serializeProjectIndex(input: {
  project: ProjectIdentity
  lint?: CruxLintConfig
  prompts: AnyPrompt[]
  contexts?: Context<z.ZodType>[]
  paths?: Map<string, string[]>
  tools?: FlowToolDef[]
  indexedAt?: string
  definitions?: ProjectDefinition[]
  relations?: ProjectRelation[]
  diagnostics?: IndexDiagnostic[]
  lintFindings?: IndexLintFinding[]
  ruleCatalog?: IndexRuleCatalogEntry[]
  sources?: IndexSourceFile[]
  sourceGraph?: ProjectIndexSnapshot['sourceGraph']
}): ProjectIndexSnapshot {
  const index = serializeIndex(input.prompts, input.contexts ?? [], input.paths, input.tools)
  const derived = indexDefinitionsFromSnapshot(index)
  return {
    schemaVersion: 1,
    ...index,
    tools: index.tools ?? [],
    project: input.project,
    ...(input.lint ? { lint: input.lint } : {}),
    ...(input.sourceGraph ? { sourceGraph: input.sourceGraph } : {}),
    indexedAt: input.indexedAt ?? new Date().toISOString(),
    definitions: [...derived.definitions, ...(input.definitions ?? [])],
    relations: [...derived.relations, ...(input.relations ?? [])],
    diagnostics: [...derived.diagnostics, ...(input.diagnostics ?? [])],
    lintFindings: input.lintFindings ?? [],
    ruleCatalog: input.ruleCatalog ?? [],
    sources: [...derived.sources, ...(input.sources ?? [])],
  }
}
