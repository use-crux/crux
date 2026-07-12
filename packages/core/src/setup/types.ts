/**
 * Provider-neutral project setup contracts.
 *
 * Contributors inspect and plan without mutation. Tooling may apply only
 * actions explicitly classified as safe and additive.
 *
 * @module
 */

/** Where setup is running relative to mutation intent. */
export type SetupMode = 'check' | 'plan' | 'apply'

/** Project facts available to every setup contributor. */
export interface SetupContext {
  /** Absolute or caller-resolved project root. */
  readonly root: string
  /** Current inspection, planning, or application mode. */
  readonly mode: SetupMode
  /** Reserved for privacy-safe static hints supplied by future tooling. */
  readonly hints?: Readonly<Record<string, unknown>>
}

/** Severity assigned to a setup finding. */
export type SetupSeverity = 'error' | 'warning' | 'info'

/** One privacy-safe project setup finding. */
export interface SetupFinding {
  /** Stable id of the contributor that produced the finding. */
  readonly contributorId: string
  /** Stable machine-readable diagnostic code. */
  readonly code: string
  /** Resource or capability being inspected. */
  readonly resource: string
  /** Impact of the finding on setup readiness. */
  readonly severity: SetupSeverity
  /** Human-readable explanation without secrets or connection strings. */
  readonly message: string
  /** Stable documentation URL, when known. */
  readonly docsUrl?: string
  /** Exact command, SQL, or code change that resolves the finding. */
  readonly remediation?: string
  /** Copy-paste prompt for a coding agent, when useful. */
  readonly agentPrompt?: string
}

/** Safety classification for a planned setup action. */
export type SetupActionClassification =
  | 'safe-additive'
  | 'requires-approval'

/** One setup action proposed by a contributor. */
export interface SetupAction {
  /** Stable action identity. */
  readonly id: string
  /** Stable id of the contributor that owns the action. */
  readonly contributorId: string
  /** Whether non-interactive tooling may safely apply the action. */
  readonly classification: SetupActionClassification
  /** Concise user-facing action title. */
  readonly title: string
  /** Human-readable explanation of the proposed change. */
  readonly description: string
  /** Exact manual remediation, when applicable. */
  readonly remediation?: string
}

/** Result of applying one setup action. */
export interface SetupResult {
  /** Whether the action completed successfully. */
  readonly ok: boolean
  /** Identity of the action that was applied. */
  readonly actionId: string
  /** Findings produced while applying the action. */
  readonly findings: readonly SetupFinding[]
}

/** A subsystem that contributes project setup inspection and actions. */
export interface SetupContributor {
  /** Stable contributor identity. */
  readonly id: string

  /**
   * Inspect the project without mutating files or infrastructure.
   */
  inspect(project: SetupContext): Promise<readonly SetupFinding[]>

  /**
   * Plan project setup without mutating files or infrastructure.
   */
  plan(project: SetupContext): Promise<readonly SetupAction[]>

  /**
   * Apply one action. Implementations must be idempotent for safe-additive
   * actions and must not apply destructive or ambiguous changes implicitly.
   */
  apply?(action: SetupAction, project: SetupContext): Promise<SetupResult>
}

/** Stable aggregate returned by every setup planner operation. */
export interface SetupReport {
  /** Whether the resulting findings contain no errors. */
  readonly ok: boolean
  /** Operation mode represented by this report. */
  readonly mode: SetupMode
  /** Findings in contributor registration order. */
  readonly findings: readonly SetupFinding[]
  /** Planned actions in contributor registration order. */
  readonly actions: readonly SetupAction[]
  /** Results for actions attempted during apply. */
  readonly applied: readonly SetupResult[]
}

/** Pure project setup orchestration over an explicit contributor list. */
export interface SetupPlanner {
  /** Inspect every contributor without planning or applying changes. */
  check(project: SetupContext): Promise<SetupReport>
  /** Inspect and plan every contributor without applying changes. */
  plan(project: SetupContext): Promise<SetupReport>
  /** Plan, safely apply, and then re-inspect every contributor. */
  apply(project: SetupContext): Promise<SetupReport>
}
