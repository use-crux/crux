import type { ProjectDefinition } from "../src/project-index";
import type { ProjectIndexRuntimeUpdate } from "../src/project-index/runtime";

const removedTool = {
  id: "tool:lookup",
  kind: "tool",
  name: "lookup",
  fidelity: "resolved",
  status: "removed",
} as const satisfies ProjectDefinition;

const replacement = {
  schemaVersion: 1,
  operation: "replace",
  updateId: "replace-1",
  owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
  observedAt: "2026-07-14T10:00:00Z",
  revision: "discovery-v1",
  definitions: [removedTool],
  relations: [],
} as const satisfies ProjectIndexRuntimeUpdate;

const failure = {
  schemaVersion: 1,
  operation: "failure",
  updateId: "failure-1",
  owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
  observedAt: "2026-07-14T10:01:00Z",
  error: { phase: "discover", category: "mcp-discovery" },
} as const satisfies ProjectIndexRuntimeUpdate;

const invalidFailure = {
  schemaVersion: 1,
  operation: "failure",
  updateId: "failure-with-children",
  owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
  observedAt: "2026-07-14T10:01:00Z",
  error: { phase: "discover", category: "mcp-discovery" },
  // @ts-expect-error Failure operations cannot carry partial child facts.
  definitions: [],
} as const satisfies ProjectIndexRuntimeUpdate;

const invalidReplacement = {
  schemaVersion: 1,
  operation: "replace",
  updateId: "replace-with-error",
  owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
  observedAt: "2026-07-14T10:01:00Z",
  revision: "discovery-v2",
  definitions: [],
  relations: [],
  // @ts-expect-error Successful replacements cannot carry failure state.
  error: { phase: "discover", category: "mcp-discovery" },
} as const satisfies ProjectIndexRuntimeUpdate;

void replacement;
void failure;
void invalidFailure;
void invalidReplacement;
