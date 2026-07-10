import type { z } from 'zod'
import { getInputShapeKeys } from './schema-shape'
import type { ContextEntry, Contribution, ContributorEntry } from './context-types'

/**
 * Configuration for {@link contributor}.
 *
 * @template TInput - Zod object schema declaring the input fields this
 * contributor reads. Declared fields merge into the prompt's input schema as
 * required keys (conflicting keys across entries throw at `prompt()` time).
 */
export interface ContributorConfig<TInput extends z.ZodType = z.ZodType> {
  /**
   * Unique identifier. Appears in observability artifacts
   * (`contributor:<id>`), exclusion records, and tool-collision errors.
   */
  id: string
  /** Input fields this contributor reads, merged into the prompt's input schema. */
  input?: TInput
  /**
   * Gate evaluated against the merged input at resolve time. Return `false`
   * to exclude the contributor entirely — `contribute()` is not called,
   * nested `use` entries are not resolved, and the exclusion is recorded
   * with its reason for inspection and devtools.
   *
   * Must be synchronous and side-effect free. A contributor that needs I/O
   * to decide should decide inside `contribute()` and return `{}`.
   */
  when?: (input: z.infer<TInput> & Record<string, unknown>) => boolean
  /**
   * Entries this contributor bundles, resolved BEFORE its own contribution —
   * the same nesting semantics as a context's `use:` array. Accepts any
   * entry kind: contexts, skills, memories, blackboards, other contributors.
   */
  use?: readonly ContextEntry[]
  /**
   * Produce this contributor's contribution. The only place I/O may happen.
   *
   * Returned `contexts`/`use` entries re-enter the pipeline (gated and
   * recursive); `tools` merge with collision detection; `constraints`,
   * `guardrails`, and `metadata` land on the resolved prompt.
   */
  contribute(args: {
    input: z.infer<TInput> & Record<string, unknown>
    promptId?: string
  }): Contribution | Promise<Contribution>
}

/**
 * Create a custom prompt contributor — a first-class `use:` entry that can
 * gate itself, bundle nested entries, and write to every prompt channel.
 *
 * Built-in factories (`memory()`, `skill()`, `retriever().asContext()`) lower
 * through the same resolver contract, while application code should use this
 * single custom-entry primitive for prompt-time composition.
 *
 * @example Feature-flagged tool surface with bundled retrieval
 * ```ts
 * const supportTools = contributor({
 *   id: 'support-tools',
 *   input: z.object({ plan: z.string() }),
 *   when: (input) => input.plan !== 'free',
 *   use: [docsRetriever.asContext({ topK: 4 })],
 *   contribute: async ({ input }) => ({
 *     tools: await loadSupportTools(input.plan),
 *     metadata: { supportTier: input.plan },
 *   }),
 * })
 *
 * const reply = prompt({
 *   id: 'support-reply',
 *   use: [brandVoice, supportTools],
 *   system: 'You are a support agent.',
 * })
 * ```
 *
 * @returns A frozen {@link ContributorEntry}.
 */
export function contributor<TInput extends z.ZodType>(config: ContributorConfig<TInput>): ContributorEntry<TInput> {
  if (!config.id.trim()) {
    throw new Error('contributor(): id must be non-empty.')
  }

  const inputKeys: string[] = []
  if (config.input) {
    inputKeys.push(...getInputShapeKeys(config.input))
  }

  const contribute = config.contribute as ContributorEntry<TInput>['contribute']

  return Object.freeze({
    _tag: 'Contributor' as const,
    id: config.id,
    inputSchema: config.input,
    inputKeys: Object.freeze(inputKeys),
    when: config.when as ContributorEntry<TInput>['when'],
    useEntries: Object.freeze([...(config.use ?? [])]),
    contribute,
  })
}

/** Runtime check for entries created by {@link contributor}. */
export function isContributorEntry(value: unknown): value is ContributorEntry<z.ZodType> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { _tag?: unknown })._tag === 'Contributor' &&
    typeof (value as { contribute?: unknown }).contribute === 'function'
  )
}
