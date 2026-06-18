/**
 * Prompt compilation and resolution pipeline.
 *
 * `compilePrompt()` is the public boundary: it performs definition-time
 * validation/schema merging once, then exposes one-pass resolve and inspect
 * projections for adapters, prompt instances, and tests.
 *
 * @module
 */

import { z } from 'zod'
import type {
  AnyToolSet,
  Context,
  ContextEntry,
  BlackboardEntry,
  MemoryEntry,
  SkillEntry,
  PromptAdaptation,
  AdapterMap,
  AnyMessage,
  GenerationSettings,
  ModelInfo,
  ResolvedPrompt,
  SystemBlock,
  InspectPart,
  InspectResult,
  DroppedContext,
  ExcludedContext,
  AnyPromptConfig,
  ContextSystemContent,
  ContextSystemResult,
  ContextTextSegment,
} from './types'
import type { Constraint } from './safety/constraint/types'
import type { Guardrail } from './safety/guardrail/types'
import type {
  CruxArtifactId,
  CruxContextContributionPreview,
  CruxContextInjectableKind,
  CruxContextInjects,
  CruxPromptInputPreview,
  CruxPromptBudgetPreview,
} from './observability/contract'
import { LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME } from './skill/tools'
import { countTokens } from './tokenizer'
import { escapeXml, detectSuspiciousPatterns } from './sanitize'
import { observe } from './observability'
import type { MergedResolution, ResolvedSystemContent } from './resolver/contract'
import { resolveUse } from './resolver/driver'
import {
  collectSchemaContributions,
  contextContributionKind,
  contextInjectedToolNames,
  contextInjects,
} from './resolver/lower'
import { withDefaultResolverPorts, type ResolverPorts } from './resolver/ports'
import { createSkillToolSurface, resolveSkillSurface } from './resolver/skills'

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

/** Result shape returned by Zod's `safeParse` for resolve-time validation. */
interface SafeParseResult {
  success: boolean
  data?: unknown
  error?: { issues?: readonly unknown[] }
}

/**
 * Run `safeParse` on an arbitrary schema-like value. Falls back to a successful
 * pass-through when the value does not expose the expected method (e.g. mocks
 * supplied by callers that pre-validate elsewhere).
 */
function safeParseSchema(schema: z.ZodType, input: unknown): SafeParseResult {
  const candidate = schema as { safeParse?: (value: unknown) => SafeParseResult }
  if (typeof candidate.safeParse !== 'function') {
    return { success: true, data: input }
  }
  return candidate.safeParse(input)
}

/**
 * Compute a stable context-cache key from context id and relevant input fields.
 * Only includes keys declared in the context's inputSchema. Storage and
 * expiry live behind the `ContextCachePort`.
 */
function computeCacheKey(contextId: string, input: Record<string, unknown>, inputKeys: readonly string[]): string {
  if (inputKeys.length === 0) {
    return `cache:ctx:${contextId}:`
  }
  const relevant: Record<string, unknown> = {}
  const sortedKeys = [...inputKeys].sort()
  for (const key of sortedKeys) {
    relevant[key] = input[key]
  }
  return `cache:ctx:${contextId}:${JSON.stringify(relevant)}`
}

/** The default ports every compiled prompt uses unless compile options override them. */
const defaultPorts: ResolverPorts = withDefaultResolverPorts()

// ─────────────────────────────────────────────────────────────────
// Prompt Text Resolution
// ─────────────────────────────────────────────────────────────────

async function renderPromptText<T>(
  value: string | ((arg: { input: T }) => string | Promise<string>) | undefined,
  input: T,
): Promise<string> {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  const result = await value({ input })
  if (result != null && typeof result !== 'string') {
    throw new Error(
      `Prompt system/prompt function must return a string, got ${typeof result}. ` +
        `Value: ${JSON.stringify(result).slice(0, 200)}`,
    )
  }
  return result ?? ''
}

function isContextSystemContent(value: unknown): value is ContextSystemContent {
  return typeof value === 'object' && value !== null && Array.isArray((value as { segments?: unknown }).segments)
}

function normalizeSystemContent(
  value: ContextSystemResult | null | undefined,
  fallbackDynamic: boolean,
  errorLabel = 'Prompt system/context function',
  inferenceInput?: unknown,
): ResolvedSystemContent {
  if (value === undefined || value === null) return { text: '' }
  if (typeof value === 'string') {
    if (!value) return { text: '' }
    if (fallbackDynamic) {
      const inferredSegments = inferInputValueSegments(value, inferenceInput)
      if (inferredSegments.length > 0) return segmentsToSystemContent(inferredSegments)
    }
    return segmentsToSystemContent([{ text: value, dynamic: fallbackDynamic }])
  }
  if (!isContextSystemContent(value)) {
    throw new Error(
      `${errorLabel} must return a string or { segments }, got ${typeof value}. ` +
        `Value: ${JSON.stringify(value).slice(0, 200)}`,
    )
  }
  return segmentsToSystemContent(value.segments)
}

interface PrimitiveInputValue {
  source: string
  value: string
}

function inferInputValueSegments(text: string, input: unknown): ContextTextSegment[] {
  const values = uniquePrimitiveInputValues(input)
  if (values.length === 0) return []
  const matches: Array<{ start: number; end: number; source: string; value: string }> = []
  for (const entry of values) {
    let start = text.indexOf(entry.value)
    while (start >= 0) {
      matches.push({ start, end: start + entry.value.length, source: entry.source, value: entry.value })
      start = text.indexOf(entry.value, start + entry.value.length)
    }
  }
  if (matches.length === 0) return []

  const selected: typeof matches = []
  for (const match of matches.sort(
    (left, right) => left.start - right.start || right.value.length - left.value.length,
  )) {
    const overlaps = selected.some((existing) => match.start < existing.end && match.end > existing.start)
    if (!overlaps) selected.push(match)
  }
  selected.sort((left, right) => left.start - right.start)

  const segments: ContextTextSegment[] = []
  let cursor = 0
  for (const match of selected) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), dynamic: false })
    segments.push({ text: text.slice(match.start, match.end), dynamic: true, source: match.source })
    cursor = match.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), dynamic: false })
  return segments
}

function uniquePrimitiveInputValues(input: unknown): PrimitiveInputValue[] {
  const values = collectPrimitiveInputValues(input)
  const byValue = new Map<string, PrimitiveInputValue[]>()
  for (const value of values) {
    if (value.value.trim().length === 0) continue
    const bucket = byValue.get(value.value) ?? []
    bucket.push(value)
    byValue.set(value.value, bucket)
  }
  return [...byValue.values()]
    .filter((bucket) => bucket.length === 1)
    .map((bucket) => bucket[0]!)
    .sort((left, right) => right.value.length - left.value.length || left.source.localeCompare(right.source))
}

function collectPrimitiveInputValues(
  input: unknown,
  path: string[] = [],
  seen = new WeakSet<object>(),
): PrimitiveInputValue[] {
  if (path.length === 0 && (input === null || input === undefined)) return []
  if (
    typeof input === 'string' ||
    typeof input === 'number' ||
    typeof input === 'boolean' ||
    typeof input === 'bigint'
  ) {
    return path.length > 0 ? [{ source: path.join('.'), value: String(input) }] : []
  }
  if (input instanceof Date) {
    return path.length > 0 ? [{ source: path.join('.'), value: input.toISOString() }] : []
  }
  if (input === null || typeof input !== 'object') return []
  if (seen.has(input)) return []
  seen.add(input)

  const out: PrimitiveInputValue[] = []
  if (Array.isArray(input)) {
    input.forEach((value, index) => out.push(...collectPrimitiveInputValues(value, [...path, String(index)], seen)))
    return out
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out.push(...collectPrimitiveInputValues(value, [...path, key], seen))
  }
  return out
}

function segmentsToSystemContent(segments: readonly ContextTextSegment[]): ResolvedSystemContent {
  const normalized = segments
    .filter((segment) => segment.text.length > 0)
    .map((segment) => ({
      text: segment.text,
      dynamic: segment.dynamic,
      ...(segment.source ? { source: segment.source } : {}),
    }))
  const text = normalized.map((segment) => segment.text).join('')
  const staticTokens = normalized
    .filter((segment) => !segment.dynamic)
    .reduce((total, segment) => total + countTokens(segment.text), 0)
  const dynamicTokens = normalized
    .filter((segment) => segment.dynamic)
    .reduce((total, segment) => total + countTokens(segment.text), 0)
  return {
    text,
    ...(normalized.length > 0 ? { segments: normalized } : {}),
    ...(normalized.length > 0 ? { staticTokens, dynamicTokens } : {}),
  }
}

async function resolveSystemContent<T>(
  value:
    | string
    | ContextSystemContent
    | ((arg: { input: T }) => ContextSystemResult | Promise<ContextSystemResult>)
    | undefined,
  input: T,
): Promise<ResolvedSystemContent> {
  if (value === undefined) return { text: '' }
  if (typeof value === 'string') return normalizeSystemContent(value, false)
  if (isContextSystemContent(value)) return normalizeSystemContent(value, false)
  const result = await value({ input })
  return normalizeSystemContent(result, true, 'Prompt system/context function', input)
}

function inputForSourceKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (keys.length === 0) return undefined
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in input) picked[key] = input[key]
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

// ─────────────────────────────────────────────────────────────────
// Adapter Selection
// ─────────────────────────────────────────────────────────────────

function selectAdaptation(adapt: AdapterMap | undefined, modelInfo: ModelInfo): PromptAdaptation | undefined {
  if (!adapt) return undefined

  const { provider, modelId } = modelInfo

  // 1. Exact provider match
  if (provider && adapt[provider]) {
    return adapt[provider]
  }

  // 2. OpenRouter / slash-prefixed modelId (e.g. "openai/gpt-4o" → "openai")
  const slashIdx = modelId.indexOf('/')
  if (slashIdx > 0) {
    const prefix = modelId.slice(0, slashIdx)
    if (adapt[prefix]) {
      return adapt[prefix]
    }
  }

  // 3. Wildcard fallback
  return adapt['*']
}

// ─────────────────────────────────────────────────────────────────
// Input Schema Compilation
// ─────────────────────────────────────────────────────────────────

function compileInputSchema(entries: readonly ContextEntry[], ownInput: z.ZodType | undefined): z.ZodType | undefined {
  const seenKeys = new Map<string, string>() // key → context id/index
  let mergedShape: Record<string, z.ZodType> = {}

  const contributions = collectSchemaContributions(entries)

  for (let i = 0; i < contributions.length; i++) {
    const { id, schema, optional } = contributions[i]
    if (!schema) continue

    const shape = schema instanceof z.ZodObject ? schema.shape : undefined
    if (!shape || typeof shape !== 'object') continue

    for (const key of Object.keys(shape)) {
      const source = id ?? `context[${i}]`
      const existing = seenKeys.get(key)
      if (existing) {
        throw new Error(
          `Input key "${key}" is defined by both "${existing}" and "${source}". ` +
            `Context input keys must not overlap.`,
        )
      }
      seenKeys.set(key, source)
      // Conditionally included entries get their keys wrapped as optional
      mergedShape[key] = optional ? shape[key].optional() : shape[key]
    }
  }

  // Prompt's own fields take precedence over context fields
  if (ownInput) {
    const ownShape = ownInput instanceof z.ZodObject ? ownInput.shape : undefined
    if (ownShape && typeof ownShape === 'object') {
      mergedShape = { ...mergedShape, ...ownShape }
    }
  }

  if (Object.keys(mergedShape).length === 0) return undefined
  return z.object(mergedShape)
}

// ─────────────────────────────────────────────────────────────────
// System Message Composition
// ─────────────────────────────────────────────────────────────────

/** Internal representation of a resolved context contribution. */
interface ResolvedContextPart {
  source: string
  injectableKind: CruxContextInjectableKind
  text: string
  tokens: number
  priority: number
  index: number // original order in `use` array
  providerCache: boolean // from context's cache option
  injectedTools?: readonly string[]
  segments?: readonly ContextTextSegment[]
  staticTokens?: number
  dynamicTokens?: number
  artifactId?: CruxArtifactId
}

function emitPromptBudgetArtifact(ports: ResolverPorts, preview: CruxPromptBudgetPreview): CruxArtifactId | undefined {
  return ports.observability.artifact(
    {
      kind: 'prompt.budget',
      contentType: 'application/json',
      encoding: 'json',
      preview,
      attributes: {
        budgetUsedTokens: preview.usedTokens,
        budgetTotalTokens: preview.totalTokens,
        droppedContextCount: preview.dropped.length,
      },
    },
    { primitive: 'prompt.budget' },
  )
}

/**
 * Emits the prompt-input observability artifact without serializing input
 * values. The preview is limited to top-level key names and validation status so
 * devtools can compare runtime inputs with effective schemas while preserving
 * the same redaction boundary for successful and failed calls.
 */
function emitPromptInputArtifact(ports: ResolverPorts, preview: CruxPromptInputPreview): CruxArtifactId | undefined {
  return ports.observability.artifact(
    {
      kind: 'input',
      contentType: 'application/json',
      encoding: 'json',
      preview,
      attributes: {
        primitive: 'prompt.input',
        promptId: preview.promptId,
        validationStatus: preview.validationStatus,
        providedKeyCount: preview.providedKeys.length,
        schemaKeyCount: preview.schemaKeys?.length ?? 0,
        requiredKeyCount: preview.requiredKeys?.length ?? 0,
        missingKeyCount: preview.missingKeys?.length ?? 0,
        unexpectedKeyCount: preview.unexpectedKeys?.length ?? 0,
      },
    },
    { primitive: 'prompt.input', validationStatus: preview.validationStatus },
  )
}

/**
 * Builds the redacted prompt-input preview used by runtime validation views.
 *
 * The comparison is intentionally shallow: Crux effective schemas are presented
 * as top-level prompt fields, and nested value inspection would require either
 * raw values or schema-specific traversal. Missing and unexpected keys are
 * therefore computed only at the top level.
 */
function promptInputPreview(
  promptId: string | undefined,
  input: Record<string, unknown>,
  schema: z.ZodType | undefined,
  validationStatus: CruxPromptInputPreview['validationStatus'],
): CruxPromptInputPreview {
  const providedKeys = Object.keys(input).sort()
  if (!schema) {
    return {
      kind: 'prompt.input',
      promptId,
      validationStatus,
      providedKeys,
    }
  }
  const schemaKeys = promptInputSchemaKeys(schema)
  const requiredKeys = promptInputRequiredKeys(schema)
  const provided = new Set(providedKeys)
  const schemaKeySet = new Set(schemaKeys)
  return {
    kind: 'prompt.input',
    promptId,
    validationStatus,
    providedKeys,
    schemaKeys,
    requiredKeys,
    missingKeys: requiredKeys.filter((key) => !provided.has(key)),
    unexpectedKeys: providedKeys.filter((key) => !schemaKeySet.has(key)),
  }
}

/**
 * Returns the top-level keys declared by an object schema, or an empty list for
 * non-object schemas that cannot be compared as prompt input fields.
 */
function promptInputSchemaKeys(schema: z.ZodType): readonly string[] {
  const shape = schema instanceof z.ZodObject ? schema.shape : undefined
  return shape && typeof shape === 'object' ? Object.keys(shape).sort() : []
}

/**
 * Infers required top-level keys using the schema's own `safeParse(undefined)`
 * behavior. This keeps the check aligned with Zod modifiers such as optional,
 * default, nullable, and effects without depending on their internal classes.
 */
function promptInputRequiredKeys(schema: z.ZodType): readonly string[] {
  const shape = schema instanceof z.ZodObject ? schema.shape : undefined
  if (!shape || typeof shape !== 'object') return []
  return Object.entries(shape)
    .filter(([, value]) => !safeParseSchema(value as z.ZodType, undefined).success)
    .map(([key]) => key)
    .sort()
}

async function buildSystemMessage(
  ownSystem: string | ResolvedSystemContent,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
  tokenBudget?: number,
  ports: ResolverPorts = defaultPorts,
): Promise<{
  system: string
  parts: InspectPart[]
  droppedContexts: DroppedContext[]
  blocks: SystemBlock[]
  promptBudgetArtifactId?: CruxArtifactId
}> {
  const parts: InspectPart[] = []
  const droppedContexts: DroppedContext[] = []
  let promptBudgetArtifactId: CruxArtifactId | undefined

  // Prompt's own system — always included, never dropped
  const ownContent = typeof ownSystem === 'string' ? normalizeSystemContent(ownSystem, false) : ownSystem
  const ownTokens = ownContent.text ? countTokens(ownContent.text) : 0
  parts.push({
    source: 'prompt',
    text: ownContent.text,
    tokens: ownTokens,
    skipped: !ownContent.text,
    ...(ownContent.segments ? { segments: ownContent.segments } : {}),
    ...(ownContent.staticTokens !== undefined ? { staticTokens: ownContent.staticTokens } : {}),
    ...(ownContent.dynamicTokens !== undefined ? { dynamicTokens: ownContent.dynamicTokens } : {}),
  })

  // Resolve all context contributions (may be async, with optional caching)
  const resolved: ResolvedContextPart[] = []
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i]
    const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`

    let contextArtifactId: CruxArtifactId | undefined
    let injectedTools: readonly string[] | undefined
    const text = await ports.observability.scope(
      {
        name: ctx.id ?? `context[${i}]`,
        family: 'context',
        primitive: 'context.resolve',
        attributes: {
          contextId: ctx.id,
          source,
          priority: ctx.priority,
          cacheTtl: ctx.cacheTtl,
          providerCache: ctx.providerCache,
        },
      },
      async () => {
        // Check resolver cache for contexts with cacheTtl > 0
        let resolvedContent: ResolvedSystemContent
        let cacheStatus: 'hit' | 'miss' | 'disabled' = 'disabled'
        const contextInferenceInput = inputForSourceKeys(input, ctx.inputKeys)
        if (ctx.cacheTtl > 0 && ctx.id) {
          const cacheKey = computeCacheKey(ctx.id, input, ctx.inputKeys)
          const cached = ports.cache.get(cacheKey)
          if (cached !== null) {
            resolvedContent = cached.content
            cacheStatus = 'hit'
            ports.instrumentation.contextCacheHit({
              contextId: ctx.id,
              cacheKey,
              ageMs: cached.ageMs,
            })
          } else {
            const start = ports.clock.now()
            resolvedContent = normalizeSystemContent(
              await ctx.systemFn(input),
              ctx.systemKind !== 'static',
              `Context "${source}" system function`,
              contextInferenceInput,
            )
            cacheStatus = 'miss'
            const resolutionMs = ports.clock.now() - start
            if (resolvedContent.text) {
              ports.cache.set(cacheKey, resolvedContent, ctx.cacheTtl)
            }
            ports.instrumentation.contextCacheMiss({
              contextId: ctx.id,
              cacheKey,
              resolutionMs,
            })
          }
        } else {
          resolvedContent = normalizeSystemContent(
            await ctx.systemFn(input),
            ctx.systemKind !== 'static',
            `Context "${source}" system function`,
            contextInferenceInput,
          )
        }

        if (resolvedContent.text) {
          const tokens = countTokens(resolvedContent.text)
          injectedTools = contextInjectedToolNames(ctx, input)
          const preview = {
            kind: 'context.contribution',
            state: 'active',
            included: true,
            sourceId: source,
            injectableKind: contextContributionKind(ctx),
            injects: contextInjects(ctx),
            injectedTools,
            priority: ctx.priority,
            sizeBytes: resolvedContent.text.length,
            tokens,
            cacheStatus,
            ...(resolvedContent.segments ? { segments: resolvedContent.segments } : {}),
            ...(resolvedContent.staticTokens !== undefined ? { staticTokens: resolvedContent.staticTokens } : {}),
            ...(resolvedContent.dynamicTokens !== undefined ? { dynamicTokens: resolvedContent.dynamicTokens } : {}),
            text: resolvedContent.text,
          } satisfies CruxContextContributionPreview
          contextArtifactId = ports.observability.artifact(
            {
              kind: 'context.contribution',
              contentType: 'application/json',
              encoding: 'json',
              sizeBytes: resolvedContent.text.length,
              preview,
              attributes: {
                contextId: ctx.id,
                source,
                tokens,
                cacheStatus,
              },
            },
            { source },
          )
        }

        return resolvedContent
      },
    )

    if (!text.text) {
      parts.push({ source, text: '', tokens: 0, skipped: true })
      continue
    }

    const tokens = countTokens(text.text)
    resolved.push({
      source,
      injectableKind: contextContributionKind(ctx),
      text: text.text,
      tokens,
      priority: ctx.priority,
      index: i,
      providerCache: ctx.providerCache,
      ...(injectedTools ? { injectedTools } : {}),
      ...(text.segments ? { segments: text.segments } : {}),
      ...(text.staticTokens !== undefined ? { staticTokens: text.staticTokens } : {}),
      ...(text.dynamicTokens !== undefined ? { dynamicTokens: text.dynamicTokens } : {}),
      ...(contextArtifactId ? { artifactId: contextArtifactId } : {}),
    })
  }

  // If no token budget, include everything
  if (tokenBudget === undefined) {
    for (const r of resolved) {
      parts.push({
        source: r.source,
        text: r.text,
        tokens: r.tokens,
        skipped: false,
        ...(r.segments ? { segments: r.segments } : {}),
        ...(r.staticTokens !== undefined ? { staticTokens: r.staticTokens } : {}),
        ...(r.dynamicTokens !== undefined ? { dynamicTokens: r.dynamicTokens } : {}),
      })
    }
  } else {
    // Token-aware: drop lowest-priority contexts until we fit
    let remainingBudget = tokenBudget - ownTokens
    // Add separator tokens between parts (each \n\n is ~1 token)
    const separatorTokens = ownContent.text ? 1 : 0

    // Sort by priority ascending (lowest priority = dropped first)
    const sortedByPriority = [...resolved].sort((a, b) => a.priority - b.priority)

    // Calculate total needed
    let totalNeeded = resolved.reduce((sum, r) => sum + r.tokens, 0)
    // Approximate separator tokens between context parts
    const contextSeparators = resolved.length > 0 ? resolved.length - 1 + separatorTokens : 0
    totalNeeded += contextSeparators

    // Drop lowest-priority contexts until we fit
    const droppedIndices = new Set<number>()
    if (totalNeeded > remainingBudget) {
      for (const r of sortedByPriority) {
        if (totalNeeded <= remainingBudget) break
        totalNeeded -= r.tokens + 1 // remove part + one separator
        droppedIndices.add(r.index)
        droppedContexts.push({
          source: r.source,
          injectableKind: r.injectableKind,
          text: r.text,
          tokens: r.tokens,
          priority: r.priority,
          ...(r.injectedTools ? { injectedTools: r.injectedTools } : {}),
          ...(r.segments ? { segments: r.segments } : {}),
          ...(r.staticTokens !== undefined ? { staticTokens: r.staticTokens } : {}),
          ...(r.dynamicTokens !== undefined ? { dynamicTokens: r.dynamicTokens } : {}),
        })
      }
    }

    // Add non-dropped parts in original order
    for (const r of resolved) {
      if (droppedIndices.has(r.index)) {
        parts.push({
          source: r.source,
          text: r.text,
          tokens: r.tokens,
          skipped: true,
          ...(r.segments ? { segments: r.segments } : {}),
          ...(r.staticTokens !== undefined ? { staticTokens: r.staticTokens } : {}),
          ...(r.dynamicTokens !== undefined ? { dynamicTokens: r.dynamicTokens } : {}),
        })
      } else {
        parts.push({
          source: r.source,
          text: r.text,
          tokens: r.tokens,
          skipped: false,
          ...(r.segments ? { segments: r.segments } : {}),
          ...(r.staticTokens !== undefined ? { staticTokens: r.staticTokens } : {}),
          ...(r.dynamicTokens !== undefined ? { dynamicTokens: r.dynamicTokens } : {}),
        })
      }
    }
  }

  if (tokenBudget !== undefined) {
    const usedTokens = parts.reduce((sum, part) => (part.skipped ? sum : sum + part.tokens), 0)
    const dropped = droppedContexts.map(
      (ctx) =>
        ({
          kind: 'context.contribution',
          state: 'dropped-budget',
          included: false,
          sourceId: ctx.source,
          injectableKind: ctx.injectableKind ?? 'context',
          reason: 'token budget',
          priority: ctx.priority,
          sizeBytes: ctx.text.length,
          tokens: ctx.tokens,
          ...(ctx.injectedTools ? { injectedTools: ctx.injectedTools } : {}),
          ...(ctx.segments ? { segments: ctx.segments } : {}),
          ...(ctx.staticTokens !== undefined ? { staticTokens: ctx.staticTokens } : {}),
          ...(ctx.dynamicTokens !== undefined ? { dynamicTokens: ctx.dynamicTokens } : {}),
          text: ctx.text,
        }) satisfies CruxContextContributionPreview,
    )
    promptBudgetArtifactId = emitPromptBudgetArtifact(ports, {
      kind: 'prompt.budget',
      usedTokens,
      totalTokens: tokenBudget,
      dropped,
    })
  }

  // Assemble the final system string from non-skipped parts
  const includedTexts: string[] = []
  for (const part of parts) {
    if (!part.skipped && part.text) {
      includedTexts.push(part.text)
    }
  }
  const system = includedTexts.join('\n\n')

  // Safety net: detect [object Object] in the final assembled text
  if (system.includes('[object Object]')) {
    // Find which part contains it
    const culprit = parts.find((p) => p.text.includes('[object Object]'))
    throw new Error(
      `Assembled system message contains "[object Object]" — an object was interpolated ` +
        `into a string instead of being serialized. ` +
        (culprit ? `Source: ${culprit.source}. ` : '') +
        `Check your system/prompt functions for unserialised objects (use JSON.stringify() or String()).`,
    )
  }

  // Build structured blocks from non-skipped parts
  const blocks: SystemBlock[] = []
  for (const part of parts) {
    if (!part.skipped && part.text) {
      // Look up providerCache from the resolved context part
      const resolvedPart = resolved.find((r) => r.source === part.source)
      blocks.push({
        source: part.source,
        text: part.text,
        providerCache: resolvedPart?.providerCache ?? false,
        ...(resolvedPart?.artifactId ? { artifactId: resolvedPart.artifactId } : {}),
        ...(part.segments ? { segments: part.segments } : {}),
        ...(part.staticTokens !== undefined ? { staticTokens: part.staticTokens } : {}),
        ...(part.dynamicTokens !== undefined ? { dynamicTokens: part.dynamicTokens } : {}),
      })
    }
  }

  return {
    system,
    parts,
    droppedContexts,
    blocks,
    ...(promptBudgetArtifactId ? { promptBudgetArtifactId } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────
// Runtime Surface Collection
// ─────────────────────────────────────────────────────────────────

function collectActiveContextTools(
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
): AnyToolSet {
  const tools: AnyToolSet = {}
  for (const ctx of contexts) {
    if (ctx.toolsFn) {
      Object.assign(tools, ctx.toolsFn(input))
    }
  }
  return tools
}

function collectBlackboardTools(blackboards: readonly BlackboardEntry[], existingTools: AnyToolSet = {}): AnyToolSet {
  const tools: AnyToolSet = {}
  const existingNames = new Set(Object.keys(existingTools))

  for (const board of blackboards) {
    const boardTools = board.asTools()
    for (const [name, tool] of Object.entries(boardTools)) {
      if (name in tools || existingNames.has(name)) {
        throw new Error(
          `Blackboard tool name collision for "${name}". ` +
            `Blackboard "${board.id}" generated a tool name that already exists. ` +
            `Configure a tool prefix, e.g. blackboard({ id: "${board.id}", ..., tools: { prefix: "${board.id}" } }).`,
        )
      }
      tools[name] = tool
    }
  }

  return tools
}

function collectContextConstraints(contexts: readonly Context<z.ZodType>[]): Constraint[] {
  const result: Constraint[] = []
  for (const ctx of contexts) {
    if (ctx.constraints && ctx.constraints.length > 0) {
      result.push(...ctx.constraints)
    }
  }
  return result
}

function collectContextGuardrails(contexts: readonly Context<z.ZodType>[]): Guardrail[] {
  const result: Guardrail[] = []
  for (const ctx of contexts) {
    if (ctx.guardrails && ctx.guardrails.length > 0) {
      result.push(...ctx.guardrails)
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────
// Settings Merging
// ─────────────────────────────────────────────────────────────────

/**
 * Merge generation settings with last-write-wins semantics.
 * Only explicitly set fields (not `undefined`) are applied.
 */
function mergeSettings(...sources: (GenerationSettings | undefined)[]): GenerationSettings {
  const result: Record<string, unknown> = {}
  for (const source of sources) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = value
    }
  }
  return result as GenerationSettings
}

// ─────────────────────────────────────────────────────────────────
// Compiled Prompt API
// ─────────────────────────────────────────────────────────────────

/** Options accepted by compiled prompt resolution and inspection. */
export interface ResolveCallOptions extends GenerationSettings {
  input?: Record<string, unknown>
  provider?: string
  modelId?: string
  tokenBudget?: number
}

/** The result of one prompt-resolution pass. */
export interface Resolution {
  /** SDK-agnostic generation args — what adapters ship to the provider. */
  readonly args: ResolvedPrompt
  /** Structured inspection view derived from this pass without re-running resolution. */
  inspect(): InspectResult
}

/** A prompt config compiled once: schema merge, validation, and ports binding. */
export interface CompiledPrompt {
  /** Merged input schema (own + context contributions), or undefined when no fields exist. */
  readonly inputSchema: z.ZodType | undefined
  /** Hot path: one full pipeline pass with normal observability emission. */
  resolve(opts?: ResolveCallOptions): Promise<Resolution>
  /** Debug path: one quiet pipeline pass with today's inspect semantics. */
  inspect(opts?: ResolveCallOptions): Promise<InspectResult>
}

export interface CompilePromptOptions {
  readonly ports?: Partial<ResolverPorts>
}

type ResolutionEmissionMode = 'resolve' | 'inspect'

interface PromptResolutionPass {
  readonly args: ResolvedPrompt
  readonly inspection: InspectResult
}

interface PostMergeSurface {
  readonly contexts: Context<z.ZodType>[]
  readonly excluded: ExcludedContext[]
  readonly skills: SkillEntry[]
  readonly memories: MemoryEntry[]
  readonly blackboards: BlackboardEntry[]
  readonly injectedTools: AnyToolSet
  readonly injectedConstraints: Constraint[]
  readonly injectedGuardrails: Guardrail[]
  readonly injectedMetadata: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────
// Input Guard — prevent [object Object] in prompts
// ─────────────────────────────────────────────────────────────────

/**
 * Get the first key of an object for error message suggestions.
 */
function firstKey(obj: object): string {
  const keys = Object.keys(obj)
  return keys[0] ?? 'someProperty'
}

/**
 * Wrap object input values in Proxy to catch string interpolation.
 *
 * Normal property access (`input.config.tone`) passes through unchanged.
 * String coercion (`${input.config}`) triggers the Proxy and throws
 * a clear error with the field name and prompt ID.
 *
 * This catches `[object Object]` at the exact interpolation point,
 * before the string is assembled — proactive, not reactive.
 */
function guardInputs(input: Record<string, unknown>, promptId?: string): Record<string, unknown> {
  const guarded: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof RegExp)
    ) {
      guarded[key] = new Proxy(value as object, {
        get(target, prop, receiver) {
          if (prop === Symbol.toPrimitive) {
            return () => {
              throw new Error(
                `Input field "${key}" is an object and cannot be interpolated into a string. ` +
                  `Use JSON.stringify(input.${key}) or access a specific property ` +
                  `(e.g., input.${key}.${firstKey(target)}).` +
                  (promptId ? ` Prompt: "${promptId}".` : ''),
              )
            }
          }
          if (prop === 'toString') {
            // Check if calling default Object.prototype.toString (which produces [object Object])
            const original = Reflect.get(target, prop, receiver)
            if (original === Object.prototype.toString) {
              return () => {
                throw new Error(
                  `Input field "${key}" is an object and was coerced to string. ` +
                    `Use JSON.stringify(input.${key}) or access specific properties.` +
                    (promptId ? ` Prompt: "${promptId}".` : ''),
                )
              }
            }
            // Custom toString (e.g., Date, custom classes) — let through
            return original
          }
          return Reflect.get(target, prop, receiver)
        },
      })
    } else {
      guarded[key] = value
    }
  }
  return guarded
}

// ─────────────────────────────────────────────────────────────────
// Internal Resolution Pass
// ─────────────────────────────────────────────────────────────────

function validatePromptConfig(config: AnyPromptConfig): void {
  if (config.messages && (config.system || config.prompt)) {
    throw new Error(
      'prompt: "messages" is mutually exclusive with "system" and "prompt". ' +
        'Use either messages mode or system+prompt mode, not both.',
    )
  }
}

async function resolvePostMergeSurface(
  merged: MergedResolution,
  input: Record<string, unknown>,
  ports: ResolverPorts,
): Promise<PostMergeSurface> {
  const contexts = [...merged.active]
  let skills = [...merged.skills]

  // Cross-entry collectors live here so every projection of a pass gets the
  // same post-merge skill surface by construction.
  if (skills.length > 0) {
    const surface = await resolveSkillSurface(skills, input, ports)
    skills = surface.skills
    contexts.unshift(surface.indexContext)
    contexts.push(...surface.loadedContexts)
  }

  return {
    contexts,
    excluded: merged.excluded,
    skills,
    memories: merged.memories,
    blackboards: merged.blackboards,
    injectedTools: merged.tools,
    injectedConstraints: merged.constraints,
    injectedGuardrails: merged.guardrails,
    injectedMetadata: merged.metadata,
  }
}

async function runPromptResolvePass(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
  ports: ResolverPorts,
): Promise<PromptResolutionPass> {
  validatePromptConfig(config)
  return ports.observability.scope(
    {
      name: config.id ?? 'prompt.resolve',
      family: 'prompt',
      primitive: 'prompt.resolve',
      attributes: {
        promptId: config.id,
        contextEntryCount: (config.use ?? []).length,
        hasMessages: !!config.messages,
        hasOutput: !!config.output,
      },
    },
    async () => runPromptPass(config, opts, mergedSchema, ports, 'resolve'),
  )
}

async function runPromptPass(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
  ports: ResolverPorts,
  mode: ResolutionEmissionMode,
): Promise<PromptResolutionPass> {
  let input = opts.input ?? {}

  // 1. Validate input
  if (mergedSchema) {
    const parseResult = safeParseSchema(mergedSchema, input)
    if (!parseResult.success) {
      if (mode === 'resolve') {
        emitPromptInputArtifact(ports, promptInputPreview(config.id, input, mergedSchema, 'failed'))
      }
      throw new Error(`Input validation failed: ${JSON.stringify(parseResult.error?.issues ?? parseResult.error)}`)
    }
    if (mode === 'resolve') {
      emitPromptInputArtifact(ports, promptInputPreview(config.id, input, mergedSchema, 'passed'))
    }
  } else if (mode === 'resolve') {
    emitPromptInputArtifact(ports, promptInputPreview(config.id, input, undefined, 'not-configured'))
  }

  const entries: readonly ContextEntry[] = config.use ?? []

  // 1a. Resolve context entries through the contributor driver
  // (gates, match branches, nested entries, injectables — see resolver/driver.ts)
  const mergedUse = await resolveUse(entries, input as Record<string, unknown>, config.id, ports)
  const postMerge = await resolvePostMergeSurface(mergedUse, input, ports)

  // 1b. Auto-escape string inputs (after validation, before system/prompt)
  if (ports.policy().autoEscape) {
    const rawFieldSet = new Set<string>([
      ...(config.rawFields ?? []),
      ...postMerge.contexts.flatMap((ctx) => ctx.rawFields ?? []),
    ])

    const sanitizedInput: Record<string, unknown> = { ...input }
    for (const [key, value] of Object.entries(sanitizedInput)) {
      if (typeof value === 'string' && !rawFieldSet.has(key)) {
        sanitizedInput[key] = escapeXml(value)
      }
    }
    input = sanitizedInput
  }

  // 1c. Run custom sanitize hook (after auto-escape)
  if (config.sanitize) {
    input = config.sanitize(input as never) as Record<string, unknown>
  }

  // 1d. Dev-mode security warnings
  if (mode === 'resolve' && ports.policy().securityWarnings) {
    for (const [key, value] of Object.entries(opts.input ?? {})) {
      if (typeof value === 'string') {
        const warnings = detectSuspiciousPatterns(value, key)
        for (const w of warnings) {
          ports.diagnostics.warn(`[@crux/core] ${w.message}`)
          emitSecurityWarningSpan({
            promptId: config.id ?? 'unknown',
            field: key,
            pattern: w.pattern,
            message: w.message,
            inputPreview: value.slice(0, 200),
          })
        }
      }
    }
  }

  // 1e. Guard object inputs — Proxy wraps objects to throw on string interpolation
  const guardedInput = guardInputs(input as Record<string, unknown>, config.id)

  // 2. Compose system message (token-aware)
  const ownSystem = await resolveSystemContent(config.system, guardedInput)
  const composed = await buildSystemMessage(ownSystem, postMerge.contexts, guardedInput, opts.tokenBudget, ports)
  let system = composed.system
  const systemBlocks = composed.blocks

  // 3. Resolve prompt or messages
  let promptText: string | undefined
  let messages: AnyMessage[] | undefined

  if (config.messages) {
    messages = (config.messages as (arg: { input: Record<string, unknown> }) => AnyMessage[])({ input: guardedInput })

    // Safety net: detect [object Object] in message content
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : ''
      if (content.includes('[object Object]')) {
        throw new Error(
          `Message content contains "[object Object]" — an object was interpolated into a ` +
            `string instead of being serialized. Check your messages function for unserialised objects.`,
        )
      }
    }

    // Inject context system text into messages: prepend to first system message,
    // or insert a new system message at the start
    if (system) {
      const firstSystemIdx = messages.findIndex((m) => m.role === 'system')
      if (firstSystemIdx >= 0) {
        const first = messages[firstSystemIdx]!
        const firstContent = typeof first.content === 'string' ? first.content : String(first.content)
        messages = [...messages]
        messages[firstSystemIdx] = {
          ...first,
          content: system + '\n\n' + firstContent,
        }
      } else {
        messages = [{ role: 'system' as const, content: system }, ...messages]
      }
      system = '' // already incorporated into messages
    }
  } else {
    promptText = await renderPromptText(config.prompt, guardedInput)
  }

  const promptInfo = promptText ? { text: promptText, tokens: countTokens(promptText) } : undefined

  // Safety net: detect [object Object] in prompt text
  if (promptText && promptText.includes('[object Object]')) {
    // Find the position for context
    const idx = promptText.indexOf('[object Object]')
    const snippet = promptText.slice(Math.max(0, idx - 80), idx + 80)
    throw new Error(
      `Prompt text contains "[object Object]" — an object was interpolated into a string ` +
        `instead of being serialized.` +
        (config.id ? ` Prompt: "${config.id}".` : '') +
        ` Context: "...${snippet}..."`,
    )
  }

  // 4. Apply provider-specific adaptation
  const modelInfo: ModelInfo = {
    provider: opts.provider ?? '',
    modelId: opts.modelId ?? '',
  }
  const adaptation = selectAdaptation(config.adapt, modelInfo)
  if (adaptation) {
    if (adaptation.prependSystem) {
      system = adaptation.prependSystem + '\n\n' + system
    }
    if (adaptation.appendSystem) {
      system = system + '\n\n' + adaptation.appendSystem
    }
    if (promptText !== undefined) {
      if (adaptation.prependPrompt) {
        promptText = adaptation.prependPrompt + promptText
      }
      if (adaptation.appendPrompt) {
        promptText = promptText + adaptation.appendPrompt
      }
    }
  }

  // 5. Merge settings: config.settings < adaptation.settings < callOptions
  const { input: _input, provider: _provider, modelId: _modelId, tokenBudget: _tokenBudget, ...callSettings } = opts
  void _input
  void _provider
  void _modelId
  void _tokenBudget
  const settings = mergeSettings(config.settings, adaptation?.settings, callSettings)

  // 6. Collect and merge tools
  const resolved: ResolvedPrompt = {
    ...(system ? { system } : {}),
    ...(systemBlocks.length > 0 ? { systemBlocks } : {}),
    ...(composed.promptBudgetArtifactId ? { promptBudgetArtifactId: composed.promptBudgetArtifactId } : {}),
    ...(promptText ? { prompt: promptText } : {}),
    ...(messages ? { messages } : {}),
    ...(config.output ? { schema: config.output } : {}),
    settings,
  }

  const contextTools = collectActiveContextTools(postMerge.contexts, input)
  const configTools = config.tools

  // Inject skill tools (LoadSkill + LoadReference) when skills are present
  let skillTools: AnyToolSet = {}
  let skillSession: unknown
  if (mode === 'resolve' && postMerge.skills.length > 0) {
    const toolSurface = createSkillToolSurface(postMerge.skills, input)
    skillTools = toolSurface.tools
    skillSession = toolSurface.session
  }

  const blackboardExistingTools =
    mode === 'resolve'
      ? {
          ...skillTools,
          ...contextTools,
          ...(configTools ?? {}),
        }
      : {
          ...contextTools,
          ...(configTools ?? {}),
        }

  const blackboardTools = collectBlackboardTools(postMerge.blackboards, blackboardExistingTools)

  if (skillSession !== undefined) {
    // Attach the session handle as the explicit skill activation boundary.
    ;(resolved as ResolvedPrompt & { _skillSession?: unknown })._skillSession = skillSession
  }

  const merged = {
    ...skillTools,
    ...contextTools,
    ...postMerge.injectedTools,
    ...blackboardTools,
    ...configTools,
  }

  if (Object.keys(merged).length > 0) resolved.tools = merged
  if (config.toolMiddleware !== undefined) resolved.toolMiddleware = config.toolMiddleware

  if (config.toolChoice !== undefined) resolved.toolChoice = config.toolChoice
  if (config.stopWhen !== undefined) resolved.stopWhen = config.stopWhen

  // ── Collect constraints from contexts + prompt config ──
  const contextConstraints = collectContextConstraints(postMerge.contexts)
  const promptConstraints = config.constraints ?? []
  const allConstraints = [...postMerge.injectedConstraints, ...contextConstraints, ...promptConstraints]
  if (allConstraints.length > 0) {
    resolved.constraints = allConstraints
  }

  // ── Collect guardrails from contexts + prompt config ──
  const contextGuardrails = collectContextGuardrails(postMerge.contexts)
  const promptGuardrails = config.guardrails ?? []
  const allGuardrails = [...postMerge.injectedGuardrails, ...contextGuardrails, ...promptGuardrails]
  if (allGuardrails.length > 0) {
    resolved.guardrails = allGuardrails
  }

  if (Object.keys(postMerge.injectedMetadata).length > 0) {
    resolved.metadata = postMerge.injectedMetadata
  }

  if (postMerge.memories.length > 0) {
    resolved.memoryBindings = postMerge.memories.map((memory) => ({
      memory,
      input: input as Record<string, unknown>,
      promptId: config.id,
    }))
  }

  const systemTokens = composed.system ? countTokens(composed.system) : 0
  const promptTokens = promptInfo?.tokens ?? 0
  const skillToolNames = postMerge.skills.length > 0 ? [LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME] : []
  const inspectTools = { ...contextTools, ...postMerge.injectedTools, ...blackboardTools, ...configTools }
  const toolNames = [...skillToolNames, ...Object.keys(inspectTools)]

  return {
    args: resolved,
    inspection: {
      system: {
        total: composed.system,
        parts: composed.parts,
        totalTokens: systemTokens,
      },
      prompt: promptInfo,
      totalTokens: systemTokens + promptTokens,
      droppedContexts: composed.droppedContexts,
      excludedContexts: postMerge.excluded,
      tokenBudget: opts.tokenBudget,
      tools: toolNames.length > 0 ? toolNames : undefined,
    },
  }
}

function emitSecurityWarningSpan(input: {
  promptId: string
  field: string
  pattern: string
  message: string
  inputPreview: string
}): void {
  const span = observe.openSpan({
    name: 'security.warning',
    family: 'security',
    primitive: 'security.warning',
    attributes: {
      promptId: input.promptId,
      field: input.field,
      pattern: input.pattern,
      inputPreview: input.inputPreview,
    },
  })
  span.withContext(() => {
    const artifactId = observe.artifact({
      kind: 'security.report',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        kind: 'security.report',
        severity: 'warn',
        promptId: input.promptId,
        field: input.field,
        pattern: input.pattern,
        location: input.field,
        action: 'warn',
        message: input.message,
        preview: input.inputPreview,
      },
      attributes: {
        primitive: 'security.warning',
        promptId: input.promptId,
        field: input.field,
        pattern: input.pattern,
      },
    })
    if (!artifactId) return
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: span.spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { primitive: 'security.warning', pattern: input.pattern },
    })
  })
  span.end({
    promptId: input.promptId,
    field: input.field,
    pattern: input.pattern,
  })
}

// ─────────────────────────────────────────────────────────────────
// Prompt Compiler
// ─────────────────────────────────────────────────────────────────

function createResolution(pass: PromptResolutionPass): Resolution {
  let inspection: InspectResult | undefined
  return Object.freeze({
    args: pass.args,
    inspect() {
      inspection ??= pass.inspection
      return inspection
    },
  })
}

/**
 * Compile a prompt config into the single public resolution boundary.
 *
 * Definition-time work happens once: config validation, input-schema merging,
 * conflict detection, and resolver port binding. Each call to `resolve()` or
 * `inspect()` then runs one pipeline pass and returns the requested projection.
 */
export function compilePrompt(config: AnyPromptConfig, options?: CompilePromptOptions): CompiledPrompt {
  validatePromptConfig(config)
  const inputSchema = compileInputSchema(config.use ?? [], config.input)
  const ports = withDefaultResolverPorts(options?.ports)

  return Object.freeze({
    inputSchema,
    async resolve(opts: ResolveCallOptions = {}) {
      const pass = await runPromptResolvePass(config, opts, inputSchema, ports)
      return createResolution(pass)
    },
    async inspect(opts: ResolveCallOptions = {}) {
      const pass = await runPromptPass(config, opts, inputSchema, ports, 'inspect')
      return pass.inspection
    },
  })
}
