/**
 * `@use-crux/core/adapter/tool` — one deep module for the tool lifecycle.
 *
 * Authoring: `toolMiddleware()` / `approvalMiddleware()`, plus the
 * app-facing approval helpers (`toolApprovalResponse`,
 * `appendToolApprovalResponse`, `findToolApprovalRequests`, …) that
 * approval UIs are built from.
 *
 * Consumption: one per-call session created with `createToolLifecycle()` —
 * `resume()` before the first provider call, then `executeRound()` (core
 * regime) or the armed `tools` map (sdk regime), `applySkillLoads()` per
 * step, `suspend()` on SDK suspension, `captureTurn()` at the end.
 *
 * Orchestration internals (the gate→execute→settle verdict kernel, the
 * approval protocol mechanics, instrumentation emission, output
 * normalization, skill re-arming, memory fan-out) are private to the
 * session.
 *
 * @module
 */

// ── The per-call session ───────────────────────────────────────────
export { createToolLifecycle } from './session'
export type {
  ToolLifecycle,
  ToolLifecycleOptions,
  ToolDescriptor,
  AppendToolRound,
  ToolResumeOutcome,
  ToolRoundOutcome,
  SkillAmendment,
  SuspendedRound,
  ToolProtocolEvent,
} from './session'
export type { ApprovalRequestInfo } from './approval'

// ── Middleware authoring ───────────────────────────────────────────
export { toolMiddleware, approvalMiddleware } from '../../tools/middleware'
export type {
  ToolMiddleware,
  ToolMiddlewareConfig,
  ToolMiddlewareNext,
  ApprovalMiddlewareConfig,
  ToolApprovalDecisionEvent,
  ToolCallContext,
  ToolResultContext,
  ToolErrorContext,
  ToolExecutionOptions,
  ToolExecuteFunction,
  ToolLike,
  ToolMatcher,
} from '../../tools/types'

// ── App-facing approval helpers (render approval UIs with these) ──
export {
  toolApprovalResponse,
  toolApprovalResponseMessage,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from '../../tools/approvals'
export type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolApprovalRequestPart,
  ToolApprovalRequestPayload,
  ToolApprovalResponsePart,
  ToolApprovalStatus,
} from '../../tools/types'
