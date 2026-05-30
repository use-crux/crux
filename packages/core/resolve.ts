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
} from './types'
import type { Constraint } from './safety/constraint/types'
import type { Guardrail } from './safety/guardrail/types'
import type { CruxArtifactId } from './observability/contract'
import { isInjectableEntry } from './injectable'
import { generateCatalog } from './skill/catalog'
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

/** Internal cache entry for a resolved context system text. */
interface ContextCacheEntry {
  text: string
  expiresAt: number
}

/**
 * Module-level cache for context resolver outputs.
 * Key: `cache:ctx:{contextId}:{inputHash}`
 * Value: { text, expiresAt }
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
 * Returns the cached text if found and not expired, null otherwise.
 */
function getCachedText(key: string): string | null {
  const entry = contextResolverCache.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    contextResolverCache.delete(key)
    return null
  }
  return entry.text
}

/**
 * Store a resolved text in the cache with TTL.
 */
function setCachedText(key: string, text: string, ttl: number): void {
  contextResolverCache.set(key, { text, expiresAt: Date.now() + ttl })
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

    // 2. Skill — collect for catalog generation
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
        async () => undefined,
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
      continue
    }

    if (entry._tag === 'Blackboard') {
      const board = entry as BlackboardEntry
      blackboards.push(board)
      await appendContext(board.asContext(), index)
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
          async () => undefined,
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
        async () => undefined,
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
          async () => undefined,
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
  text: string
  tokens: number
  priority: number
  index: number // original order in `use` array
  providerCache: boolean // from context's cache option
  artifactId?: CruxArtifactId
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
  ownSystem: string,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
  tokenBudget?: number,
): Promise<{
  system: string
  parts: InspectPart[]
  droppedContexts: DroppedContext[]
  blocks: SystemBlock[]
}> {
  const parts: InspectPart[] = []
  const droppedContexts: DroppedContext[] = []

  // Prompt's own system — always included, never dropped
  const ownTokens = ownSystem ? countTokens(ownSystem) : 0
  parts.push({
    source: 'prompt',
    text: ownSystem,
    tokens: ownTokens,
    skipped: !ownSystem,
  })

  // Resolve all context contributions (may be async, with optional caching)
  const resolved: ResolvedContextPart[] = []
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i]
    const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`

    let contextArtifactId: CruxArtifactId | undefined
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
        let text: string
        let cacheStatus: 'hit' | 'miss' | 'disabled' = 'disabled'
        if (ctx.cacheTtl > 0 && ctx.id) {
          const cacheKey = computeCacheKey(ctx.id, input, ctx.inputKeys)
          const cached = getCachedText(cacheKey)
          if (cached !== null) {
            text = cached
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
            text = await ctx.systemFn(input)
            cacheStatus = 'miss'
            const resolutionMs = Date.now() - start
            if (typeof text === 'string' && text) {
              setCachedText(cacheKey, text, ctx.cacheTtl)
            }
            // Fire cache miss hook
            getRuntime().instrumentationHooks?.onContextCacheMiss?.({
              contextId: ctx.id,
              cacheKey,
              resolutionMs,
            })
          }
        } else {
          text = await ctx.systemFn(input)
        }

        if (typeof text === 'string' && text) {
          const activeSpanId = observe.captureContext()?.currentSpanId
          const artifactId = observe.artifact({
            kind: 'context',
            contentType: 'text/plain',
            encoding: 'text',
            sizeBytes: text.length,
            preview: text,
            attributes: {
              contextId: ctx.id,
              source,
              tokens: countTokens(text),
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

        return text
      },
    )

    if (text != null && typeof text !== 'string') {
      throw new Error(
        `Context "${source}" system function must return a string, got ${typeof text}. ` +
          `Value: ${JSON.stringify(text).slice(0, 200)}`,
      )
    }

    if (!text) {
      parts.push({ source, text: '', tokens: 0, skipped: true })
      continue
    }

    const tokens = countTokens(text)
    resolved.push({
      source,
      text,
      tokens,
      priority: ctx.priority,
      index: i,
      providerCache: ctx.providerCache,
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
      })
    }
  } else {
    // Token-aware: drop lowest-priority contexts until we fit
    let remainingBudget = tokenBudget - ownTokens
    // Add separator tokens between parts (each \n\n is ~1 token)
    const separatorTokens = ownSystem ? 1 : 0

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
          text: r.text,
          tokens: r.tokens,
          priority: r.priority,
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
        })
      } else {
        parts.push({
          source: r.source,
          text: r.text,
          tokens: r.tokens,
          skipped: false,
        })
      }
    }
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
      })
    }
  }

  return { system, parts, droppedContexts, blocks }
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
      throw new Error(`Input validation failed: ${JSON.stringify(parseResult.error?.issues ?? parseResult.error)}`)
    }
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

  // 1a-skills. If skills are present, resolve registry skills + generate catalog + inject loaded skills
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

    // Replace skills array with resolved skills for catalog + tools
    skills.length = 0
    skills.push(...resolvedSkills)

    // Generate catalog context from resolved skills
    const catalogText = generateCatalog(skills)
    const catalogContext: Context<z.ZodType> = Object.freeze({
      _tag: 'Context' as const,
      id: '__crux_skill_catalog',
      description: 'Auto-generated skill catalog',
      inputSchema: undefined,
      inputKeys: Object.freeze([]) as readonly string[],
      systemFn: () => catalogText,
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
    contexts.unshift(catalogContext)

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
  const ownSystem = await resolveStringOrFn(config.system, guardedInput)
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
      kind: 'output',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        primitive: 'security.warning',
        promptId: input.promptId,
        field: input.field,
        pattern: input.pattern,
        message: input.message,
        inputPreview: input.inputPreview,
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

  // Generate skill catalog for inspect view (mirrors resolvePrompt logic)
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
    const catalogText = generateCatalog(skills)
    contexts.unshift(
      Object.freeze({
        _tag: 'Context' as const,
        id: '__crux_skill_catalog',
        description: 'Auto-generated skill catalog',
        inputSchema: undefined,
        inputKeys: Object.freeze([]) as readonly string[],
        systemFn: () => catalogText,
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
  const ownSystem = await resolveStringOrFn(config.system, guardedInput)
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
