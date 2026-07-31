import type { AgentLike } from '../agent'
import type { AgentExecutor, AgentResult } from '../executor'
import type { RetryOptions } from '../../generation/retry'
import type { ValidationRetryOptions } from '../../generation/validation-retry'
import type { CruxSpanId } from '../../observability'
import type { WithOperationResultMeta } from '../../observability'
import type { ExecutionContext } from '../../runtime/execution-context'
import type { AnyModel, AnyToolSet } from '../../types'
import type {
  InvocationContextSeed,
  PrepareInvocation,
} from '../../request/prepare/invocation-context'
import type { CompositionRequestReceiptTree } from '../../request/receipt/tree'

/** Composition modes supported by the shared agent composition runtime. */
export type CompositionKind = 'parallel' | 'pipeline' | 'consensus' | 'swarm'

type CompositionResultEnvelope<TResult extends object> =
  TResult extends readonly unknown[] ? never : TResult

/** Additional child execution-context fields for one composition step. */
export interface CompositionStepContextInput {
  /** Stable label for this step inside the composition. */
  readonly label: string
  /** Optional explicit step id. Defaults to a composition-derived id. */
  readonly stepId?: string
}

/** Configuration for an internal agent composition runtime instance. */
export interface CompositionRuntimeConfig {
  /** Composition mode, used for spans and report primitives. */
  readonly kind: CompositionKind
  /**
   * Author-supplied definition identity, required on every composition's
   * public options (matching `agent()`/`flow()`/`memory()`/`guardrail()`/
   * `constraint()`/`blackboard()`). Identifies the *definition*, distinct
   * from the random per-execution `compositionId`.
   */
  readonly id: string
  /** Agent ids declared by the composition. */
  readonly agentIds: readonly string[]
  /** Optional session id to install on every child execution context. */
  readonly sessionId?: string
  /** Extra root span attributes owned by the composition mode. */
  readonly attributes?: Readonly<Record<string, unknown>>
  /** Callback evaluated before each managed leaf child. */
  readonly prepareInvocation?: PrepareInvocation
}

/** Agent execution request owned by a composition mode. */
export interface CompositionAgentExecution<TOutput = unknown> {
  /** Agent or plain async function to execute. */
  readonly agent: AgentLike
  /** Adapter-supplied executor used for real `Agent` instances. */
  readonly executor: AgentExecutor
  /** Stable composition-local label for spans and context. */
  readonly label: string
  /** Zero-based position within the mode-specific schedule. */
  readonly index: number
  /** Input passed to the agent executor or function. */
  readonly input: unknown
  /** Shared model forwarded to the executor. */
  readonly model?: AnyModel
  /** Additional tools forwarded to the executor. */
  readonly tools?: AnyToolSet
  /** Maximum tool-use steps forwarded to the executor. */
  readonly maxSteps?: number
  /** Execution retry/fallback applied around the agent invocation. */
  readonly retry?: RetryOptions
  /** Validation-feedback retry forwarded to the executor. */
  readonly validationRetry?: ValidationRetryOptions
  /** Extra agent span attributes owned by the composition mode. */
  readonly attributes?: Readonly<Record<string, unknown>>
  /** Wrap the agent span in a canonical `flow.step` span for sequential stages. */
  readonly flowStep?: boolean
  /** Optional explicit step id. Defaults to a composition-derived id. */
  readonly stepId?: string
  /** Link a previous handoff span to this agent span. */
  readonly triggeredBy?: {
    readonly spanId: CruxSpanId
    readonly attributes?: Readonly<Record<string, unknown>>
  }
  /** Composition-specific facts for a managed invocation boundary. */
  readonly invocation?: InvocationContextSeed
}

/** Function step execution request owned by a composition mode. */
export interface CompositionFunctionExecution<TOutput = unknown> {
  /** Stable composition-local label for spans and context. */
  readonly label: string
  /** Zero-based position within the mode-specific schedule. */
  readonly index: number
  /** Function body to execute. */
  readonly run: () => Promise<TOutput> | TOutput
  /** Execution retry/fallback applied around the function invocation. */
  readonly retry?: RetryOptions
  /** Extra function step span attributes owned by the composition mode. */
  readonly attributes?: Readonly<Record<string, unknown>>
}

/** Composition report artifact to attach to the current composition span. */
export interface CompositionReport {
  /** JSON preview payload shown in observability transports. */
  readonly preview: Readonly<Record<string, unknown>>
  /** Artifact attributes used for filtering and graph queries. */
  readonly attributes: Readonly<Record<string, unknown>>
  /** Edge attributes for the span -> report relation. Defaults to `attributes`. */
  readonly edgeAttributes?: Readonly<Record<string, unknown>>
}

/** Per-run scope exposed to composition mode implementations. */
export interface CompositionScope {
  /** Execute an agent or plain async function under shared lifecycle handling. */
  executeAgent<TOutput = unknown>(
    input: CompositionAgentExecution<TOutput>,
  ): Promise<AgentResult<TOutput>>
  /** Execute a plain function step under shared lifecycle handling. */
  executeFunctionStep<TOutput = unknown>(
    input: CompositionFunctionExecution<TOutput>,
  ): Promise<AgentResult<TOutput>>
  /** Emit a `composition.report` artifact for the current composition span. */
  report(input: CompositionReport): void
  /** Build the child execution context for a composition step. */
  childContext(input: CompositionStepContextInput): ExecutionContext
  /** Snapshot linked child provider-request evidence. */
  requestReceipts(): CompositionRequestReceiptTree
}

/** Internal runtime that owns shared composition lifecycle mechanics. */
export interface CompositionRuntime {
  /** Unique id for this composition run. Random per execution. */
  readonly compositionId: string
  /**
   * Canonical Project Index definition id for this composition, in the
   * `composition.<kind>:<id>` format matching `store.ProjectDefinition.ID`.
   */
  readonly definitionId: string
  /**
   * Run mode-specific scheduling and finalize its public parent envelope.
   *
   * The returned `_meta` identifies this runtime's exact `composition.*`
   * span; nested agent results retain their separate `agent.run` identities.
   */
  run<TResult extends object>(
    body: (
      scope: CompositionScope,
    ) => Promise<CompositionResultEnvelope<TResult>>,
  ): Promise<WithOperationResultMeta<CompositionResultEnvelope<TResult>>>
}
