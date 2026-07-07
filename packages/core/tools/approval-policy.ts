/**
 * Tool approval policy declarations and resolution.
 *
 * Tools do not carry approval policy. Instead, policy is declared where tools
 * are composed: context, prompt, or call site. This module owns the small,
 * deterministic resolver that turns those declarations into the effective
 * policy for one tool call.
 *
 * @module
 */

/** Runtime context passed to function-form tool approval policies. */
export interface ToolApprovalContext<TInput = unknown, TRuntimeContext = unknown> {
  /** Tool name being evaluated. */
  readonly toolName: string
  /** Provider or SDK tool-call id for this invocation. */
  readonly toolCallId: string
  /** Tool input arguments for this invocation. */
  readonly input: TInput
  /** Per-call runtime context. Phase 7 gives this a precise inferred type. */
  readonly runtimeContext: TRuntimeContext
  /** Canonical message history visible to the approval policy, when available. */
  readonly messages?: readonly unknown[]
}

/** Policy for deciding whether a tool call must suspend for approval. */
export type ToolApprovalPolicy =
  | 'always'
  | 'never'
  | ((ctx: ToolApprovalContext) => boolean | PromiseLike<boolean>)

/** Map from exact tool names, or `'*'`, to approval policies. */
export type ToolApprovalMap = Readonly<Record<string, ToolApprovalPolicy>>

/** Composition layer that contributed an approval declaration. */
export type ToolApprovalLayer = 'call' | 'prompt' | 'context'

/** One approval declaration collected from a composition layer. */
export interface ApprovalDeclaration {
  readonly policy: ToolApprovalPolicy
  readonly layer: ToolApprovalLayer
  /** Context id or owner label, when the declaration came from a context. */
  readonly owner?: string
  /** Exact tool name or wildcard `'*'`. */
  readonly key: string
  /**
   * Tool names this declaration may affect.
   *
   * @internal Context wildcards keep their original `'*'` key for provenance
   * and precedence, but are scoped to tools contributed by that context.
   */
  readonly appliesTo?: readonly string[]
}

/** The resolved policy and provenance for one tool name. */
export interface ResolvedApprovalPolicy {
  readonly policy: ToolApprovalPolicy
  readonly provenance: ApprovalDeclaration
}

/** Inspect-friendly projection of one composed tool's effective policy. */
export interface ToolApprovalInspection {
  readonly toolName: string
  readonly policyKind: 'always' | 'never' | 'function'
  readonly provenance?: ApprovalDeclaration
}

const layerRank: Record<ToolApprovalLayer, number> = {
  context: 1,
  prompt: 2,
  call: 3,
}

/**
 * Resolve the effective approval policy for one tool name.
 *
 * Exact-name declarations are considered before wildcard declarations,
 * regardless of layer. Within the selected exact or wildcard pool, the layer
 * closest to the call site wins: call > prompt > context.
 */
export function resolveApprovalPolicy(
  toolName: string,
  declarations: readonly ApprovalDeclaration[],
): ResolvedApprovalPolicy | undefined {
  const applicable = declarations.filter(
    (declaration) => declaration.appliesTo === undefined || declaration.appliesTo.includes(toolName),
  )
  const exact = applicable.filter((declaration) => declaration.key === toolName)
  const pool = exact.length > 0 ? exact : applicable.filter((declaration) => declaration.key === '*')
  if (pool.length === 0) return undefined

  const winner = pool.reduce((current, candidate) =>
    layerRank[candidate.layer] > layerRank[current.layer] ? candidate : current,
  )
  return { policy: winner.policy, provenance: winner }
}

/** Return the inspectable policy kind without serializing function bodies. */
export function approvalPolicyKind(policy: ToolApprovalPolicy): ToolApprovalInspection['policyKind'] {
  return typeof policy === 'function' ? 'function' : policy
}

/** Build inspect output for a composed tool list. */
export function inspectToolApprovalPolicies(
  toolNames: readonly string[],
  declarations: readonly ApprovalDeclaration[],
): ToolApprovalInspection[] {
  return toolNames.map((toolName) => {
    const resolved = resolveApprovalPolicy(toolName, declarations)
    return {
      toolName,
      policyKind: resolved ? approvalPolicyKind(resolved.policy) : 'never',
      ...(resolved ? { provenance: resolved.provenance } : {}),
    }
  })
}
