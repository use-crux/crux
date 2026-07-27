import type { BoundaryDef, SafetyTargetId } from './boundary'
import { isMediaSafetyTargetId, selectedPath } from './boundary'
import { SafetyConfigError } from './errors'
import type { Constraint } from './constraint/types'
import { assertConstraintBoundary } from './constraint/boundary'
import type { Guardrail } from './guardrail/types'
import type { SafetyTuneOptions, SafetyTunePolicyOptions } from './tune'
import { validateSafetyTuneOptions } from './tune'
import { applyBindingApplicability, type SafetyBindingApplicability } from './applicability'

export type SafetyPolicyKind = 'guardrail' | 'constraint' | 'toolPolicy'
export type SafetyPolicyScope = 'global' | 'prompt' | 'call'

type PolicySource =
  | {
      readonly kind: 'guardrail'
      readonly policy: Guardrail
      readonly scope: SafetyPolicyScope
    }
  | {
      readonly kind: 'constraint'
      readonly policy: Constraint
      readonly scope: SafetyPolicyScope
    }
interface SafetyBindingBase {
  readonly boundary: BoundaryDef
  readonly scope: SafetyPolicyScope
  readonly mode: 'enforce' | 'report'
  readonly enabled: boolean
  /** Safe explanation when a global binding cannot run for this primitive. */
  readonly dormantReason?: string
  readonly tuned?: readonly ('mode' | 'enabled')[]
}

/** One guardrail attached to one exact boundary with its effective posture. */
export interface GuardrailBinding extends SafetyBindingBase {
  readonly kind: 'guardrail'
  readonly policy: Guardrail
}

/** One constraint attached to one exact boundary with its effective posture. */
export interface ConstraintBinding extends SafetyBindingBase {
  readonly kind: 'constraint'
  readonly policy: Constraint
}

export type SafetyBinding = GuardrailBinding | ConstraintBinding

export interface SafetyRegistry {
  readonly bindings: readonly SafetyBinding[]
  bindingsFor(targetId: SafetyTargetId): readonly SafetyBinding[]
}

export interface BuildSafetyRegistryOptions {
  readonly global?: {
    readonly guardrails?: readonly Guardrail[]
    readonly constraints?: readonly Constraint[]
  }
  readonly prompt?: {
    readonly guardrails?: readonly Guardrail[]
    readonly constraints?: readonly Constraint[]
  }
  readonly call?: {
    readonly guardrails?: readonly Guardrail[]
    readonly constraints?: readonly Constraint[]
  }
  readonly tune?: SafetyTuneOptions
  /** @internal Primitive-owned classification applied after all registry validation. */
  readonly applicability?: SafetyBindingApplicability
}

/** Build the effective per-call safety registry without applying precedence. */
export function buildSafetyRegistry(options: BuildSafetyRegistryOptions): SafetyRegistry {
  const sources = collectSources(options)
  assertUniquePolicyIds(sources)
  assertValidConstraintBoundaries(sources)
  assertValidGuardrailBoundaryFamilies(sources)

  const tune = validateSafetyTuneOptions(
    options.tune,
    new Set(sources.map((source) => source.policy.id)),
  )

  const expanded = sources.flatMap((source) => expandBindings(source, tune[source.policy.id]))
  const bindings = options.applicability
    ? expanded.map((binding) => applyBindingApplicability(binding, options.applicability!))
    : expanded
  return {
    bindings,
    bindingsFor(targetId) {
      return bindings.filter((binding) => binding.boundary.id === targetId)
    },
  }
}

function assertValidConstraintBoundaries(sources: readonly PolicySource[]): void {
  for (const source of sources) {
    if (source.kind === 'constraint') assertConstraintBoundary(source.policy)
  }
}

function collectSources(options: BuildSafetyRegistryOptions): readonly PolicySource[] {
  return [
    ...guardrailSources('global', options.global?.guardrails),
    ...constraintSources('global', options.global?.constraints),
    ...guardrailSources('prompt', options.prompt?.guardrails),
    ...constraintSources('prompt', options.prompt?.constraints),
    ...guardrailSources('call', options.call?.guardrails),
    ...constraintSources('call', options.call?.constraints),
  ]
}

function guardrailSources(
  scope: SafetyPolicyScope,
  policies: readonly Guardrail[] | undefined,
): readonly PolicySource[] {
  return (policies ?? []).map((policy) => ({ scope, kind: 'guardrail' as const, policy }))
}

function constraintSources(
  scope: SafetyPolicyScope,
  policies: readonly Constraint[] | undefined,
): readonly PolicySource[] {
  return (policies ?? []).map((policy) => ({ scope, kind: 'constraint' as const, policy }))
}

function assertUniquePolicyIds(sources: readonly PolicySource[]): void {
  const seen = new Map<string, PolicySource[]>()
  for (const source of sources) {
    const existing = seen.get(source.policy.id) ?? []
    existing.push(source)
    seen.set(source.policy.id, existing)
  }

  for (const [id, duplicates] of seen) {
    if (duplicates.length < 2) continue
    throw new SafetyConfigError({
      message: `Duplicate safety policy id "${id}". Rename one policy or attach one policy to multiple boundaries.`,
      duplicateId: id,
      kinds: duplicates.map((source) => source.kind),
      boundaries: duplicates.flatMap((source) => boundariesFor(source.policy).map((entry) => entry.id)),
      scopes: duplicates.map((source) => source.scope),
    })
  }
}

function assertValidGuardrailBoundaryFamilies(sources: readonly PolicySource[]): void {
  for (const source of sources) {
    if (source.kind !== 'guardrail') continue
    const boundaries = boundariesFor(source.policy)
    const problem = guardrailBoundaryFamilyProblem(boundaries)
    if (!problem) continue
    const ids = boundaries.map((boundary) => boundary.id)
    throw new SafetyConfigError({
      message:
        `Safety policy "${source.policy.id}" mixes incompatible boundary families ` +
        `(${boundaries.map(bindingIdentity).join(', ')}). ${problem}`,
      boundaries: ids,
      kinds: [source.kind],
      scopes: [source.scope],
    })
  }
}

function guardrailBoundaryFamilyProblem(
  boundaries: readonly BoundaryDef[],
): string | undefined {
  if (
    boundaries.some((boundary) => isMediaSafetyTargetId(boundary.id)) &&
    !boundaries.every((boundary) => isMediaSafetyTargetId(boundary.id))
  ) {
    return 'A media guardrail can target only media boundaries.'
  }
  if (
    boundaries.some(isRootToolDefinitionBoundary) &&
    !boundaries.every(isRootToolDefinitionBoundary)
  ) {
    return 'A root tool-definition guardrail can target only root tool definitions.'
  }
  if (
    boundaries.some(isToolDescriptionBoundary) &&
    !boundaries.every(isToolDescriptionCompatibleBoundary)
  ) {
    return 'A tool-description guardrail can target only closed string boundaries.'
  }
  if (
    boundaries.some((boundary) => boundary.id === 'memory.write') &&
    !boundaries.every((boundary) => boundary.id === 'memory.write')
  ) {
    return 'A memory-write guardrail can target only memory-write boundaries.'
  }
  return undefined
}

function isRootToolDefinitionBoundary(boundary: BoundaryDef): boolean {
  return boundary.id === 'model.input.tools' && boundary.selector !== 'descriptions'
}

function isToolDescriptionBoundary(boundary: BoundaryDef): boolean {
  return boundary.id === 'model.input.tools' && boundary.selector === 'descriptions'
}

function isToolDescriptionCompatibleBoundary(boundary: BoundaryDef): boolean {
  return (
    isToolDescriptionBoundary(boundary) ||
    boundary.id === 'model.input.text' ||
    boundary.id === 'model.instructions' ||
    boundary.id === 'model.output.text' ||
    boundary.id === 'validation.feedback'
  )
}

function expandBindings(
  source: PolicySource,
  tune: SafetyTunePolicyOptions | undefined,
): readonly SafetyBinding[] {
  const boundaries = boundariesFor(source.policy)
  assertUniqueBoundaries(source.policy.id, boundaries)
  const tuned = tunedFields(tune)

  if (source.kind === 'guardrail') {
    return boundaries.map((boundary): GuardrailBinding => ({
      kind: 'guardrail',
      policy: source.policy,
      boundary,
      scope: source.scope,
      mode: tune?.mode ?? source.policy.mode,
      enabled: tune?.enabled ?? true,
      ...(tuned.length > 0 ? { tuned } : {}),
    }))
  }

  return boundaries.map((boundary): ConstraintBinding => ({
    kind: 'constraint',
    policy: source.policy,
    boundary,
    scope: source.scope,
    mode: tune?.mode ?? 'enforce',
    enabled: tune?.enabled ?? true,
    ...(tuned.length > 0 ? { tuned } : {}),
  }))
}

function boundariesFor(policy: Guardrail | Constraint): readonly BoundaryDef[] {
  return Array.isArray(policy.on) ? policy.on : [policy.on]
}

function assertUniqueBoundaries(policyId: string, boundaries: readonly BoundaryDef[]): void {
  const seen = new Set<string>()
  for (const boundary of boundaries) {
    const key = bindingIdentity(boundary)
    if (seen.has(key)) {
      throw new SafetyConfigError({
        message: `Safety policy "${policyId}" attaches to boundary "${key}" more than once.`,
      })
    }
    seen.add(key)
  }
}

function bindingIdentity(boundary: BoundaryDef): string {
  return [boundary.id, selectedPath(boundary), boundary.selector]
    .filter((part): part is string => part !== undefined)
    .join(':')
}

function tunedFields(tune: SafetyTunePolicyOptions | undefined): readonly ('mode' | 'enabled')[] {
  if (!tune) return []
  return (['mode', 'enabled'] as const).filter((field) => tune[field] !== undefined)
}
