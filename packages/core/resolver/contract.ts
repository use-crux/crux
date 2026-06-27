/**
 * The internal contributor contract behind prompt resolution.
 *
 * Every entry in a prompt's `use:` array — plain contexts, `when()` wrappers,
 * `match()` specs, skills, memories, blackboards, injectables, and custom
 * `contributor()` entries — lowers to a single {@link LoweredContributor}
 * that answers up to four questions:
 *
 * 1. **gate** — should this entry participate for the current input? (sync, no I/O)
 * 2. **children** — which entries does it nest, resolved before itself? (sync)
 * 3. **contribute** — what does it add to the prompt? (async; the only I/O point)
 * 4. **shape** — what does it contribute at definition time? (covered by
 *    {@link SchemaContribution}, collected via `collectSchemaContributions`)
 *
 * The driver in `./driver.ts` is the primary consumer. It knows nothing
 * about the entry union — `lowerEntry()` in `./lower.ts` is the single place
 * that does.
 *
 * This contract is exported from `@use-crux/core` as **advanced API** for
 * adapter and primitive authors (see use-crux/crux#29). Application code
 * composes entries with the public factories (`context()`, `memory()`,
 * `skill()`, `contributor()`, …) and never touches lowered contributors
 * directly.
 *
 * @module
 */

import type { z } from 'zod'
import type {
  AnyToolSet,
  BlackboardEntry,
  Context,
  ContextEntry,
  ContextTextSegment,
  MemoryEntry,
  SkillEntry,
} from '../types'
import type { ExcludedContext } from './types'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type {
  CruxContextContributionPreview,
  CruxContextInjectableKind,
  CruxContextInjects,
} from '../observability/contract'

/**
 * Brand for lowered contributors. A symbol (not a string tag) so that no
 * user-constructed object can accidentally satisfy the contract structurally.
 */
export const CONTRIBUTOR: unique symbol = Symbol.for('crux.resolver.contributor')

/**
 * A context system contribution after string/segment normalization.
 *
 * `segments` and the token split are present when the source produced
 * segmented content (or segments could be inferred from input values);
 * plain static strings resolve to just `text`.
 */
export interface ResolvedSystemContent {
  text: string
  segments?: readonly ContextTextSegment[]
  staticTokens?: number
  dynamicTokens?: number
}

/**
 * Observability facts for one inclusion decision.
 *
 * The driver emits each step as a `context.predicate` span; when `artifact`
 * is present it is emitted inside that span as a `context.contribution`
 * artifact (with the produced-edge wiring handled by the observability port's
 * adapter). Contributors *describe* what happened; they never talk to the
 * observability runtime themselves.
 */
export interface InclusionStep {
  span: {
    /** Span name — the entry id when present, else a positional label like `context[2]`. */
    name: string
    /** Span attributes, e.g. `{ source, predicate: 'when', included: false, reason }`. */
    attributes: Record<string, unknown>
  }
  /** Contribution artifact to emit inside the span (exclusions and match selections). */
  artifact?: CruxContextContributionPreview
}

/**
 * Answer to the gate question: does this entry participate for this input?
 *
 * Gates are synchronous and side-effect free — an entry that needs I/O to
 * decide must decide inside `contribute()` and return an empty contribution
 * (losing the exclusion-reason artifact, by design).
 *
 * On exclusion, `source` and `reason` become the `ExcludedContext` entry
 * verbatim — these strings are pinned by characterization tests and must not
 * drift. On inclusion, `children` optionally overrides the static
 * `children()` answer; `match()` uses this so its discriminator runs exactly
 * once per resolution.
 */
export type GateResult =
  | { include: true; steps?: readonly InclusionStep[]; children?: readonly ContextEntry[] }
  | { include: false; source: string; reason: string; steps?: readonly InclusionStep[] }

/**
 * Observability facts for a non-context contribution (tools, injected
 * channels). Emitted once by the driver after the contribution is merged —
 * the single replacement for the hand-rolled `emitDirectToolContribution`
 * call sites that previously drifted per family.
 */
export interface ContributionFacts {
  /** Artifact source id, e.g. `injectable:docs`, `memory:chat`, `blackboard:plan`. */
  sourceId: string
  /** Family classification for devtools grouping. */
  injectableKind: CruxContextInjectableKind
  /** Names of tools this entry injected, when any. */
  injectedTools?: readonly string[]
  /** Channels this entry wrote to (`system`, `tools`, `constraints`, `guardrails`). */
  injects?: readonly CruxContextInjects[]
}

/**
 * What one contributor adds to the prompt being resolved.
 *
 * Channel semantics (all optional — an empty object is a valid contribution):
 *
 * - `contexts` — appended to the active context list as-is. The entry's own
 *   gate already ran; these are NOT re-gated. Used by plain contexts.
 * - `appendContexts` — run through the full context-appending logic (its own
 *   `when` gate, nested `use` entries) at this entry's position. Used by
 *   memory/blackboard `asContext()` expansion.
 * - `use` — full pipeline re-entry: gated, recursive, with fresh positional
 *   indices. Used by injectables and custom contributors.
 * - `tools` — merged with collision detection attributed to this entry.
 * - `memory` / `skill` / `blackboard` — collected for the adapter layer
 *   (memory bindings) and the two cross-entry collectors (skill index/tools,
 *   blackboard tool dedupe), which run once after all entries merge.
 * - `facts` — emitted as a contribution artifact after merging.
 */
export interface Contribution {
  contexts?: readonly Context<z.ZodType>[]
  appendContexts?: readonly Context<z.ZodType>[]
  use?: readonly ContextEntry[]
  tools?: AnyToolSet
  constraints?: readonly Constraint[]
  guardrails?: readonly Guardrail[]
  metadata?: Readonly<Record<string, unknown>>
  memory?: MemoryEntry
  skill?: SkillEntry
  blackboard?: BlackboardEntry
  facts?: ContributionFacts
}

/** Arguments passed to `contribute()` — the resolved input and the owning prompt's id. */
export interface ContributeArgs {
  input: Record<string, unknown>
  promptId?: string
}

/**
 * One entry's input-schema contribution, collected at definition time.
 *
 * Replaces the previous "shadow walk" (`extractAllContexts`) that fabricated
 * fake `Context` objects to smuggle injectable schemas into schema merging.
 * `optional: true` marks entries that may not participate at resolve time
 * (conditional contexts, match branches) — their keys merge as `.optional()`.
 *
 * The flat collection order is part of the contract: anonymous entries are
 * attributed as `context[<flat index>]` in conflict errors.
 */
export interface SchemaContribution {
  id: string | undefined
  schema: z.ZodType | undefined
  optional: boolean
}

/**
 * A `use:` entry lowered to the four-question contract.
 *
 * Produced exclusively by `lowerEntry()`; consumed exclusively by the driver.
 * All methods are optional — a contributor that answers no questions is a
 * no-op (e.g. a falsy entry lowers to `null` instead).
 */
export interface LoweredContributor {
  readonly [CONTRIBUTOR]: true
  /** The entry's declared id, when it has one. */
  readonly id: string | undefined
  /** Family classification (`context`, `match`, `skill`, `memory`, …). */
  readonly family: CruxContextInjectableKind | (string & {})
  /** Position of the entry in its `use:` array — used for positional source labels. */
  readonly index: number
  /**
   * Source id used to attribute tool-name collisions from this entry's own
   * tools and its nested entries' tools.
   */
  readonly mergeSourceId: string
  gate?(input: Record<string, unknown>): GateResult
  children?(input: Record<string, unknown>): readonly ContextEntry[]
  contribute?(args: ContributeArgs): Contribution | Promise<Contribution>
}

/**
 * The merged result of resolving a `use:` array — the exact shape the rest
 * of the pipeline (system composition, tool merging, lifecycle binding)
 * consumes. Field-for-field compatible with the legacy
 * `resolveContextEntries` return value.
 */
export interface MergedResolution {
  active: Context<z.ZodType>[]
  excluded: ExcludedContext[]
  skills: SkillEntry[]
  memories: MemoryEntry[]
  blackboards: BlackboardEntry[]
  tools: AnyToolSet
  constraints: Constraint[]
  guardrails: Guardrail[]
  metadata: Record<string, unknown>
}

/** Create an empty {@link MergedResolution} accumulator. */
export function emptyMergedResolution(): MergedResolution {
  return {
    active: [],
    excluded: [],
    skills: [],
    memories: [],
    blackboards: [],
    tools: {},
    constraints: [],
    guardrails: [],
    metadata: {},
  }
}
