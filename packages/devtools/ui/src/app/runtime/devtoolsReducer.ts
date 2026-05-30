/**
 * Pure reducer for devtools state management.
 *
 * Extracts all state transitions from `useDevtoolsWs` into a testable,
 * framework-agnostic reducer function.
 */

import type {
  AgentEventData,
  BudgetSnapshotData,
  CompactEventData,
  CorpusEventData,
  CostEventData,
  ConstraintCheckEventData,
  ConstraintRetryEventData,
  ConstraintViolationEventData,
  DelegateEventData,
  EmbeddingEventData,
  IngestEventData,
  RetrievalEventData,
  RetrievalStageEventData,
  IndexEventData,
  EvalRun,
  FlowRun,
  JudgeEventData,
  MemoryEventData,
  PlanEventData,
  RagEvalRun,
  RuntimeFlowRun,
  SecurityEventData,
  TaskEventData,
  TaskListEventData,
  ToolEventData,
  Trace,
  WorkspaceOperationEvent,
  WsEvent,
} from '@/types'

export type {
  Trace,
  EvalRun,
  RagEvalRun,
  FlowRun,
  RuntimeFlowRun,
} from '@/types'

// ---------------------------------------------------------------------------
// State interfaces
// ---------------------------------------------------------------------------

export interface DevtoolsState {
  connected: boolean
  /** True once we've successfully connected to the devtools server at
   *  least once during this session. Used by the App shell to decide
   *  between the onboarding `WaitingShell` (cold start, server never
   *  reachable) and the full app (which can stay mounted with cached
   *  data even if the connection later drops). */
  hasEverConnected: boolean
  /** Millisecond timestamp of when the WS last transitioned to
   *  disconnected. `null` while connected (or before the very first
   *  connection attempt). Used by the shell to show
   *  "Last update Xs ago — reconnecting…" affordances. */
  disconnectedAt: number | null
  /** Bumped each time the user clicks "Retry now" in the connection
   *  banner. The WS layer watches this and force-recreates its socket
   *  instead of waiting out the standard 2s backoff. */
  retryAttempt: number
  runtime: {
    // Quality REST records (experiments / comparisons / baselines /
    // feedback / cassettes) have moved to TanStack Query — see
    // `shared/hooks/useQualityApi.ts`. The slices below are push-only
    // state that's only ever produced by WebSocket events; no REST
    // endpoint serves an equivalent snapshot.
    traces: Trace[]
    evalRuns: EvalRun[]
    ragEvalRuns: RagEvalRun[]
    flowRuns: FlowRun[]
    runtimeFlowRuns: RuntimeFlowRun[]
    embeddingEvents: EmbeddingEventData[]
    retrievalEvents: RetrievalEventData[]
    retrievalStageEvents: RetrievalStageEventData[]
    workspaceEvents: WorkspaceOperationEvent[]
    indexEvents: IndexEventData[]
    corpusEvents: CorpusEventData[]
    ingestEvents: IngestEventData[]
    memoryEvents: MemoryEventData[]
    compactEvents: CompactEventData[]
    budgetSnapshots: BudgetSnapshotData[]
    costEvents: CostEventData[]
    agentEvents: AgentEventData[]
    judgeEvents: JudgeEventData[]
    delegateEvents: DelegateEventData[]
    toolEvents: ToolEventData[]
    securityEvents: SecurityEventData[]
    planEvents: PlanEventData[]
    taskListEvents: TaskListEventData[]
    taskEvents: TaskEventData[]
    constraintChecks: ConstraintCheckEventData[]
    constraintRetries: ConstraintRetryEventData[]
    constraintViolations: ConstraintViolationEventData[]
  }
}

// ---------------------------------------------------------------------------
// Internal (non-WS) actions
// ---------------------------------------------------------------------------

type InternalAction =
  | { type: 'SET_CONNECTED'; connected: boolean; at?: number }
  | { type: 'SET_RUNTIME_FLOWS'; runtimeFlowRuns: RuntimeFlowRun[] }
  | { type: 'REQUEST_RECONNECT' }

export type DevtoolsAction = WsEvent | InternalAction

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const INITIAL_STATE: DevtoolsState = {
  connected: false,
  hasEverConnected: false,
  disconnectedAt: null,
  retryAttempt: 0,
  runtime: {
    traces: [],
    evalRuns: [],
    ragEvalRuns: [],
    flowRuns: [],
    runtimeFlowRuns: [],
    embeddingEvents: [],
    retrievalEvents: [],
    retrievalStageEvents: [],
    workspaceEvents: [],
    indexEvents: [],
    corpusEvents: [],
    ingestEvents: [],
    memoryEvents: [],
    compactEvents: [],
    budgetSnapshots: [],
    costEvents: [],
    agentEvents: [],
    judgeEvents: [],
    delegateEvents: [],
    toolEvents: [],
    securityEvents: [],
    planEvents: [],
    taskListEvents: [],
    taskEvents: [],
    constraintChecks: [],
    constraintRetries: [],
    constraintViolations: [],
  },
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function devtoolsReducer(state: DevtoolsState, action: DevtoolsAction): DevtoolsState {
  switch (action.type) {
    // -----------------------------------------------------------------------
    // Internal actions
    // -----------------------------------------------------------------------

    case 'SET_CONNECTED':
      // Stamp `disconnectedAt` on transition to disconnected so the UI
      // can show "last update Xs ago". Cleared on transition back to
      // connected. Same-value transitions return identity to avoid
      // unnecessary re-renders. The first successful connect sets
      // `hasEverConnected` true permanently for the session — the App
      // shell uses this to decide between onboarding and the full app.
      if (action.connected === state.connected) return state
      if (action.connected) {
        return {
          ...state,
          connected: true,
          hasEverConnected: true,
          disconnectedAt: null,
        }
      }
      return { ...state, connected: false, disconnectedAt: action.at ?? Date.now() }

    case 'REQUEST_RECONNECT':
      return { ...state, retryAttempt: state.retryAttempt + 1 }

    case 'SET_RUNTIME_FLOWS':
      return {
        ...state,
        runtime: { ...state.runtime, runtimeFlowRuns: action.runtimeFlowRuns },
      }

    // -----------------------------------------------------------------------
    // WS events — snapshots & push-only streams
    //
    // The `catalog` WS event is handled outside the reducer in
    // `useDevtools.ts`: it calls `queryClient.setQueryData(qk.catalog(),
    // ...)` directly, since the catalog is owned by the `useCatalog`
    // Query hook now (no reducer slice for prompts/contexts/tools).
    // -----------------------------------------------------------------------

    case 'catalog':
      // No-op at the reducer level — handled by useDevtools onMessage.
      return state

    case 'eval:snapshot':
      return {
        ...state,
        runtime: { ...state.runtime, evalRuns: action.evalRuns },
      }

    case 'rag-eval:snapshot':
      return {
        ...state,
        runtime: { ...state.runtime, ragEvalRuns: action.ragEvalRuns },
      }

    case 'rag-eval:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          ragEvalRuns: [
            {
              evalId: action.evalId,
              suiteId: action.suiteId,
              startedAt: action.timestamp,
              caseCount: action.caseCount,
              configLabels: action.configLabels,
              completedCases: [],
              status: 'running' as const,
            },
            ...state.runtime.ragEvalRuns,
          ],
        },
      }

    case 'rag-eval:case':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          ragEvalRuns: state.runtime.ragEvalRuns.map((run) =>
            run.evalId === action.evalId
              ? {
                  ...run,
                  completedCases: [
                    ...run.completedCases,
                    {
                      caseId: action.caseId,
                      caseName: action.caseName,
                      status: action.status,
                      configRole: action.configRole,
                      configLabel: action.configLabel,
                      failureTypes: action.failureTypes,
                      durationMs: action.durationMs,
                      metrics: action.metrics,
                      retrieval: action.retrieval,
                      answer: action.answer,
                      citations: action.citations,
                      trace: action.trace,
                      error: action.error,
                    },
                  ],
                }
              : run,
          ),
        },
      }

    case 'rag-eval:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          ragEvalRuns: state.runtime.ragEvalRuns.map((run) =>
            run.evalId === action.evalId
              ? {
                  ...run,
                  status: 'completed' as const,
                  summary: action.summary,
                }
              : run,
          ),
        },
      }

    case 'flow:snapshot':
      return {
        ...state,
        runtime: { ...state.runtime, flowRuns: action.flowRuns },
      }

    case 'runtime:snapshot':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          ...(action.embeddingEvents ? { embeddingEvents: action.embeddingEvents } : {}),
          ...(action.retrievalEvents ? { retrievalEvents: action.retrievalEvents } : {}),
          ...(action.retrievalStageEvents ? { retrievalStageEvents: action.retrievalStageEvents } : {}),
          ...(action.workspaceEvents ? { workspaceEvents: action.workspaceEvents } : {}),
          ...(action.indexEvents ? { indexEvents: action.indexEvents } : {}),
          ...(action.corpusEvents ? { corpusEvents: action.corpusEvents } : {}),
          ...(action.ingestEvents ? { ingestEvents: action.ingestEvents } : {}),
          memoryEvents: action.memoryEvents,
          compactEvents: action.compactEvents,
          budgetSnapshots: action.budgetSnapshots,
          ...(action.costEvents ? { costEvents: action.costEvents } : {}),
          agentEvents: action.agentEvents,
          judgeEvents: action.judgeEvents,
          ...(action.delegateEvents ? { delegateEvents: action.delegateEvents } : {}),
          ...(action.toolEvents ? { toolEvents: action.toolEvents } : {}),
          ...(action.securityEvents ? { securityEvents: action.securityEvents } : {}),
          ...(action.planEvents ? { planEvents: action.planEvents } : {}),
          ...(action.taskListEvents ? { taskListEvents: action.taskListEvents } : {}),
          ...(action.taskEvents ? { taskEvents: action.taskEvents } : {}),
          ...(action.constraintChecks ? { constraintChecks: action.constraintChecks } : {}),
          ...(action.constraintRetries ? { constraintRetries: action.constraintRetries } : {}),
          ...(action.constraintViolations ? { constraintViolations: action.constraintViolations } : {}),
        },
      }

    // -----------------------------------------------------------------------
    // WS events — eval lifecycle
    // -----------------------------------------------------------------------

    case 'eval:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          evalRuns: [
            {
              evalId: action.evalId,
              promptId: action.promptId,
              startedAt: action.startedAt,
              models: action.models,
              caseNames: action.caseNames,
              totalCases: action.totalCases,
              completedCases: [],
              status: 'running' as const,
            },
            ...state.runtime.evalRuns,
          ],
        },
      }

    case 'eval:case':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          evalRuns: state.runtime.evalRuns.map((run) =>
            run.evalId === action.evalId
              ? {
                  ...run,
                  completedCases: [
                    ...run.completedCases,
                    {
                      caseName: action.caseName,
                      modelId: action.modelId,
                      passed: action.passed,
                      durationMs: action.durationMs,
                      error: action.error,
                      usage: action.usage,
                      cost: action.cost,
                      traceId: action.traceId,
                    },
                  ],
                }
              : run,
          ),
        },
      }

    case 'eval:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          evalRuns: state.runtime.evalRuns.map((run) =>
            run.evalId === action.evalId
              ? {
                  ...run,
                  status: 'completed' as const,
                  durationMs: action.durationMs,
                  summary: action.summary,
                }
              : run,
          ),
        },
      }

    // -----------------------------------------------------------------------
    // WS events — flow lifecycle
    // -----------------------------------------------------------------------

    case 'flow:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          flowRuns: [
            {
              flowId: action.flowId,
              name: action.name,
              description: action.description,
              startedAt: action.startedAt,
              stepIds: action.stepIds,
              configNames: action.configNames,
              caseNames: action.caseNames,
              totalCases: action.totalCases,
              completedCases: [],
              status: 'running' as const,
            },
            ...state.runtime.flowRuns,
          ],
        },
      }

    case 'flow:case':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          flowRuns: state.runtime.flowRuns.map((run) =>
            run.flowId === action.flowId
              ? {
                  ...run,
                  completedCases: [
                    ...run.completedCases,
                    {
                      caseName: action.caseName,
                      configName: action.configName,
                      passed: action.passed,
                      durationMs: action.durationMs,
                      error: action.error,
                      traceSummary: action.traceSummary,
                    },
                  ],
                }
              : run,
          ),
        },
      }

    case 'flow:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          flowRuns: state.runtime.flowRuns.map((run) =>
            run.flowId === action.flowId
              ? {
                  ...run,
                  status: 'completed' as const,
                  durationMs: action.durationMs,
                  summary: action.summary,
                }
              : run,
          ),
        },
      }

    // -----------------------------------------------------------------------
    // WS events — runtime flow lifecycle
    // -----------------------------------------------------------------------

    case 'runtime-flow:start': {
      // Skip if already exists (REST fetch raced with WebSocket)
      if (state.runtime.runtimeFlowRuns.some((r) => r.flowId === action.flowId && r.sessionId === action.sessionId)) {
        return state
      }
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: [
            {
              flowId: action.flowId,
              sessionId: action.sessionId,
              name: action.name,
              goal: action.goal,
              startedAt: action.startedAt,
              triggerTraceId: action.traceId,
              relatedTraceIds: action.traceId ? [action.traceId] : [],
              steps: [],
              status: 'running' as const,
              ...(action.parentFlowId ? { parentFlowId: action.parentFlowId } : {}),
            },
            ...state.runtime.runtimeFlowRuns,
          ],
        },
      }
    }

    case 'runtime-flow:step':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) => {
            if (run.flowId !== action.flowId || run.sessionId !== action.sessionId) return run
            const stepEntry = {
              stepId: action.stepId,
              label: action.label,
              status: action.status,
              timestamp: action.timestamp,
              durationMs: action.durationMs,
              totalTokens: action.totalTokens,
              cost: action.cost,
              toolCallNames: action.toolCallNames ?? [],
              actor: action.actor,
              fromStepId: action.fromStepId,
              handoffKind: action.handoffKind,
              inputSummary: action.inputSummary,
              outputSummary: action.outputSummary,
              traceId: action.traceId,
              note: action.note,
            }
            const existingIdx = run.steps.findIndex((s) => s.stepId === action.stepId)
            const steps =
              existingIdx >= 0
                ? run.steps.map((s, i) => (i === existingIdx ? stepEntry : s))
                : [...run.steps, stepEntry]
            return {
              ...run,
              steps,
              relatedTraceIds:
                action.traceId && !run.relatedTraceIds.includes(action.traceId)
                  ? [...run.relatedTraceIds, action.traceId]
                  : run.relatedTraceIds,
            }
          }),
        },
      }

    case 'runtime-flow:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) =>
            run.flowId === action.flowId && run.sessionId === action.sessionId
              ? {
                  ...run,
                  status: action.status,
                  durationMs: action.durationMs,
                  finishedAt: action.timestamp,
                  aggregate: action.aggregate,
                  error: action.error,
                }
              : run,
          ),
        },
      }

    case 'runtime-flow:suspend':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) =>
            run.flowId === action.flowId && run.sessionId === action.sessionId
              ? {
                  ...run,
                  status: 'suspended' as const,
                  suspendedAt: action.suspendPoint,
                }
              : run,
          ),
        },
      }

    case 'runtime-flow:resume':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) =>
            run.flowId === action.flowId && run.sessionId === action.sessionId
              ? { ...run, status: 'running' as const, suspendedAt: undefined }
              : run,
          ),
        },
      }

    case 'runtime-flow:signal':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) =>
            run.flowId === action.flowId && run.sessionId === action.sessionId
              ? {
                  ...run,
                  relatedTraceIds:
                    action.traceId && !run.relatedTraceIds.includes(action.traceId)
                      ? [...run.relatedTraceIds, action.traceId]
                      : run.relatedTraceIds,
                }
              : run,
          ),
        },
      }

    case 'runtime-flow:cancel':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) =>
            run.flowId === action.flowId && run.sessionId === action.sessionId
              ? {
                  ...run,
                  status: 'cancelled' as const,
                  cancelReason: action.reason,
                }
              : run,
          ),
        },
      }

    case 'runtime-flow:expired':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          runtimeFlowRuns: state.runtime.runtimeFlowRuns.map((run) =>
            run.flowId === action.flowId && run.sessionId === action.sessionId
              ? { ...run, status: 'expired' as const }
              : run,
          ),
        },
      }

    // -----------------------------------------------------------------------
    // WS events — runtime individual events
    // -----------------------------------------------------------------------

    case 'memory:read':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          memoryEvents: [{ ...action, _kind: 'read' as const }, ...state.runtime.memoryEvents],
        },
      }

    case 'embed:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          embeddingEvents: [{ ...action, _kind: 'start' }, ...state.runtime.embeddingEvents],
        },
      }

    case 'embed:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          embeddingEvents: [{ ...action, _kind: 'end' }, ...state.runtime.embeddingEvents],
        },
      }

    case 'retrieval:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          retrievalEvents: [{ ...action, _kind: 'start' as const }, ...state.runtime.retrievalEvents],
        },
      }

    case 'retrieval:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          retrievalEvents: [{ ...action, _kind: 'end' as const }, ...state.runtime.retrievalEvents],
        },
      }

    case 'retrieval:stage:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          retrievalStageEvents: [
            { ...action, _kind: 'stage-start' as const },
            ...state.runtime.retrievalStageEvents,
          ],
        },
      }

    case 'retrieval:stage:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          retrievalStageEvents: [{ ...action, _kind: 'stage-end' as const }, ...state.runtime.retrievalStageEvents],
        },
      }

    case 'workspace:operation':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          workspaceEvents: [action, ...state.runtime.workspaceEvents],
        },
      }

    case 'index:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          indexEvents: [{ ...action, _kind: 'start' as const }, ...state.runtime.indexEvents],
        },
      }

    case 'index:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          indexEvents: [{ ...action, _kind: 'end' as const }, ...state.runtime.indexEvents],
        },
      }

    case 'corpus:sync:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          corpusEvents: [{ ...action, _kind: 'sync:start' as const }, ...state.runtime.corpusEvents],
        },
      }

    case 'corpus:source:added':
    case 'corpus:source:changed':
    case 'corpus:source:unchanged':
    case 'corpus:source:skipped':
    case 'corpus:source:failed':
    case 'corpus:source:stale':
    case 'corpus:source:deleted':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          corpusEvents: [{ ...action, _kind: 'source' as const }, ...state.runtime.corpusEvents],
        },
      }

    case 'corpus:sync:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          corpusEvents: [{ ...action, _kind: 'sync:end' as const }, ...state.runtime.corpusEvents],
        },
      }

    case 'ingest:parse:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          ingestEvents: [{ ...action, _kind: 'start' as const }, ...state.runtime.ingestEvents],
        },
      }

    case 'ingest:parse:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          ingestEvents: [{ ...action, _kind: 'end' as const }, ...state.runtime.ingestEvents],
        },
      }

    case 'memory:write':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          memoryEvents: [{ ...action, _kind: 'write' as const }, ...state.runtime.memoryEvents],
        },
      }

    case 'compact:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          compactEvents: [{ ...action, _kind: 'start' as const }, ...state.runtime.compactEvents],
        },
      }

    case 'compact:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          compactEvents: [{ ...action, _kind: 'end' as const }, ...state.runtime.compactEvents],
        },
      }

    case 'budget:check':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          budgetSnapshots: [action, ...state.runtime.budgetSnapshots],
        },
      }

    case 'cost:report':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          costEvents: [{ ...action, _kind: 'report' as const }, ...state.runtime.costEvents],
        },
      }

    case 'cost:warn':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          costEvents: [{ ...action, _kind: 'warn' as const }, ...state.runtime.costEvents],
        },
      }

    case 'cost:limit':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          costEvents: [{ ...action, _kind: 'limit' as const }, ...state.runtime.costEvents],
        },
      }

    case 'blackboard:update':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          agentEvents: [{ ...action, _kind: 'blackboard' as const }, ...state.runtime.agentEvents],
        },
      }

    case 'handoff:prepare':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          agentEvents: [{ ...action, _kind: 'handoff' as const }, ...state.runtime.agentEvents],
        },
      }

    case 'judge:result':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          judgeEvents: [action, ...state.runtime.judgeEvents],
        },
      }

    case 'delegate:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          delegateEvents: [{ ...action, _kind: 'start' as const }, ...state.runtime.delegateEvents],
        },
      }

    case 'delegate:complete':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          delegateEvents: [{ ...action, _kind: 'complete' as const }, ...state.runtime.delegateEvents],
        },
      }

    case 'tool:start':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          toolEvents: [{ ...action, _kind: 'start' as const }, ...state.runtime.toolEvents],
        },
      }

    case 'tool:end':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          toolEvents: [{ ...action, _kind: 'end' as const }, ...state.runtime.toolEvents],
        },
      }

    case 'tool:approval:request':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          toolEvents: [{ ...action, _kind: 'approval-request' as const }, ...state.runtime.toolEvents],
        },
      }

    case 'tool:approval:decision':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          toolEvents: [{ ...action, _kind: 'approval-decision' as const }, ...state.runtime.toolEvents],
        },
      }

    case 'security:warning':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          securityEvents: [action, ...state.runtime.securityEvents],
        },
      }

    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // WS events — constraint checks
    // -----------------------------------------------------------------------

    case 'constraint:check':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          constraintChecks: [
            {
              constraintName: action.constraintName,
              severity: action.severity,
              pass: action.pass,
              feedback: action.feedback,
              durationMs: action.durationMs,
              attempt: action.attempt,
              traceId: action.traceId,
              timestamp: action.timestamp,
            },
            ...state.runtime.constraintChecks,
          ].slice(0, 500),
        },
      }

    case 'constraint:retry':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          constraintRetries: [
            {
              constraintNames: action.constraintNames,
              attempt: action.attempt,
              combinedFeedback: action.combinedFeedback,
              traceId: action.traceId,
              timestamp: action.timestamp,
            },
            ...state.runtime.constraintRetries,
          ].slice(0, 500),
        },
      }

    case 'constraint:violation':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          constraintViolations: [
            {
              constraintNames: action.constraintNames,
              totalAttempts: action.totalAttempts,
              traceId: action.traceId,
              timestamp: action.timestamp,
            },
            ...state.runtime.constraintViolations,
          ].slice(0, 500),
        },
      }

    // WS events — plan & task lifecycle
    // -----------------------------------------------------------------------

    case 'plan:created':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          planEvents: [{ ...action, _kind: 'created' as const }, ...state.runtime.planEvents].slice(0, 200),
        },
      }

    case 'plan:updated':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          planEvents: [{ ...action, _kind: 'updated' as const }, ...state.runtime.planEvents].slice(0, 200),
        },
      }

    case 'tasklist:created':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          taskListEvents: [{ ...action, _kind: 'created' as const }, ...state.runtime.taskListEvents].slice(0, 200),
        },
      }

    case 'tasklist:completed':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          taskListEvents: [{ ...action, _kind: 'completed' as const }, ...state.runtime.taskListEvents].slice(0, 200),
        },
      }

    case 'tasklist:discarded':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          taskListEvents: [{ ...action, _kind: 'discarded' as const }, ...state.runtime.taskListEvents].slice(0, 200),
        },
      }

    case 'task:added':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          taskEvents: [{ ...action, _kind: 'added' as const }, ...state.runtime.taskEvents].slice(0, 200),
        },
      }

    case 'task:updated':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          taskEvents: [{ ...action, _kind: 'updated' as const }, ...state.runtime.taskEvents].slice(0, 200),
        },
      }

    case 'task:removed':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          taskEvents: [{ ...action, _kind: 'removed' as const }, ...state.runtime.taskEvents].slice(0, 200),
        },
      }

    // -----------------------------------------------------------------------
    // Unknown action — return state unchanged (same reference)
    // -----------------------------------------------------------------------

    default:
      return state
  }
}
