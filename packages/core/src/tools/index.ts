/**
 * `tools/` — SDK-agnostic tool authoring, middleware, approval protocol, and the
 * entity composition contract.
 *
 * This is the curated domain barrel. It is the public face of the tools domain
 * for the root `@use-crux/core` barrel and for tests; the package subpaths
 * `@use-crux/core/tools` and `@use-crux/core/tool-middleware` are served by the
 * thin root `../tools.ts` and `../tool-middleware.ts` compatibility shims.
 *
 * @module
 */

// ── Tool authoring ──────────────────────────────────────────────
export { tool } from './define-tool'
export { toolPolicy } from '../safety/toolPolicy'

// ── Tool middleware ─────────────────────────────────────────────
export { toolMiddleware, approvalMiddleware, applyToolMiddleware, notifyToolApprovalResponses } from './middleware'

// ── Resumable approval protocol ─────────────────────────────────
export {
  toolApprovalResponse,
  toolApprovalResponseMessage,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from './approvals'
export { approvalPolicyKind, inspectToolApprovalPolicies, resolveApprovalPolicy } from './approval-policy'
export type {
  ApprovalDeclaration,
  ResolvedApprovalPolicy,
  ToolApprovalContext,
  ToolApprovalInspection,
  ToolApprovalLayer,
  ToolApprovalMap,
  ToolApprovalPolicy,
} from './approval-policy'

// ── Entity composition ──────────────────────────────────────────
export { composeTools } from './entity'
export type { CruxEntity, QueryableCruxEntity } from './entity'

// ── Public types ────────────────────────────────────────────────
export type {
  ToolConfig,
  NamedToolDef,
  ToolApprovalStatus,
  ToolApprovalPolicyIdentity,
  ToolApprovalReplayProvenance,
  ToolApprovalRequestPayload,
  ToolApprovalRequestPart,
  ToolApprovalResponsePart,
  ToolApprovalRequest,
  ToolApprovalDecision,
  ToolCallContext,
  ToolResultContext,
  ToolErrorContext,
  ToolMatcher,
  ToolMiddlewareNext,
  ToolExecutionOptions,
  ToolExecuteFunction,
  ToolLike,
  ToolMiddleware,
  ToolMiddlewareConfig,
  ApprovalMiddlewareConfig,
  ToolApprovalDecisionEvent,
  ToolDef,
  ToolModelOutput,
  ToModelOutputArgs,
} from './types'
export type {
  KnownToolsFor,
  MergeKnownTools,
  PromptToolsOf,
  ToolContextOf,
  ToolsContextOf,
  ToolsContextOption,
} from './context-types'
