import type {
  InjectionUseFacts,
  ProjectDefinition,
  ProjectDefinitionKind,
} from '@use-crux/core/project-index'
import { factsUseEntries, relationHintForTarget, safeUseEntryId } from '../static/use-entry-helpers'

/** Exact variable rule for resolving runtime `use` entries to ambient Project Index targets. */
export interface RuntimeUseTargetExactRule {
  /** Authored runtime variable, for example `tools` or `blackboard`. */
  readonly variable: string
  /** Candidate definition ids accepted for this variable. Omit to match by kind and aliases only. */
  readonly targetDefinitionIds?: readonly string[]
  /** Candidate definition names or export names accepted for this variable. */
  readonly targetNames?: readonly string[]
  /** Target kinds accepted for this variable. */
  readonly targetKinds?: readonly ProjectDefinitionKind[]
  /** Require normalized context tool facts before a `context` candidate can match. */
  readonly requireToolFacts?: boolean
}

/** Suffix-owner rule for variables such as `session.memory` or `project.retriever`. */
export interface RuntimeUseTargetSuffixRule {
  /** Authored suffix that leaves the owner expression before it, for example `.memory`. */
  readonly suffix: string
  /** Target kinds accepted for this suffix. */
  readonly targetKinds: readonly ProjectDefinitionKind[]
  /** Extra aliases by normalized owner id. */
  readonly ownerAliases?: Readonly<Record<string, readonly string[]>>
  /** Require normalized context tool facts before a `context` candidate can match. */
  readonly requireToolFacts?: boolean
}

/**
 * Data contract for runtime `use` target matching.
 *
 * The resolver applies exact rules before suffix rules, then falls back to direct stable-name
 * matching. Product-specific ids belong in this data, not in relation resolver code.
 */
export interface RuntimeUseTargetRules {
  readonly exact?: readonly RuntimeUseTargetExactRule[]
  readonly suffix?: readonly RuntimeUseTargetSuffixRule[]
}

/** Generic Crux runtime target rules used when no profile-specific rules are supplied. */
export const defaultRuntimeUseTargetRules = {
  exact: [
    { variable: 'tools', targetKinds: ['context'], requireToolFacts: true },
    { variable: 'blackboard', targetKinds: ['blackboard'] },
  ],
  suffix: [
    { suffix: '.tools', targetKinds: ['context'], requireToolFacts: true },
    {
      suffix: '.memory',
      targetKinds: ['memory'],
      ownerAliases: { episodic: ['episodes', 'user-episodes'] },
    },
    { suffix: '.retriever', targetKinds: ['rag.retriever'] },
  ],
} as const satisfies RuntimeUseTargetRules

/**
 * Mirrors runtime-use graph targets into definition metadata.
 *
 * Runtime prepare entries can reference ambient resources without import bindings. The supplied rule
 * data maps those authored variables to safe Project Index targets while keeping product ids outside
 * the resolver implementation.
 */
export function withResolvedRuntimeUseEntryTargets(
  definitions: readonly ProjectDefinition[],
  rules: RuntimeUseTargetRules = defaultRuntimeUseTargetRules,
): ProjectDefinition[] {
  const runtimeTargets = definitions.filter(isRuntimeUseTarget)
  if (runtimeTargets.length === 0) return [...definitions]

  return definitions.map((definition) => {
    const entries = factsUseEntries(definition)
    if (entries.length === 0) return definition
    const enriched = entries.map((entry) => {
      if (entry.targetDefinitionId || entry.via !== 'runtime') return entry
      const target = runtimeUseEntryTarget(entry, runtimeTargets, rules)
      if (!target) return entry
      return {
        ...entry,
        relationHint: relationHintForTarget(target.kind) ?? entry.relationHint,
        targetDefinitionId: target.id,
        targetKind: target.kind,
        targetName: target.name,
        relationType: runtimeUseRelationType(definition.kind, target.kind),
        relationFidelity: 'partial',
      } satisfies InjectionUseFacts
    })
    if (enriched.every((entry, index) => entry === entries[index])) return definition
    return {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        facts: {
          ...(definition.metadata?.facts ?? {}),
          useEntries: enriched,
        } as NonNullable<ProjectDefinition['metadata']>['facts'],
      },
    }
  })
}

/** Runtime use entries can only target definitions that are safe ambient resources. */
function isRuntimeUseTarget(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'memory' ||
    definition.kind === 'blackboard' ||
    definition.kind === 'rag.retriever' ||
    (definition.kind === 'context' && definitionHasToolFacts(definition))
  )
}

/** Tool-context definitions are identified from normalized static facts, not naming alone. */
function definitionHasToolFacts(definition: ProjectDefinition): boolean {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('tools' in facts)) return false
  const tools = (facts as { tools?: { hasTools?: unknown } }).tools
  return tools?.hasTools === true
}

function runtimeUseEntryTarget(
  entry: InjectionUseFacts,
  runtimeTargets: readonly ProjectDefinition[],
  rules: RuntimeUseTargetRules,
): ProjectDefinition | undefined {
  if (!entry.variable) return undefined
  const variable = entry.variable

  for (const rule of rules.exact ?? []) {
    if (rule.variable !== variable) continue
    const target = runtimeTargets.find((definition) => targetMatchesExactRule(definition, rule))
    if (target) return target
  }

  for (const rule of rules.suffix ?? []) {
    if (!variable.endsWith(rule.suffix)) continue
    const owner = variable.slice(0, -rule.suffix.length)
    const aliases = ownerAliases(owner, rule.ownerAliases)
    const target = runtimeTargets.find((definition) => targetMatchesSuffixRule(definition, rule, aliases))
    if (target) return target
  }

  return runtimeTargets.find(
    (definition) =>
      variable === definition.name ||
      variable === definition.metadata?.exportName ||
      definition.id.endsWith(`:${safeUseEntryId(variable)}`),
  )
}

function targetMatchesExactRule(definition: ProjectDefinition, rule: RuntimeUseTargetExactRule): boolean {
  if (!targetHasAllowedKind(definition, rule.targetKinds)) return false
  if (rule.requireToolFacts && !definitionHasToolFacts(definition)) return false
  if (rule.targetDefinitionIds?.includes(definition.id)) return true
  if (rule.targetNames?.some((name) => definition.name === name || definition.metadata?.exportName === name)) {
    return true
  }
  return !rule.targetDefinitionIds && !rule.targetNames
}

function targetMatchesSuffixRule(
  definition: ProjectDefinition,
  rule: RuntimeUseTargetSuffixRule,
  aliases: readonly string[],
): boolean {
  if (!targetHasAllowedKind(definition, rule.targetKinds)) return false
  if (rule.requireToolFacts && !definitionHasToolFacts(definition)) return false
  return aliases.some(
    (alias) =>
      definition.id.endsWith(`:${alias}`) ||
      definition.id.toLowerCase().includes(alias) ||
      definition.name.toLowerCase().includes(alias) ||
      definition.metadata?.exportName === alias,
  )
}

function targetHasAllowedKind(
  definition: ProjectDefinition,
  allowedKinds: readonly ProjectDefinitionKind[] | undefined,
): boolean {
  return !allowedKinds || allowedKinds.includes(definition.kind)
}

function ownerAliases(owner: string, extra: Readonly<Record<string, readonly string[]>> | undefined): readonly string[] {
  const normalized = safeUseEntryId(owner).toLowerCase()
  return [normalized, ...(extra?.[normalized] ?? [])]
}

/** Runtime use-entry matches produce partial graph knowledge until semantic analysis confirms them. */
function runtimeUseRelationType(ownerKind: ProjectDefinitionKind, targetKind: ProjectDefinitionKind): string {
  if (targetKind === 'memory') return `${ownerKind}.uses_memory`
  if (targetKind === 'blackboard') return `${ownerKind}.uses_blackboard`
  if (targetKind === 'injectable') return `${ownerKind}.uses_injectable`
  return `${ownerKind}.uses_context`
}
