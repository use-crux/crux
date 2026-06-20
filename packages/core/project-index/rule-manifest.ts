/**
 * Project Index rule manifest contracts.
 *
 * Rule manifests make cost and evidence requirements explicit before a rule
 * runs. Index hosts use this metadata to decide whether a rule can execute
 * with the facts available in the current analysis phase.
 *
 * @module
 */

import { z } from 'zod'

/** Project Index phase that owns a rule's required evidence. */
export type IndexRulePhase = 'syntax' | 'index' | 'semantic' | 'runtime' | 'quality'

/** Durable Project Index fact kinds a rule may depend on. */
export type IndexFactKind =
  | 'prompts'
  | 'contexts'
  | 'tools'
  | 'lint'
  | 'definitions'
  | 'relations'
  | 'sourceRefs'
  | 'diagnostics'
  | 'lintFindings'
  | 'ruleDescriptors'
  | 'sources'
  | 'sourceGraph'

/** Policy tier describing how strongly a rule can trust its evidence. */
export type IndexRuleFidelity = 'safe' | 'best-effort' | 'runtime'

/** Default severity for lint findings emitted by a rule. */
export type IndexRuleSeverity = 'info' | 'warning' | 'error'

/** Optional execution budget advertised by a rule manifest. */
export interface IndexRuleBudget {
  /** Maximum source files the rule expects to inspect. */
  readonly maxFiles?: number
  /** Maximum fact count the rule expects to inspect. */
  readonly maxFacts?: number
  /** Maximum wall-clock time the host should budget for the rule. */
  readonly maxMillis?: number
}

/**
 * Serializable rule declaration used by hosts, devtools, and docs.
 *
 * The generic parameter preserves the literal type of `defaultOptions` for
 * authoring helpers while keeping the runtime manifest JSON-safe.
 */
export interface IndexRuleManifest<TOptions = unknown> {
  /** Stable rule id used in configuration, diagnostics, and docs. */
  readonly id: string
  /** Human-facing docs and recommendation metadata. */
  readonly docs: {
    /** Short description shown in rule catalogs. */
    readonly description: string
    /** Whether the rule belongs in the recommended profile by default. */
    readonly recommended?: boolean
    /** Optional canonical docs URL. */
    readonly url?: string
  }
  /** Analysis phase required before this rule can run. */
  readonly phase: IndexRulePhase
  /** Fact kinds the rule reads from the Project Index. */
  readonly requires: readonly IndexFactKind[]
  /** Evidence fidelity policy for rule output. */
  readonly fidelity: IndexRuleFidelity
  /** Default severity for findings emitted by this rule. */
  readonly defaultSeverity: IndexRuleSeverity
  /** JSON Schema for rule options, when configurable. */
  readonly schema?: unknown
  /** Default options used when project config does not override the rule. */
  readonly defaultOptions?: TOptions
  /** Optional host-enforced execution budget. */
  readonly budget?: IndexRuleBudget
}

/** Runtime schema for rule analysis phases. */
export const IndexRulePhaseSchema = z.enum(['syntax', 'index', 'semantic', 'runtime', 'quality'])

/** Runtime schema for durable rule fact dependencies. */
export const IndexFactKindSchema = z.enum([
  'prompts',
  'contexts',
  'tools',
  'lint',
  'definitions',
  'relations',
  'sourceRefs',
  'diagnostics',
  'lintFindings',
  'ruleDescriptors',
  'sources',
  'sourceGraph',
])

/** Runtime schema for rule evidence fidelity. */
export const IndexRuleFidelitySchema = z.enum(['safe', 'best-effort', 'runtime'])

/** Runtime schema for rule execution budgets. */
export const IndexRuleBudgetSchema = z.object({
  maxFiles: z.number().optional(),
  maxFacts: z.number().optional(),
  maxMillis: z.number().optional(),
}) satisfies z.ZodType<IndexRuleBudget>

/** Runtime schema for serializable rule manifests. */
export const IndexRuleManifestSchema = z.object({
  id: z.string(),
  docs: z.object({
    description: z.string(),
    recommended: z.boolean().optional(),
    url: z.string().optional(),
  }),
  phase: IndexRulePhaseSchema,
  requires: z.array(IndexFactKindSchema),
  fidelity: IndexRuleFidelitySchema,
  defaultSeverity: z.enum(['info', 'warning', 'error']),
  schema: z.unknown().optional(),
  defaultOptions: z.unknown().optional(),
  budget: IndexRuleBudgetSchema.optional(),
}) satisfies z.ZodType<IndexRuleManifest>
