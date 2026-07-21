import type {
  BoundaryDef,
  BoundaryIdOf,
  MediaPartLocation,
  OriginlessBoundaryOf,
  OriginOf,
  SafetyTargetId,
} from './boundary'
import type { GuardrailStreamOption } from './stream/types'

/** Safe, structured finding metadata emitted by safety policies. */
export interface SafetyFinding {
  readonly type: string
  readonly count?: number
  readonly span?: { readonly start: number; readonly end: number }
}

/** Canonical action vocabulary for the safety decision read model. */
export type SafetyDecisionAction =
  | 'allow'
  | 'block'
  | 'warn'
  | 'rewrite'
  | 'strip'
  | 'retry'
  | 'request_approval'
  | 'drop'

/** Safe evidence summary for content touched by safety. */
export interface SafetyCaptureSummary {
  readonly level: 'full' | 'safe' | 'evidence' | 'off'
  readonly sizeBytes: number
  readonly hash: string
  readonly preview?: string
  readonly raw?: string
}

/** Canonical runtime record for a safety policy decision. */
export interface SafetyDecision {
  readonly policyId: string
  readonly kind: 'guardrail' | 'constraint' | 'toolPolicy'
  readonly boundary: SafetyTargetId
  readonly stage?: 'stream.segment' | 'stream.final'
  readonly mode: 'enforce' | 'report'
  readonly action: SafetyDecisionAction
  readonly severity?: 'info' | 'warn' | 'error'
  readonly reason?: string
  /** Safe model id for this media decision, when one is known. */
  readonly model?: string
  /** Safe original coordinates for a media-boundary decision. */
  readonly location?: MediaPartLocation
  /** Present only when an enforced strip could not preserve a required invariant. */
  readonly escalatedToBlock?: true
  readonly findings?: readonly SafetyFinding[]
  readonly tuned?: readonly ('mode' | 'stream' | 'enabled')[]
  readonly durationMs: number
  readonly captured: SafetyCaptureSummary
}

/** Mutable finding collector exposed to a single policy invocation. */
export interface SafetyFindingCollector {
  add(finding: SafetyFinding): void
}

/** Safe metadata available to guardrail and constraint callbacks. */
interface SafetyRunContextBase<B extends BoundaryDef | readonly BoundaryDef[]> {
  readonly policy: {
    readonly id: string
    readonly mode: 'enforce' | 'report'
  }
  readonly boundary: {
    readonly id: BoundaryIdOf<B>
    readonly kind: BoundaryIdOf<B>
  }
  readonly prompt: {
    readonly id?: string
  }
  readonly model: {
    readonly id?: string
  }
  readonly trace: {
    readonly id?: string
  }
  readonly attempt: {
    readonly index: number
    readonly kind: 'initial' | 'retry'
  }
  readonly metadata: Readonly<Record<string, unknown>>
  readonly findings: SafetyFindingCollector
  readonly stream?: {
    readonly segment: true
    readonly last: boolean
    readonly heldChars: number
    readonly heldMs: number
  }
  readonly path?: string
  readonly tool?: {
    readonly name: string
  }
}

type SafetyRunOrigin<B extends BoundaryDef | readonly BoundaryDef[]> = [OriginOf<B>] extends [never]
  ? { readonly origin?: never }
  : [OriginlessBoundaryOf<B>] extends [never]
    ? { readonly origin: OriginOf<B> }
    : { readonly origin?: OriginOf<B> }

/**
 * Safe metadata available to guardrail and constraint callbacks.
 *
 * Model-ingress boundaries expose a typed `origin`. It is required when every
 * selected boundary has semantic ingress provenance and optional for mixed
 * input/output boundary tuples.
 */
export type SafetyRunContext<B extends BoundaryDef | readonly BoundaryDef[] = BoundaryDef> = SafetyRunContextBase<B> &
  SafetyRunOrigin<B>

/** Inspectable strategy callback used by first-party helpers. */
export interface StrategyRun<TSubject, TResult> {
  (subject: TSubject, ctx: SafetyRunContext): TResult | Promise<TResult>
  readonly strategy: {
    readonly kind: string
    readonly config: Readonly<Record<string, unknown>>
  }
}

/** Effective posture fields that may be tuned per call. */
export interface SafetyEffectivePolicyOptions {
  readonly mode: 'enforce' | 'report'
  readonly stream?: GuardrailStreamOption
  readonly enabled: boolean
  readonly tuned?: readonly ('mode' | 'stream' | 'enabled')[]
}
