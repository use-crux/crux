/**
 * Entry lowering — the single place that knows the `use:` entry union.
 *
 * `lowerEntry()` turns each member of the eight-way `ContextEntry` union
 * (plain contexts, `when()` wrappers, `match()` specs, skills, memories,
 * blackboards, private inject-shaped primitives, custom contributors, plus
 * falsy values) into a {@link LoweredContributor} for the driver. Everything
 * family-specific — dispatch precedence, exclusion source naming, observability
 * classification, predicate semantics — lives here, so adding an entry family
 * is one new lowering function instead of coordinated edits across the pipeline.
 *
 * Definition-time schema collection lives in `schema-collection.ts`; this file
 * stays focused on the runtime lowering contract.
 *
 * Behavioral notes:
 *
 * - Dispatch precedence is contributor → private inject-shaped primitive
 *   (duck-typed on a callable `inject`) → `_tag` switch → plain context.
 * - Family classification reads `Context.family`, declared by the primitive
 *   factory that produced the context (`memory()`, `blackboard()`,
 *   `retriever()`, grounding, the skill surface). Plain contexts default to
 *   `context`.
 * - Memory entries contribute their context only. Memory tools are opt-in
 *   via `memory.asTools()` at the prompt level and are neither merged nor
 *   reported as injected.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyToolSet } from '../types'
import type {
  BlackboardEntry,
  ConditionalContext,
  Context,
  ContextEntry,
  ContributorEntry,
  MatchSpec,
  MemoryEntry,
  SkillEntry,
  ThreadHistoryEntry,
} from '../prompt/context-types'
import type { HistoryProjection } from '../request/history/source'
import {
  compileRepresentationLadder,
  isForcedOffload,
  isRepresentationLadder,
} from '../request/representation/ladder'
import type {
  ForcedOffload,
  RepresentationLadder,
} from '../request/representation/ladder-types'
import type { InternalInjectableEntry, InternalPromptInjection } from '../prompt/internal-injection'
import type { CruxContextInjectableKind, CruxContextInjects } from '../observability/contract'
import { isInternalInjectableEntry } from '../prompt/internal-injection'
import { isContributorEntry } from '../prompt/contributor'
import { isToolSource, type ToolSource } from '../tools/tool-source'
import {
  CONTRIBUTOR,
  type GateResult,
  type InclusionStep,
  type LoweredContributor,
} from './contract'

// ─────────────────────────────────────────────────────────────────
// Family classification
// ─────────────────────────────────────────────────────────────────

/** Channels a context writes to, derived from its declared surface. */
export function contextInjects(ctx: Context<z.ZodType>): readonly CruxContextInjects[] {
  const injects: CruxContextInjects[] = ['system']
  if (ctx.toolsFn) injects.push('tools')
  if (ctx.constraints.length > 0) injects.push('constraints')
  if (ctx.guardrails.length > 0) injects.push('guardrails')
  return injects
}

/** Tool names a context would inject for this input, or `undefined` when none. */
export function contextInjectedToolNames(
  ctx: Context<z.ZodType>,
  input: Record<string, unknown>,
): readonly string[] | undefined {
  if (!ctx.toolsFn) return undefined
  const names = Object.keys(ctx.toolsFn(input))
  return names.length > 0 ? names : undefined
}

/**
 * Classify a plain context for observability by its declared family.
 *
 * Memory/blackboard/retriever/skill entries expand into plain contexts
 * before system composition; their factories declare `family` on the
 * contexts they produce, so no id sniffing is needed. Contexts without a
 * declared family are plain application contexts.
 */
export function contextContributionKind(ctx: Context<z.ZodType>): CruxContextInjectableKind {
  return ctx.family ?? 'context'
}

/** Classify a private injectable entry by its `_tag`, falling back to `injectable`. */
export function injectableContributionKind(entry: InternalInjectableEntry): CruxContextInjectableKind {
  if (
    entry._tag === 'Retriever' ||
    entry._tag === 'RetrievalPipeline' ||
    entry._tag === 'Grounding' ||
    entry._tag === 'KnowledgeBase' ||
    entry._tag === 'KnowledgeView' ||
    entry._tag === 'RetrievalRecipe'
  ) {
    return 'retriever'
  }
  if (entry._tag === 'Skill') return 'skill'
  if (entry._tag === 'Memory') return 'memory'
  if (entry._tag === 'Blackboard') return 'blackboard'
  return 'injectable'
}

/** Classify a custom contributor. Public contributors are app-owned injectables. */
function contributorContributionKind(_entry: ContributorEntry<z.ZodType>): CruxContextInjectableKind {
  return 'injectable'
}

/** Tool names of a toolset, or `undefined` when empty — artifact previews omit empty lists. */
export function toolNames(tools: AnyToolSet | undefined): readonly string[] | undefined {
  if (!tools) return undefined
  const names = Object.keys(tools)
  return names.length > 0 ? names : undefined
}

/** Channels a private injection/contribution actually wrote to, or `undefined` when it wrote nothing. */
export function injectionInjects(injection: InternalPromptInjection): readonly CruxContextInjects[] | undefined {
  const injects: CruxContextInjects[] = []
  if ((injection.contexts?.length ?? 0) > 0) injects.push('system')
  if (Object.keys(injection.tools ?? {}).length > 0) injects.push('tools')
  if ((injection.constraints?.length ?? 0) > 0) injects.push('constraints')
  if ((injection.guardrails?.length ?? 0) > 0) injects.push('guardrails')
  return injects.length > 0 ? injects : undefined
}

// ─────────────────────────────────────────────────────────────────
// Per-family lowering
// ─────────────────────────────────────────────────────────────────

const INCLUDED: GateResult = Object.freeze({ include: true })

/**
 * Gate a plain context: evaluate its own `when` predicate, producing the
 * predicate span (and, on exclusion, the contribution artifact) facts.
 *
 * Shared by plain-context lowering and the second half of `when()` wrapper
 * gating, which checks the wrapped context's own `when` after its wrapper
 * predicate passes.
 */
function gatePlainContext(ctx: Context<z.ZodType>, index: number, input: Record<string, unknown>): GateResult {
  if (!ctx.when) return INCLUDED
  const source = ctx.id ? `context:${ctx.id}` : `context[${index}]`
  const name = ctx.id ?? `context[${index}]`
  if (!ctx.when(input)) {
    const reason = 'context-level when returned false'
    return {
      include: false,
      source,
      reason,
      steps: [
        {
          span: {
            name,
            attributes: { contextId: ctx.id, source, predicate: 'context.when', included: false, reason },
          },
          artifact: {
            kind: 'context.contribution',
            state: 'checked-not-included',
            included: false,
            sourceId: source,
            injectableKind: contextContributionKind(ctx),
            reason,
            injects: contextInjects(ctx),
            priority: ctx.priority,
          },
        },
      ],
    }
  }
  return {
    include: true,
    steps: [
      {
        span: {
          name,
          attributes: { contextId: ctx.id, source, predicate: 'context.when', included: true },
        },
      },
    ],
  }
}

/**
 * Lower a plain `Context` at a given position. Exported for the driver,
 * which reuses it to run memory/blackboard `asContext()` expansions through
 * the identical appending logic (gate, nested entries, then self).
 */
export function lowerContext(ctx: Context<z.ZodType>, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: ctx.id,
    family: 'context',
    index,
    mergeSourceId: ctx.id ?? `context[${index}]`,
    toolOwnerLabel: ctx.id ? `context:${ctx.id}` : `context[${index}]`,
    gate: (input) => gatePlainContext(ctx, index, input),
    children: () => ctx.useEntries,
    contribute: () => ({ contexts: [ctx] }),
  }
}

function lowerConditional(cond: ConditionalContext<Context<z.ZodType>>, index: number): LoweredContributor {
  const ctx = cond.context
  return {
    [CONTRIBUTOR]: true,
    id: ctx.id,
    family: 'conditional',
    index,
    mergeSourceId: ctx.id ?? `context[${index}]`,
    toolOwnerLabel: ctx.id ? `context:${ctx.id}` : `context[${index}]`,
    gate: (input) => {
      const source = ctx.id ? `context:${ctx.id}` : `context[${index}]`
      const name = ctx.id ?? `context[${index}]`
      if (!cond.predicate(input)) {
        const reason = 'when() predicate returned false'
        return {
          include: false,
          source,
          reason,
          steps: [
            {
              span: {
                name,
                attributes: { contextId: ctx.id, source, predicate: 'when', included: false, reason },
              },
              artifact: {
                kind: 'context.contribution',
                state: 'checked-not-included',
                included: false,
                sourceId: source,
                injectableKind: 'conditional',
                reason,
                injects: contextInjects(ctx),
                priority: ctx.priority,
              },
            },
          ],
        }
      }
      const predicateStep: InclusionStep = {
        span: {
          name,
          attributes: { contextId: ctx.id, source, predicate: 'when', included: true },
        },
      }
      const inner = gatePlainContext(ctx, index, input)
      const steps = [predicateStep, ...(inner.steps ?? [])]
      return inner.include ? { include: true, steps } : { ...inner, steps }
    },
    children: () => ctx.useEntries,
    contribute: () => ({ contexts: [ctx] }),
  }
}

function lowerMatch(spec: MatchSpec, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: undefined,
    family: 'match',
    index,
    mergeSourceId: `match[${index}]`,
    toolOwnerLabel: undefined,
    gate: (input) => {
      const source = `match[${index}]`
      const discriminator = spec.on(input)
      const branch = spec.cases[discriminator] ?? spec.default
      if (!branch) {
        const reason = `no case for "${discriminator}" and no default`
        return {
          include: false,
          source,
          reason,
          steps: [
            {
              span: {
                name: source,
                attributes: { source, predicate: 'match', discriminator, included: false, reason },
              },
              artifact: {
                kind: 'context.contribution',
                state: 'checked-not-included',
                included: false,
                sourceId: source,
                injectableKind: 'match',
                reason,
                branch: String(discriminator),
              },
            },
          ],
        }
      }
      const branchLabel = spec.cases[discriminator] ? String(discriminator) : 'default'
      return {
        include: true,
        // The discriminator already ran — hand the selected branch to the
        // driver so user `on()` callbacks execute exactly once per resolution.
        children: Array.isArray(branch) ? branch : [branch as Context<z.ZodType>],
        steps: [
          {
            span: {
              name: source,
              attributes: { source, predicate: 'match', discriminator, included: true, branch: branchLabel },
            },
            artifact: {
              kind: 'context.contribution',
              state: 'active',
              included: true,
              sourceId: source,
              injectableKind: 'match',
              branch: branchLabel,
            },
          },
        ],
      }
    },
  }
}

function lowerSkill(entry: SkillEntry, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: entry.id,
    family: 'skill',
    index,
    mergeSourceId: `skill:${entry.id}`,
    toolOwnerLabel: `skill:${entry.id}`,
    contribute: () => ({ skill: entry }),
  }
}

function lowerMemory(entry: MemoryEntry, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: entry.id,
    family: 'memory',
    index,
    mergeSourceId: `memory:${entry.id}`,
    toolOwnerLabel: undefined,
    // Memory contributes its context (reported through composition with
    // family 'memory') and a lifecycle binding. Its tools are opt-in via
    // `memory.asTools()` at the prompt level — nothing to merge or report.
    contribute: () => ({
      memory: entry,
      appendContexts: [entry.asContext()],
    }),
  }
}

function lowerThread(
  entry: ThreadHistoryEntry,
  index: number,
): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: entry.id,
    family: 'thread',
    index,
    mergeSourceId: `thread:${entry.id}`,
    toolOwnerLabel: undefined,
    contribute: () => ({ thread: entry }),
  }
}

function lowerBlackboard(entry: BlackboardEntry, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: entry.id,
    family: 'blackboard',
    index,
    mergeSourceId: `blackboard:${entry.id}`,
    toolOwnerLabel: `blackboard:${entry.id}`,
    contribute: () => ({
      blackboard: entry,
      appendContexts: [entry.asContext()],
      facts: {
        sourceId: `blackboard:${entry.id}`,
        injectableKind: 'blackboard',
        // Reported here; the actual merge happens in the blackboard collector
        // (`collectBlackboardTools`) so collisions are checked against the
        // full merged toolset, not just sibling entries.
        injectedTools: toolNames(entry.asTools()),
        injects: ['tools'],
      },
    }),
  }
}

function lowerInjectable(entry: InternalInjectableEntry, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: entry.id,
    family: injectableContributionKind(entry),
    index,
    mergeSourceId: entry.id,
    toolOwnerLabel: `contributor:${entry.id}`,
    contribute: async ({ input, promptId }) => {
      const injection = (await entry.inject({ input, promptId })) ?? {}
      return {
        use: injection.contexts ?? [],
        tools: injection.tools,
        toolMiddleware: injection.toolMiddleware,
        constraints: injection.constraints,
        guardrails: injection.guardrails,
        metadata: injection.metadata,
        facts: {
          sourceId: `injectable:${entry.id}`,
          injectableKind: injectableContributionKind(entry),
          injectedTools: toolNames(injection.tools),
          injects: injectionInjects(injection),
        },
      }
    },
  }
}

function lowerContributorEntry(entry: ContributorEntry<z.ZodType>, index: number): LoweredContributor {
  const kind = contributorContributionKind(entry)
  return {
    [CONTRIBUTOR]: true,
    id: entry.id,
    family: kind,
    index,
    mergeSourceId: entry.id,
    toolOwnerLabel: `contributor:${entry.id}`,
    gate: (input) => {
      if (!entry.when) return INCLUDED
      const source = `contributor:${entry.id}`
      if (!entry.when(input)) {
        const reason = 'when() predicate returned false'
        return {
          include: false,
          source,
          reason,
          steps: [
            {
              span: {
                name: entry.id,
                attributes: { contributorId: entry.id, source, predicate: 'when', included: false, reason },
              },
              artifact: {
                kind: 'context.contribution',
                state: 'checked-not-included',
                included: false,
                sourceId: source,
                injectableKind: kind,
                reason,
              },
            },
          ],
        }
      }
      return {
        include: true,
        steps: [
          {
            span: {
              name: entry.id,
              attributes: { contributorId: entry.id, source, predicate: 'when', included: true },
            },
          },
        ],
      }
    },
    children: () => entry.useEntries,
    contribute: async ({ input, promptId }) => {
      const result = (await entry.contribute({ input, promptId })) ?? {}
      const reenter = [...(result.contexts ?? []), ...(result.use ?? [])]
      return {
        use: reenter,
        tools: result.tools,
        toolSources: result.toolSources,
        toolMiddleware: result.toolMiddleware,
        constraints: result.constraints,
        guardrails: result.guardrails,
        metadata: result.metadata,
        facts: {
          sourceId: `contributor:${entry.id}`,
          injectableKind: kind,
          injectedTools: toolNames(result.tools),
          injects: injectionInjects(result),
        },
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// lowerEntry
// ─────────────────────────────────────────────────────────────────

/** Memoizes lowering per (entry, position) — entries are frozen, reusable values. */
const loweredCache = new WeakMap<object, Map<number, LoweredContributor>>()

/**
 * Lower a `use:` entry to the four-question contract.
 *
 * The one function in the codebase that knows the full entry union. Falsy
 * entries (the `flag && ctx` pattern) lower to `null` — the driver skips
 * them silently. Results are memoized per `(entry, index)` pair, so repeated
 * resolutions of the same prompt reuse lowered instances; lowering itself is
 * pure, with all input-dependent work deferred to `gate`/`contribute`.
 *
 * Dispatch precedence: custom contributor → private inject-shaped primitive
 * (duck-typed `inject`) → `_tag` families → plain context.
 */
export function lowerEntry(entry: ContextEntry, index: number): LoweredContributor | null {
  if (!entry) return null
  const cached = loweredCache.get(entry)?.get(index)
  if (cached) return cached
  const lowered = lowerEntryUncached(entry, index)
  let byIndex = loweredCache.get(entry)
  if (!byIndex) {
    byIndex = new Map()
    loweredCache.set(entry, byIndex)
  }
  byIndex.set(index, lowered)
  return lowered
}

function lowerEntryUncached(entry: NonNullable<Exclude<ContextEntry, false>>, index: number): LoweredContributor {
  if (isForcedOffload(entry)) {
    return lowerForcedOffload(entry, index)
  }
  if (isRepresentationLadder(entry)) {
    return lowerRepresentation(entry, index)
  }
  if (isContributorEntry(entry)) return lowerContributorEntry(entry, index)
  if (isInternalInjectableEntry(entry)) return lowerInjectable(entry, index)
  if (isToolSource(entry)) return lowerToolSource(entry, index)
  switch (entry._tag) {
    case 'HistoryRecent':
    case 'HistoryManaged':
      return lowerHistory(entry as HistoryProjection, index)
    case 'Skill':
      return lowerSkill(entry as SkillEntry, index)
    case 'Memory':
      return lowerMemory(entry as MemoryEntry, index)
    case 'Thread':
      return lowerThread(entry as ThreadHistoryEntry, index)
    case 'Blackboard':
      return lowerBlackboard(entry as BlackboardEntry, index)
    case 'MatchSpec':
      return lowerMatch(entry as MatchSpec, index)
    case 'ConditionalContext':
      return lowerConditional(entry as ConditionalContext<Context<z.ZodType>>, index)
    default:
      return lowerContext(entry as Context<z.ZodType>, index)
  }
}

function lowerForcedOffload(
  entry: ForcedOffload<unknown>,
  index: number,
): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: undefined,
    family: 'representation',
    index,
    mergeSourceId: `offload[${index}]`,
    toolOwnerLabel: undefined,
    representation: entry,
    contribute: () => ({ representations: [entry] }),
  }
}

function lowerRepresentation(
  ladder: RepresentationLadder,
  index: number,
): LoweredContributor {
  const compiled = compileRepresentationLadder(ladder)
  return {
    [CONTRIBUTOR]: true,
    id: compiled.primary.id,
    family: 'representation',
    index,
    mergeSourceId: compiled.primary.id
      ? `context:${compiled.primary.id}`
      : `context[${index}]`,
    toolOwnerLabel: undefined,
    representation: ladder,
    children: () => compiled.primarySources,
    contribute: () => ({ representations: [ladder] }),
  }
}

function lowerHistory(
  projection: HistoryProjection,
  index: number,
): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: undefined,
    family: 'history',
    index,
    mergeSourceId: `history[${index}]`,
    toolOwnerLabel: undefined,
    contribute: () => ({ history: projection }),
  }
}

function lowerToolSource(source: ToolSource, index: number): LoweredContributor {
  return {
    [CONTRIBUTOR]: true,
    id: source.id,
    family: 'tool-source',
    index,
    mergeSourceId: `tool-source:${source.id}`,
    toolOwnerLabel: undefined,
    contribute: () => ({ toolSources: [source] }),
  }
}
