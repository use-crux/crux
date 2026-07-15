/**
 * Compatibility shim for the `@use-crux/core/tool-middleware` package subpath.
 *
 * The implementation lives in the `tools/` domain (`tools/middleware.ts`,
 * `tools/approvals.ts`, `tools/types.ts`). This file exists only to keep the
 * public subpath export target (`packages/core/package.json` → `./tool-middleware`)
 * stable; it re-exports exactly the surface this subpath has always exposed.
 *
 * @module
 */

export {
  toolMiddleware,
  approvalMiddleware,
  applyToolMiddleware,
  notifyToolApprovalResponses,
} from './tools/middleware'
export {
  toolApprovalResponse,
  toolApprovalResponseMessage,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from './tools/approvals'
export { approvalPolicyKind, inspectToolApprovalPolicies, resolveApprovalPolicy } from './tools/approval-policy'
export type {
  ApprovalDeclaration,
  ResolvedApprovalPolicy,
  ToolApprovalContext,
  ToolApprovalInspection,
  ToolApprovalLayer,
  ToolApprovalMap,
  ToolApprovalPolicy,
} from './tools/approval-policy'
export type {
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
} from './tools/types'
