import type { BoundaryDef, SafetyTargetId } from './boundary'
import { SafetyConfigError } from './errors'
import type { Constraint } from './constraint/types'
import type { Guardrail } from './guardrail/types'
import type { SafetyTuneOptions, SafetyTunePolicyOptions } from './tune'
import { validateSafetyTuneOptions } from './tune'

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
  | {
      readonly kind: 'toolPolicy'
      readonly policy: never
      readonly scope: SafetyPolicyScope
    }

export interface SafetyBinding<TPolicy = Guardrail | Constraint> {
  readonly kind: SafetyPolicyKind
  readonly policy: TPolicy
  readonly boundary: BoundaryDef
  readonly scope: SafetyPolicyScope
  readonly mode: 'enforce' | 'report'
  readonly enabled: boolean
  readonly tuned?: readonly ('mode' | 'stream' | 'enabled')[]
}

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
}

/** Build the effective per-call safety registry without applying precedence. */
export function buildSafetyRegistry(options: BuildSafetyRegistryOptions): SafetyRegistry {
  const sources = collectSources(options)
  assertUniquePolicyIds(sources)

  const tune = validateSafetyTuneOptions(
    options.tune,
    new Set(sources.map((source) => source.policy.id)),
  )

  const bindings = sources.flatMap((source) => expandBindings(source, tune[source.policy.id]))
  return {
    bindings,
    bindingsFor(targetId) {
      return bindings.filter((binding) => binding.boundary.id === targetId)
    },
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

function expandBindings(
  source: PolicySource,
  tune: SafetyTunePolicyOptions | undefined,
): readonly SafetyBinding[] {
  const boundaries = boundariesFor(source.policy)
  assertUniqueBoundaries(source.policy.id, boundaries)
  const tuned = tunedFields(tune)

  return boundaries.map((boundary) => ({
    kind: source.kind,
    policy: source.policy,
    boundary,
    scope: source.scope,
    mode: tune?.mode ?? (source.kind === 'guardrail' ? source.policy.mode : 'enforce'),
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
    const key = boundary.path ? `${boundary.id}:${boundary.path}` : boundary.id
    if (seen.has(key)) {
      throw new SafetyConfigError({
        message: `Safety policy "${policyId}" attaches to boundary "${key}" more than once.`,
      })
    }
    seen.add(key)
  }
}

function tunedFields(tune: SafetyTunePolicyOptions | undefined): readonly ('mode' | 'stream' | 'enabled')[] {
  if (!tune) return []
  return (['mode', 'stream', 'enabled'] as const).filter((field) => tune[field] !== undefined)
}
