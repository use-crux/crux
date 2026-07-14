/**
 * Compatibility shim for the `@use-crux/core/tools` package subpath.
 *
 * The implementation lives in the `tools/` domain. This file exists only to keep
 * the public subpath export target (`packages/core/package.json` → `./tools`)
 * stable; it re-exports exactly the surface this subpath has always exposed.
 *
 * @module
 */

export { tool } from "./tools/define-tool";
export {
  TOOL_SOURCE,
  TOOL_SOURCE_PROVENANCE,
  TOOL_SOURCE_QUALITY_IDENTITY,
  TOOL_SOURCE_REPLAY_IDENTITY,
  TOOL_SOURCE_SESSION_PROVENANCE,
  ToolSourceUnsupportedError,
  isToolSource,
  toolSourceReplayIdentity,
  toolSourceProvenance,
  toolSourceQualityIdentity,
  toolSourceSessionProvenance,
  withToolSourceReplayIdentity,
  withToolSourceProvenance,
  withToolSourceSessionProvenance,
} from "./tools/tool-source";
export { toolPolicy } from "./safety/toolPolicy";
export type {
  ToolApprovalPolicyIdentity,
  ToolApprovalReplayProvenance,
  ToolConfig,
  NamedToolDef,
} from "./tools/types";
export type {
  KnownToolsFor,
  MergeKnownTools,
  PromptToolsOf,
  ToolContextOf,
  ToolsContextOf,
  ToolsContextOption,
} from "./tools/context-types";
export type { ToolDef, ToolModelOutput, ToModelOutputArgs } from "./types/tool";
export type {
  ToolSource,
  ToolSourceMaterializationContext,
  ToolSourceMaterializer,
  ToolSourceProvenance,
  ToolSourceQualityIdentity,
  ToolSourceSessionProvenance,
  ToolSourceSession,
} from "./tools/tool-source";
