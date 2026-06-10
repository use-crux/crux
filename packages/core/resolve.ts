/**
 * Pure resolution functions for the prompt pipeline.
 *
 * This module handles the core pipeline that transforms a `PromptConfig` +
 * `ResolveOptions` into a `ResolvedPrompt` ready for any SDK adapter. It includes:
 *
 * - String/function resolution for dynamic system/prompt fields
 * - Provider-specific adaptation matching
 * - Input schema merging with conflict detection
 * - System message composition (prompt's own + contexts in order)
 * - Settings merging with last-write-wins priority
 *
 * @module
 */

import { z } from 'zod'
import type {
  AnyToolSet,
  Context,
  ContextEntry,
  BlackboardEntry,
  ConditionalContext,
  MemoryEntry,
  MatchSpec,
  SkillEntry,
  PromptConfig,
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
  InjectableEntry,
  PromptInjection,
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
import { isInjectableEntry } from './injectable'
import { generateIndex } from './skill/project-index'
import {
  LOAD_SKILL_TOOL_NAME,
  LOAD_REFERENCE_TOOL_NAME,
  createSkillState,
  createLoadSkillTool,
  createLoadReferenceTool,
} from './skill/tools'
import { registerSkillState, getLatestSkillState } from './skill/state'
import { resolveRegistrySkill } from './skill/registry'
import type { Skill } from './skill/types'
import { countTokens } from './tokenizer'
import { isAutoEscapeEnabled, isSecurityWarningsEnabled } from './configure'
import { escapeXml, detectSuspiciousPatterns } from './sanitize'
import { getRuntime } from './runtime'
import { observe } from './observability'

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

/** Read activated skill identifiers passed in via the `_crux_activeSkills` input field. */
function readActiveSkillIds(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return []
  const value = (input as Record<string, unknown>)._crux_activeSkills
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

// ─────────────────────────────────────────────────────────────────
// Context Resolver Cache
// ─────────────────────────────────────────────────────────────────

/** Internal cache entry for a resolved context system contribution. */
interface ContextCacheEntry {
  content: ResolvedSystemContent
  expiresAt: number
}

/**
 * Module-level cache for context resolver outputs.
 * Key: `cache:ctx:{contextId}:{inputHash}`
 * Value: { content, expiresAt }
 *
 * Uses a simple Map for v1. Can be replaced with CruxStore in the future.
 */
const contextResolverCache = new Map<string, ContextCacheEntry>()

/**
 * Compute a stable cache key from context id and relevant input fields.
 * Only includes keys declared in the context's inputSchema.
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

/**
 * Check the cache for a context resolver result.
 * Returns the cached content if found and not expired, null otherwise.
 */
function getCachedContent(key: string): ResolvedSystemContent | null {
  const entry = contextResolverCache.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    contextResolverCache.delete(key)
    return null
  }
  return entry.content
}

/**
 * Store resolved content in the cache with TTL.
 */
function setCachedContent(key: string, content: ResolvedSystemContent, ttl: number): void {
  contextResolverCache.set(key, { content, expiresAt: Date.now() + ttl })
}

// ─────────────────────────────────────────────────────────────────
// String / Function Resolution
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve a value that is either a static string, a (sync or async) function of input, or undefined.
 *
 * @param value - Static string, dynamic function (sync or async), or undefined.
 * @param input - The resolved input object passed to dynamic functions.
 * @returns The resolved string, or `''` if undefined.
 */
export async function resolveStringOrFn<T>(
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

interface ResolvedSystemContent {
  text: string
  segments?: readonly ContextTextSegment[]
  staticTokens?: number
  dynamicTokens?: number
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
  for (const match of matches.sort((left, right) => left.start - right.start || right.value.length - left.value.length)) {
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

function collectPrimitiveInputValues(input: unknown, path: string[] = [], seen = new WeakSet<object>()): PrimitiveInputValue[] {
  if (path.length === 0 && (input === null || input === undefined)) return []
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
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

export async function resolveSystemContentOrFn<T>(
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

function inputForSourceKeys(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | undefined {
  if (keys.length === 0) return undefined
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in input) picked[key] = input[key]
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

// ─────────────────────────────────────────────────────────────────
// Adapter Resolution
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve which provider adaptation to apply based on model info.
 *
 * Resolution priority:
 * 1. Exact `provider` match (e.g. `"anthropic"`)
 * 2. `modelId` prefix before `/` (handles OpenRouter: `"openai/gpt-4o"` → `"openai"`)
 * 3. Wildcard `'*'` fallback
 *
 * @param adapt - The adapter map from the prompt config, or undefined.
 * @param modelInfo - The extracted model info with provider and modelId.
 * @returns The matching adaptation, or `undefined` if no match.
 */
export function resolveAdaptation(adapt: AdapterMap | undefined, modelInfo: ModelInfo): PromptAdaptation | undefined {
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
// Flatten Context Entries
// ─────────────────────────────────────────────────────────────────

/**
 * Flatten a `ContextEntry[]` into active `Context[]` and excluded entries.
 *
 * Runs BEFORE `composeSystem()` — the rest of the pipeline sees plain `Context[]`.
 *
 * Processing order:
 * 1. Filter falsy entries (`false`, `null`, `undefined`)
 * 2. Evaluate context-level `when` predicates
 * 3. Evaluate `ConditionalContext` wrapper predicates
 * 4. Evaluate `MatchSpec` discriminators and select matching branches
 * 5. Plain contexts pass through unchanged
 */
export function flattenContextEntries(
  entries: readonly ContextEntry[],
  input: Record<string, unknown>,
): {
  active: Context<z.ZodType>[]
  excluded: ExcludedContext[]
  skills: SkillEntry[]
  memories: MemoryEntry[]
  blackboards: BlackboardEntry[]
  injectables: InjectableEntry[]
} {
  const active: Context<z.ZodType>[] = []
  const excluded: ExcludedContext[] = []
  const skills: SkillEntry[] = []
  const memories: MemoryEntry[] = []
  const blackboards: BlackboardEntry[] = []
  const injectables: InjectableEntry[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // 1. Filter falsy entries
    if (!entry) continue

    if (isInjectableEntry(entry)) {
      injectables.push(entry)
      continue
    }

    // 2. Skill — collect for index generation
    if (entry._tag === 'Skill') {
      skills.push(entry as SkillEntry)
      continue
    }

    // 3. Memory — expand into a context and keep lifecycle binding.
    if (entry._tag === 'Memory') {
      const mem = entry as MemoryEntry
      memories.push(mem)
      active.push(mem.asContext())
      continue
    }

    // 4. Blackboard — expand into a context and keep tool binding.
    if (entry._tag === 'Blackboard') {
      const board = entry as BlackboardEntry
      blackboards.push(board)
      active.push(board.asContext())
      continue
    }

    // 5. MatchSpec — evaluate discriminator
    if (entry._tag === 'MatchSpec') {
      const spec = entry as MatchSpec
      const discriminator = spec.on(input)
      const branch = spec.cases[discriminator] ?? spec.default
      if (!branch) {
        excluded.push({
          source: `match[${i}]`,
          reason: `no case for "${discriminator}" and no default`,
        })
        continue
      }
      const branchContexts = Array.isArray(branch) ? branch : [branch]
      for (const ctx of branchContexts) {
        // Check context-level when on matched branch contexts
        if (ctx.when && !ctx.when(input)) {
          const source = ctx.id ? `context:${ctx.id}` : `match[${i}]`
          excluded.push({
            source,
            reason: 'context-level when returned false',
          })
          continue
        }
        active.push(ctx)
      }
      continue
    }

    // 6. ConditionalContext — evaluate wrapper predicate
    if (entry._tag === 'ConditionalContext') {
      const cond = entry as ConditionalContext<Context<z.ZodType>>
      const ctx = cond.context
      if (!cond.predicate(input)) {
        const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`
        excluded.push({ source, reason: 'when() predicate returned false' })
        continue
      }
      // Also check context-level when
      if (ctx.when && !ctx.when(input)) {
        const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`
        excluded.push({ source, reason: 'context-level when returned false' })
        continue
      }
      active.push(ctx)
      continue
    }

    // 7. Plain Context — check context-level when
    const ctx = entry as Context<z.ZodType>
    if (ctx.when && !ctx.when(input)) {
      const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`
      excluded.push({ source, reason: 'context-level when returned false' })
      continue
    }
    if (ctx.useEntries.length > 0) {
      const nested = flattenContextEntries(ctx.useEntries, input)
      active.push(...nested.active)
      excluded.push(...nested.excluded)
      skills.push(...nested.skills)
      memories.push(...nested.memories)
      blackboards.push(...nested.blackboards)
      injectables.push(...nested.injectables)
    }
    active.push(ctx)
  }

  return { active, excluded, skills, memories, blackboards, injectables }
}

async function resolveContextEntries(
  entries: readonly ContextEntry[],
  input: Record<string, unknown>,
  promptId: string | undefined,
): Promise<{
  active: Context<z.ZodType>[]
  excluded: ExcludedContext[]
  skills: SkillEntry[]
  memories: MemoryEntry[]
  blackboards: BlackboardEntry[]
  tools: AnyToolSet
  constraints: Constraint[]
  guardrails: Guardrail[]
  metadata: Record<string, unknown>
}> {
  const active: Context<z.ZodType>[] = []
  const excluded: ExcludedContext[] = []
  const skills: SkillEntry[] = []
  const memories: MemoryEntry[] = []
  const blackboards: BlackboardEntry[] = []
  const tools: AnyToolSet = {}
  const constraints: Constraint[] = []
  const guardrails: Guardrail[] = []
  let metadata: Record<string, unknown> = {}

  function appendNested(nested: Awaited<ReturnType<typeof resolveContextEntries>>, sourceId: string): void {
    active.push(...nested.active)
    excluded.push(...nested.excluded)
    skills.push(...nested.skills)
    memories.push(...nested.memories)
    blackboards.push(...nested.blackboards)

    mergeInjectedTools(tools, nested.tools, sourceId)
    constraints.push(...nested.constraints)
    guardrails.push(...nested.guardrails)
    metadata = { ...metadata, ...nested.metadata }
  }

  async function appendContext(ctx: Context<z.ZodType>, index: number): Promise<void> {
    if (ctx.when && !ctx.when(input)) {
      const source = ctx.id ? `context:${ctx.id}` : `context[${index}]`
      await observe.span(
        {
          name: ctx.id ?? `context[${index}]`,
          family: 'context',
          primitive: 'context.predicate',
          attributes: {
            contextId: ctx.id,
            source,
            predicate: 'context.when',
            included: false,
            reason: 'context-level when returned false',
          },
        },
        async () => {
          emitContextContributionArtifact({
            kind: 'context.contribution',
            state: 'checked-not-included',
            included: false,
            sourceId: source,
            injectableKind: contextContributionKind(ctx),
            reason: 'context-level when returned false',
            injects: contextInjects(ctx),
            priority: ctx.priority,
          })
        },
      )
      excluded.push({ source, reason: 'context-level when returned false' })
      return
    }
    if (ctx.when) {
      const source = ctx.id ? `context:${ctx.id}` : `context[${index}]`
      await observe.span(
        {
          name: ctx.id ?? `context[${index}]`,
          family: 'context',
          primitive: 'context.predicate',
          attributes: {
            contextId: ctx.id,
            source,
            predicate: 'context.when',
            included: true,
          },
        },
        async () => undefined,
      )
    }
    if (ctx.useEntries.length > 0) {
      appendNested(await resolveContextEntries(ctx.useEntries, input, promptId), ctx.id ?? `context[${index}]`)
    }
    active.push(ctx)
  }

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry) continue

    if (isInjectableEntry(entry)) {
      const injection = normalizeInjection(await entry.inject({ input, promptId }))
      appendNested(await resolveContextEntries(injection.contexts ?? [], input, promptId), entry.id)
      mergeInjectedTools(tools, injection.tools ?? {}, entry.id)
      constraints.push(...(injection.constraints ?? []))
      guardrails.push(...(injection.guardrails ?? []))
      metadata = { ...metadata, ...(injection.metadata ?? {}) }
      emitDirectToolContribution({
        sourceId: `injectable:${entry.id}`,
        injectableKind: injectableContributionKind(entry),
        injectedTools: toolNames(injection.tools),
        injects: injectionInjects(injection),
      })
      continue
    }

    if (entry._tag === 'Skill') {
      skills.push(entry as SkillEntry)
      continue
    }

    if (entry._tag === 'Memory') {
      const mem = entry as MemoryEntry
      memories.push(mem)
      await appendContext(mem.asContext(), index)
      emitDirectToolContribution({
        sourceId: `memory:${mem.id}`,
        injectableKind: 'memory',
        injectedTools: toolNames(mem.asTools({ input })),
        injects: ['tools'],
      })
      continue
    }

    if (entry._tag === 'Blackboard') {
      const board = entry as BlackboardEntry
      blackboards.push(board)
      await appendContext(board.asContext(), index)
      emitDirectToolContribution({
        sourceId: `blackboard:${board.id}`,
        injectableKind: 'blackboard',
        injectedTools: toolNames(board.asTools()),
        injects: ['tools'],
      })
      continue
    }

    if (entry._tag === 'MatchSpec') {
      const spec = entry as MatchSpec
      const discriminator = spec.on(input)
      const branch = spec.cases[discriminator] ?? spec.default
      if (!branch) {
        const reason = `no case for "${discriminator}" and no default`
        await observe.span(
          {
            name: `match[${index}]`,
            family: 'context',
            primitive: 'context.predicate',
            attributes: {
              source: `match[${index}]`,
              predicate: 'match',
              discriminator,
              included: false,
              reason,
            },
          },
          async () => {
            emitContextContributionArtifact({
              kind: 'context.contribution',
              state: 'checked-not-included',
              included: false,
              sourceId: `match[${index}]`,
              injectableKind: 'match',
              reason,
              branch: String(discriminator),
            })
          },
        )
        excluded.push({ source: `match[${index}]`, reason })
        continue
      }
      await observe.span(
        {
          name: `match[${index}]`,
          family: 'context',
          primitive: 'context.predicate',
          attributes: {
            source: `match[${index}]`,
            predicate: 'match',
            discriminator,
            included: true,
            branch: spec.cases[discriminator] ? String(discriminator) : 'default',
          },
        },
        async () => {
          emitContextContributionArtifact({
            kind: 'context.contribution',
            state: 'active',
            included: true,
            sourceId: `match[${index}]`,
            injectableKind: 'match',
            branch: spec.cases[discriminator] ? String(discriminator) : 'default',
          })
        },
      )
      appendNested(
        await resolveContextEntries(Array.isArray(branch) ? branch : [branch], input, promptId),
        `match[${index}]`,
      )
      continue
    }

    if (entry._tag === 'ConditionalContext') {
      const cond = entry as ConditionalContext<Context<z.ZodType>>
      if (!cond.predicate(input)) {
        const source = cond.context.id ? `context:${cond.context.id}` : `context[${index}]`
        const reason = 'when() predicate returned false'
        await observe.span(
          {
            name: cond.context.id ?? `context[${index}]`,
            family: 'context',
            primitive: 'context.predicate',
            attributes: {
              contextId: cond.context.id,
              source,
              predicate: 'when',
              included: false,
              reason,
            },
          },
          async () => {
            emitContextContributionArtifact({
              kind: 'context.contribution',
              state: 'checked-not-included',
              included: false,
              sourceId: source,
              injectableKind: 'conditional',
              reason,
              injects: contextInjects(cond.context),
              priority: cond.context.priority,
            })
          },
        )
        excluded.push({ source, reason })
        continue
      }
      await observe.span(
        {
          name: cond.context.id ?? `context[${index}]`,
          family: 'context',
          primitive: 'context.predicate',
          attributes: {
            contextId: cond.context.id,
            source: cond.context.id ? `context:${cond.context.id}` : `context[${index}]`,
            predicate: 'when',
            included: true,
          },
        },
        async () => undefined,
      )
      await appendContext(cond.context, index)
      continue
    }

    await appendContext(entry as Context<z.ZodType>, index)
  }

  return {
    active,
    excluded,
    skills,
    memories,
    blackboards,
    tools,
    constraints,
    guardrails,
    metadata,
  }
}

function normalizeInjection(injection: PromptInjection | undefined): PromptInjection {
  return injection ?? {}
}

function mergeInjectedTools(target: AnyToolSet, tools: AnyToolSet, sourceId: string): void {
  for (const [name, tool] of Object.entries(tools)) {
    if (name in target) {
      throw new Error(
        `Injected tool name collision for "${name}". Injectable "${sourceId}" generated a tool name that already exists.`,
      )
    }
    target[name] = tool
  }
}

function toolNames(tools: AnyToolSet | undefined): readonly string[] | undefined {
  if (!tools) return undefined
  const names = Object.keys(tools)
  return names.length > 0 ? names : undefined
}

function injectionInjects(injection: PromptInjection): readonly CruxContextInjects[] | undefined {
  const injects: CruxContextInjects[] = []
  if ((injection.contexts?.length ?? 0) > 0) injects.push('system')
  if (Object.keys(injection.tools ?? {}).length > 0) injects.push('tools')
  if ((injection.constraints?.length ?? 0) > 0) injects.push('constraints')
  if ((injection.guardrails?.length ?? 0) > 0) injects.push('guardrails')
  return injects.length > 0 ? injects : undefined
}

function injectableContributionKind(entry: InjectableEntry): CruxContextInjectableKind {
  if (entry._tag === 'Retriever' || entry._tag === 'Grounding') return 'retriever'
  if (entry._tag === 'Skill') return 'skill'
  if (entry._tag === 'Memory') return 'memory'
  if (entry._tag === 'Blackboard') return 'blackboard'
  return 'injectable'
}

function contextContributionKind(ctx: Context<z.ZodType>): CruxContextInjectableKind {
  if (ctx.id?.startsWith('memory:')) return 'memory'
  if (ctx.id?.startsWith('blackboard:')) return 'blackboard'
  if (ctx.id?.startsWith('retriever:') || ctx.id?.startsWith('grounding:')) return 'retriever'
  if (ctx.id?.startsWith('__crux_skill')) return 'skill'
  return 'context'
}

function emitDirectToolContribution(input: {
  sourceId: string
  injectableKind: CruxContextInjectableKind
  injectedTools: readonly string[] | undefined
  injects: readonly CruxContextInjects[] | undefined
}): void {
  if (!input.injectedTools && !input.injects) return
  emitContextContributionArtifact({
    kind: 'context.contribution',
    state: 'active',
    included: true,
    sourceId: input.sourceId,
    injectableKind: input.injectableKind,
    injects: input.injects,
    injectedTools: input.injectedTools,
  })
}

/**
 * Extract all possible `Context` instances from a `ContextEntry[]`.
 *
 * Used at definition time to collect all contexts for schema merging,
 * regardless of runtime conditions.
 */
function extractAllContexts(entries: readonly ContextEntry[]): { ctx: Context<z.ZodType>; isConditional: boolean }[] {
  const result: { ctx: Context<z.ZodType>; isConditional: boolean }[] = []

  for (const entry of entries) {
    if (!entry) continue

    if (isInjectableEntry(entry)) {
      if (entry.inputSchema) {
        result.push({
          ctx: {
            _tag: 'Context' as const,
            id: entry.id,
            description: undefined,
            inputSchema: entry.inputSchema,
            inputKeys: entry.inputKeys ?? [],
            systemFn: () => '',
            useEntries: [],
            priority: 50,
            toolsFn: undefined,
            rawFields: [],
            when: undefined,
            cacheTtl: 0,
            providerCache: false,
            constraints: [],
            guardrails: [],
          },
          isConditional: false,
        })
      }
      continue
    }

    // Skills, memories, and blackboards don't contribute input schemas — skip them.
    if (entry._tag === 'Skill' || entry._tag === 'Memory' || entry._tag === 'Blackboard') continue

    if (entry._tag === 'MatchSpec') {
      const spec = entry as MatchSpec
      for (const branch of Object.values(spec.cases)) {
        const branchContexts = Array.isArray(branch) ? branch : [branch]
        for (const ctx of branchContexts) {
          result.push({ ctx, isConditional: true })
        }
      }
      if (spec.default) {
        const defaults = Array.isArray(spec.default) ? spec.default : [spec.default]
        for (const ctx of defaults) {
          result.push({ ctx, isConditional: true })
        }
      }
      continue
    }

    if (entry._tag === 'ConditionalContext') {
      const cond = entry as ConditionalContext<Context<z.ZodType>>
      result.push({ ctx: cond.context, isConditional: true })
      continue
    }

    // Plain context — conditional if it has a when field
    const ctx = entry as Context<z.ZodType>
    if (ctx.useEntries.length > 0) {
      result.push(...extractAllContexts(ctx.useEntries))
    }
    result.push({ ctx, isConditional: !!ctx.when })
  }

  return result
}

// ─────────────────────────────────────────────────────────────────
// Input Schema Merging
// ─────────────────────────────────────────────────────────────────

/**
 * Merge context input schemas with the prompt's own input schema.
 *
 * Called at `prompt()` time (not at call time) to detect conflicts early.
 * Handles the widened `ContextEntry` type: conditional contexts' keys are
 * wrapped with `.optional()` in the merged Zod schema.
 *
 * **Conflict rules:**
 * - Two contexts defining the same key → throws with a clear error message
 * - Prompt's own fields overlap with a context field → prompt wins (no error)
 *
 * @param entries - The context entries from `use`.
 * @param ownInput - The prompt's own `input` schema, if any.
 * @returns A merged Zod object schema, or `undefined` if no fields exist.
 * @throws If two contexts declare the same input key.
 */
export function mergeInputSchemas(
  entries: readonly ContextEntry[],
  ownInput: z.ZodType | undefined,
): z.ZodType | undefined {
  const seenKeys = new Map<string, string>() // key → context id/index
  let mergedShape: Record<string, z.ZodType> = {}

  const allContexts = extractAllContexts(entries)

  for (let i = 0; i < allContexts.length; i++) {
    const { ctx, isConditional } = allContexts[i]
    if (!ctx.inputSchema) continue

    const schema = ctx.inputSchema
    const shape = schema instanceof z.ZodObject ? schema.shape : undefined
    if (!shape || typeof shape !== 'object') continue

    for (const key of Object.keys(shape)) {
      const source = ctx.id ?? `context[${i}]`
      const existing = seenKeys.get(key)
      if (existing) {
        throw new Error(
          `Input key "${key}" is defined by both "${existing}" and "${source}". ` +
            `Context input keys must not overlap.`,
        )
      }
      seenKeys.set(key, source)
      // Conditional contexts get their keys wrapped as optional
      mergedShape[key] = isConditional ? shape[key].optional() : shape[key]
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

function contextInjects(ctx: Context<z.ZodType>): readonly CruxContextInjects[] {
  const injects: CruxContextInjects[] = ['system']
  if (ctx.toolsFn) injects.push('tools')
  if (ctx.constraints.length > 0) injects.push('constraints')
  if (ctx.guardrails.length > 0) injects.push('guardrails')
  return injects
}

function contextInjectedToolNames(ctx: Context<z.ZodType>, input: Record<string, unknown>): readonly string[] | undefined {
  if (!ctx.toolsFn) return undefined
  const names = Object.keys(ctx.toolsFn(input))
  return names.length > 0 ? names : undefined
}

function emitContextContributionArtifact(preview: CruxContextContributionPreview): void {
  const activeSpanId = observe.captureContext()?.currentSpanId
  const attributes: Record<string, unknown> = {
    source: preview.sourceId,
    state: preview.state,
    included: preview.included,
    injectableKind: preview.injectableKind,
  }
  if (preview.reason) attributes.reason = preview.reason
  if (preview.branch) attributes.branch = preview.branch
  if (preview.tokens !== undefined) attributes.tokens = preview.tokens
  if (preview.cacheStatus) attributes.cacheStatus = preview.cacheStatus
  if (preview.injectedTools) attributes.injectedTools = preview.injectedTools
  const artifactId = observe.artifact({
    kind: 'context.contribution',
    contentType: 'application/json',
    encoding: 'json',
    sizeBytes: preview.sizeBytes,
    preview,
    attributes,
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { source: preview.sourceId, state: preview.state },
    })
  }
}

function emitPromptBudgetArtifact(preview: CruxPromptBudgetPreview): CruxArtifactId | undefined {
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'prompt.budget',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      budgetUsedTokens: preview.usedTokens,
      budgetTotalTokens: preview.totalTokens,
      droppedContextCount: preview.dropped.length,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { primitive: 'prompt.budget' },
    })
  }
  return artifactId
}

/**
 * Emits the prompt-input observability artifact without serializing input
 * values. The preview is limited to top-level key names and validation status so
 * devtools can compare runtime inputs with effective schemas while preserving
 * the same redaction boundary for successful and failed calls.
 */
function emitPromptInputArtifact(preview: CruxPromptInputPreview): CruxArtifactId | undefined {
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
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
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { primitive: 'prompt.input', validationStatus: preview.validationStatus },
    })
  }
  return artifactId
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

/**
 * Assemble the final system message from the prompt's own system text
 * and all context contributions, with optional token-budget enforcement.
 *
 * **Composition order:**
 * 1. Prompt's own `system` (role/identity) — first (never dropped)
 * 2. Context contributions in `use` array order — appended
 * 3. Parts joined with `\n\n`, empty strings silently omitted
 *
 * **Token-aware rendering** (when `tokenBudget` is set):
 * - The prompt's own system text is always included (never dropped)
 * - Context contributions are sorted by priority (lowest first for dropping)
 * - Lowest-priority contexts are dropped until the total fits within budget
 */
export async function composeSystem(
  ownSystem: string | ResolvedSystemContent,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
  tokenBudget?: number,
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
    const text = await observe.span(
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
          const cached = getCachedContent(cacheKey)
          if (cached !== null) {
            resolvedContent = cached
            cacheStatus = 'hit'
            // Fire cache hit hook
            const entry = contextResolverCache.get(cacheKey)
            const ageMs = entry ? Date.now() - (entry.expiresAt - ctx.cacheTtl) : 0
            getRuntime().instrumentationHooks?.onContextCacheHit?.({
              contextId: ctx.id,
              cacheKey,
              ageMs,
            })
          } else {
            const start = Date.now()
            resolvedContent = normalizeSystemContent(
              await ctx.systemFn(input),
              ctx.systemKind !== 'static',
              `Context "${source}" system function`,
              contextInferenceInput,
            )
            cacheStatus = 'miss'
            const resolutionMs = Date.now() - start
            if (resolvedContent.text) {
              setCachedContent(cacheKey, resolvedContent, ctx.cacheTtl)
            }
            // Fire cache miss hook
            getRuntime().instrumentationHooks?.onContextCacheMiss?.({
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
          const activeSpanId = observe.captureContext()?.currentSpanId
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
          const artifactId = observe.artifact({
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
          })
          contextArtifactId = artifactId
          if (activeSpanId && artifactId) {
            observe.edge({
              edgeType: 'produced',
              from: { kind: 'span', id: activeSpanId },
              to: { kind: 'artifact', id: artifactId },
              attributes: { source },
            })
          }
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
    promptBudgetArtifactId = emitPromptBudgetArtifact({
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
// Context Tool Collection
// ─────────────────────────────────────────────────────────────────

/**
 * Collect tools from all contexts that declare them.
 *
 * Tools from later contexts overwrite earlier ones on name collision
 * (same merge semantics as settings). Contexts whose system text was
 * dropped for token budget still contribute their tools.
 */
export function collectContextTools(
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

/**
 * Collect tools from blackboards that were injected directly through `use`.
 *
 * Blackboard tools fail on collisions because each generated tool closes over
 * a specific board instance. Silent overwrite would make the model write to the
 * wrong shared state surface.
 */
export function collectBlackboardTools(
  blackboards: readonly BlackboardEntry[],
  existingTools: AnyToolSet = {},
): AnyToolSet {
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

/**
 * Collect constraints from all active contexts (array concat, no dedup).
 * Deduplication happens in the adapter's `mergeConstraints()` helper.
 */
export function collectContextConstraints(contexts: readonly Context<z.ZodType>[]): Constraint[] {
  const result: Constraint[] = []
  for (const ctx of contexts) {
    if (ctx.constraints && ctx.constraints.length > 0) {
      result.push(...ctx.constraints)
    }
  }
  return result
}

/**
 * Collect guardrails from all active contexts (array concat, no dedup).
 * Deduplication happens in the adapter's `mergeGuardrails()` helper.
 */
export function collectContextGuardrails(contexts: readonly Context<z.ZodType>[]): Guardrail[] {
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
// Resolve Options (internal)
// ─────────────────────────────────────────────────────────────────

/** Internal options type used by `resolvePrompt`. */
export interface ResolveCallOptions extends GenerationSettings {
  input?: Record<string, unknown>
  provider?: string
  modelId?: string
  tokenBudget?: number
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
// Resolve Prompt (core pipeline)
// ─────────────────────────────────────────────────────────────────

/**
 * The core resolution pipeline — transforms config + options into SDK-agnostic resolved args.
 *
 * **Pipeline steps:**
 * 1. Validate input against the merged Zod schema
 * 2. Compose system message (prompt's own system + context contributions)
 * 3. Resolve prompt text or messages array
 * 4. Apply provider-specific adaptation (prepend/append system/prompt, override settings)
 * 5. Merge settings with priority: `config.settings` < `adapt.settings` < call-site overrides
 * 6. Collect and merge tools from contexts and config
 * 7. Return complete `ResolvedPrompt`
 */
export async function resolvePrompt(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
): Promise<ResolvedPrompt> {
  return observe.span(
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
    async () => resolvePromptInternal(config, opts, mergedSchema),
  )
}

async function resolvePromptInternal(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
): Promise<ResolvedPrompt> {
  let input = opts.input ?? {}

  // 1. Validate input
  if (mergedSchema) {
    const parseResult = safeParseSchema(mergedSchema, input)
    if (!parseResult.success) {
      emitPromptInputArtifact(promptInputPreview(config.id, input, mergedSchema, 'failed'))
      throw new Error(`Input validation failed: ${JSON.stringify(parseResult.error?.issues ?? parseResult.error)}`)
    }
    emitPromptInputArtifact(promptInputPreview(config.id, input, mergedSchema, 'passed'))
  } else {
    emitPromptInputArtifact(promptInputPreview(config.id, input, undefined, 'not-configured'))
  }

  const entries: readonly ContextEntry[] = config.use ?? []

  // 1a. Flatten context entries (evaluate when/match conditions)
  const {
    active: contexts,
    skills,
    memories,
    blackboards,
    tools: injectedTools,
    constraints: injectedConstraints,
    guardrails: injectedGuardrails,
    metadata: injectedMetadata,
  } = await resolveContextEntries(entries, input as Record<string, unknown>, config.id)

  // 1a-skills. If skills are present, resolve registry skills + generate index + inject loaded skills
  if (skills.length > 0) {
    // Fetch any unfetched registry skills (async — this is the only await in the skill pipeline)
    const resolvedSkills: SkillEntry[] = []
    for (const s of skills) {
      // Detect lazy registry skills by their placeholder description or instructions
      const isLazy =
        s.description.startsWith('Skill from registry:') ||
        (typeof s.instructions === 'string' && s.instructions.startsWith('[Skill "'))
      if (isLazy) {
        // This is a lazy registry skill — fetch its content
        try {
          const fetched = await resolveRegistrySkill(s.id)
          // Create a new Skill with the real content
          const resolved: SkillEntry = Object.freeze({
            _tag: 'Skill' as const,
            id: fetched.meta.name,
            description: fetched.meta.description,
            instructions: fetched.instructions,
            references: fetched.references,
            meta: fetched.meta,
            dump: () => fetched.instructions,
          })
          resolvedSkills.push(resolved)
        } catch (err) {
          // If fetch fails, use the skill as-is (placeholder) but log the error
          console.warn(`[@crux/core] Failed to fetch skill "${s.id}":`, err instanceof Error ? err.message : err)
          resolvedSkills.push(s)
        }
      } else {
        resolvedSkills.push(s)
      }
    }

    // Replace skills array with resolved skills for index + tools
    skills.length = 0
    skills.push(...resolvedSkills)

    // Generate index context from resolved skills
    const indexText = generateIndex(skills)
    const indexContext: Context<z.ZodType> = Object.freeze({
      _tag: 'Context' as const,
      id: '__crux_skill_index',
      description: 'Auto-generated skill index',
      inputSchema: undefined,
      inputKeys: Object.freeze([]) as readonly string[],
      systemFn: () => indexText,
      useEntries: Object.freeze([]),
      priority: 90,
      toolsFn: undefined,
      rawFields: Object.freeze([]) as readonly string[],
      constraints: Object.freeze([]),
      guardrails: Object.freeze([]),
      when: undefined,
      cacheTtl: 0,
      providerCache: false,
    })
    contexts.unshift(indexContext)

    // Inject loaded skill instructions for previously activated skills.
    // Active skills come from two sources:
    // 1. Module-level state (same process, e.g. within a tool loop)
    // 2. Input._crux_activeSkills (cross-process, e.g. Convex blackboard → contextHandler)
    const existingState = getLatestSkillState()
    const inputActiveSkills = readActiveSkillIds(input)
    const allActiveSkillIds = new Set<string>([...(existingState?.active ?? []), ...inputActiveSkills])
    if (allActiveSkillIds.size > 0) {
      for (const skillId of allActiveSkillIds) {
        // Find the resolved skill by ID
        const loadedSkill = skills.find((sk) => sk.id === skillId) ?? existingState?.available.get(skillId)
        if (loadedSkill) {
          const skillContext: Context<z.ZodType> = Object.freeze({
            _tag: 'Context' as const,
            id: `__crux_skill_loaded:${skillId}`,
            description: `Loaded skill: ${skillId}`,
            inputSchema: undefined,
            inputKeys: Object.freeze([]) as readonly string[],
            systemFn: () => `## Skill: ${loadedSkill.id}\n\n${loadedSkill.instructions}`,
            useEntries: Object.freeze([]),
            priority: 85,
            toolsFn: undefined,
            rawFields: Object.freeze([]) as readonly string[],
            constraints: Object.freeze([]),
            guardrails: Object.freeze([]),
            when: undefined,
            cacheTtl: 0,
            providerCache: false,
          })
          contexts.push(skillContext)
        }
      }
    }
  }

  // 1b. Auto-escape string inputs (after validation, before system/prompt)
  if (isAutoEscapeEnabled()) {
    const rawFieldSet = new Set<string>([
      ...(config.rawFields ?? []),
      ...contexts.flatMap((ctx) => ctx.rawFields ?? []),
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
  if (isSecurityWarningsEnabled()) {
    for (const [key, value] of Object.entries(opts.input ?? {})) {
      if (typeof value === 'string') {
        const warnings = detectSuspiciousPatterns(value, key)
        for (const w of warnings) {
          console.warn(`[@crux/core] ${w.message}`)
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
  const ownSystem = await resolveSystemContentOrFn(config.system, guardedInput)
  const composed = await composeSystem(ownSystem, contexts, guardedInput, opts.tokenBudget)
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
    promptText = await resolveStringOrFn(config.prompt, guardedInput)
  }

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
  const adaptation = resolveAdaptation(config.adapt, modelInfo)
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

  const contextTools = collectContextTools(contexts, input)
  const configTools = config.tools

  // Inject skill tools (LoadSkill + LoadReference) when skills are present
  let skillTools: AnyToolSet = {}
  if (skills.length > 0) {
    const skillState = createSkillState(skills)

    // Carry over activated skills from previous state + input (Convex blackboard)
    const previousState = getLatestSkillState()
    if (previousState) {
      for (const activeId of previousState.active) {
        skillState.active.add(activeId)
      }
    }
    // Also carry from input (for serverless environments where module state is lost)
    const inputSkills = readActiveSkillIds(input)
    for (const id of inputSkills) {
      skillState.active.add(id)
    }

    skillTools = {
      [LOAD_SKILL_TOOL_NAME]: createLoadSkillTool(skillState),
      [LOAD_REFERENCE_TOOL_NAME]: createLoadReferenceTool(skillState),
    }
    // Attach skill state to resolved prompt for executor access
    ;(resolved as ResolvedPrompt & { _skillState?: unknown })._skillState = skillState
    // Register in module-level registry for AI SDK middleware access
    registerSkillState(skillState)
  }

  const blackboardTools = collectBlackboardTools(blackboards, {
    ...skillTools,
    ...contextTools,
    ...(configTools ?? {}),
  })

  const merged = { ...skillTools, ...contextTools, ...injectedTools, ...blackboardTools, ...configTools }

  if (Object.keys(merged).length > 0) resolved.tools = merged
  if (config.toolMiddleware !== undefined) resolved.toolMiddleware = config.toolMiddleware

  if (config.toolChoice !== undefined) resolved.toolChoice = config.toolChoice
  if (config.stopWhen !== undefined) resolved.stopWhen = config.stopWhen

  // ── Collect constraints from contexts + prompt config ──
  const contextConstraints = collectContextConstraints(contexts)
  const promptConstraints = config.constraints ?? []
  const allConstraints = [...injectedConstraints, ...contextConstraints, ...promptConstraints]
  if (allConstraints.length > 0) {
    resolved.constraints = allConstraints
  }

  // ── Collect guardrails from contexts + prompt config ──
  const contextGuardrails = collectContextGuardrails(contexts)
  const promptGuardrails = config.guardrails ?? []
  const allGuardrails = [...injectedGuardrails, ...contextGuardrails, ...promptGuardrails]
  if (allGuardrails.length > 0) {
    resolved.guardrails = allGuardrails
  }

  if (Object.keys(injectedMetadata).length > 0) {
    resolved.metadata = injectedMetadata
  }

  if (memories.length > 0) {
    resolved.memoryBindings = memories.map((memory) => ({
      memory,
      input: input as Record<string, unknown>,
      promptId: config.id,
    }))
  }

  return resolved
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

/**
 * Build an `InspectResult` from the same resolution pipeline as `resolvePrompt`.
 *
 * Returns a structured breakdown of every part of the system message,
 * with source attribution and token counts.
 */
export async function inspectArgs(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
): Promise<InspectResult> {
  let input = opts.input ?? {}

  // Validate input
  if (mergedSchema) {
    const parseResult = safeParseSchema(mergedSchema, input)
    if (!parseResult.success) {
      throw new Error(`Input validation failed: ${JSON.stringify(parseResult.error?.issues ?? parseResult.error)}`)
    }
  }

  const entries: readonly ContextEntry[] = config.use ?? []

  // Resolve context entries (evaluate when/match conditions and injectables)
  const {
    active: contexts,
    excluded,
    skills,
    blackboards,
    tools: injectedTools,
  } = await resolveContextEntries(entries, input as Record<string, unknown>, config.id)

  // Generate skill index for inspect view (mirrors resolvePrompt logic)
  if (skills.length > 0) {
    // Resolve lazy registry skills for inspect
    for (let i = 0; i < skills.length; i++) {
      const s = skills[i]!
      const isLazy = s.description.startsWith('Skill from registry:')
      if (isLazy) {
        try {
          const fetched = await resolveRegistrySkill(s.id)
          skills[i] = Object.freeze({
            _tag: 'Skill' as const,
            id: fetched.meta.name,
            description: fetched.meta.description,
            instructions: fetched.instructions,
            references: fetched.references,
            meta: fetched.meta,
            dump: () => fetched.instructions,
          })
        } catch {
          /* use placeholder */
        }
      }
    }
    const indexText = generateIndex(skills)
    contexts.unshift(
      Object.freeze({
        _tag: 'Context' as const,
        id: '__crux_skill_index',
        description: 'Auto-generated skill index',
        inputSchema: undefined,
        inputKeys: Object.freeze([]) as readonly string[],
        systemFn: () => indexText,
        useEntries: Object.freeze([]),
        priority: 90,
        toolsFn: undefined,
        rawFields: Object.freeze([]) as readonly string[],
        constraints: Object.freeze([]),
        guardrails: Object.freeze([]),
        when: undefined,
        cacheTtl: 0,
        providerCache: false,
      }),
    )

    // Inject loaded skill content for previously activated skills (mirrors resolvePrompt)
    const existingState = getLatestSkillState()
    const inputActiveSkills = readActiveSkillIds(input)
    const allActiveSkillIds = new Set<string>([...(existingState?.active ?? []), ...inputActiveSkills])
    if (allActiveSkillIds.size > 0) {
      for (const skillId of allActiveSkillIds) {
        const loadedSkill = skills.find((sk) => sk.id === skillId) ?? existingState?.available.get(skillId)
        if (loadedSkill) {
          contexts.push(
            Object.freeze({
              _tag: 'Context' as const,
              id: `__crux_skill_loaded:${skillId}`,
              description: `Loaded skill: ${skillId}`,
              inputSchema: undefined,
              inputKeys: Object.freeze([]) as readonly string[],
              systemFn: () => `## Skill: ${loadedSkill.id}\n\n${loadedSkill.instructions}`,
              useEntries: Object.freeze([]),
              priority: 85,
              toolsFn: undefined,
              rawFields: Object.freeze([]) as readonly string[],
              constraints: Object.freeze([]),
              guardrails: Object.freeze([]),
              when: undefined,
              cacheTtl: 0,
              providerCache: false,
            }),
          )
        }
      }
    }
  }

  // Apply auto-escape (same as resolvePrompt)
  if (isAutoEscapeEnabled()) {
    const rawFieldSet = new Set<string>([
      ...(config.rawFields ?? []),
      ...contexts.flatMap((ctx) => ctx.rawFields ?? []),
    ])

    const sanitizedInput: Record<string, unknown> = { ...input }
    for (const [key, value] of Object.entries(sanitizedInput)) {
      if (typeof value === 'string' && !rawFieldSet.has(key)) {
        sanitizedInput[key] = escapeXml(value)
      }
    }
    input = sanitizedInput
  }

  // Apply custom sanitize hook
  if (config.sanitize) {
    input = config.sanitize(input as never) as Record<string, unknown>
  }

  const guardedInput = guardInputs(input as Record<string, unknown>, config.id)
  const ownSystem = await resolveSystemContentOrFn(config.system, guardedInput)
  const composed = await composeSystem(ownSystem, contexts, guardedInput, opts.tokenBudget)

  // Resolve prompt text
  let promptInfo: { text: string; tokens: number } | undefined
  if (!config.messages) {
    const promptText = await resolveStringOrFn(config.prompt, guardedInput)
    if (promptText) {
      promptInfo = { text: promptText, tokens: countTokens(promptText) }
    }
  }

  const systemTokens = composed.system ? countTokens(composed.system) : 0
  const promptTokens = promptInfo?.tokens ?? 0

  // Collect tools for reporting (include skill tools if skills present)
  const contextTools = collectContextTools(contexts, input)
  const configTools = config.tools ?? {}
  const blackboardTools = collectBlackboardTools(blackboards, { ...contextTools, ...configTools })
  const skillToolNames = skills.length > 0 ? [LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME] : []
  const allTools = { ...contextTools, ...injectedTools, ...blackboardTools, ...configTools }
  const toolNames = [...skillToolNames, ...Object.keys(allTools)]

  return {
    system: {
      total: composed.system,
      parts: composed.parts,
      totalTokens: systemTokens,
    },
    prompt: promptInfo,
    totalTokens: systemTokens + promptTokens,
    droppedContexts: composed.droppedContexts,
    excludedContexts: excluded,
    tokenBudget: opts.tokenBudget,
    tools: toolNames.length > 0 ? toolNames : undefined,
  }
}
