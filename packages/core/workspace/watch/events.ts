/**
 * Workspace watch event encoding and filtering.
 *
 * @module
 */

import type { JsonObject, JsonValue } from "../../storage";
import type { RuntimeEvent } from "../../runtime/ports";
import type {
  WorkspaceChangeEvent,
  WorkspaceChangeType,
} from "./types";

/** Durable Runtime Engine event name used for workspace change facts. */
export const WORKSPACE_CHANGE_EVENT_NAME = "crux.workspace.change";

/** Payload stored in the Runtime Engine durable event log. */
export type WorkspaceChangeEventPayload = JsonObject & {
  readonly version: 1;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly type: WorkspaceChangeType;
  readonly path: string;
  readonly from?: string;
  readonly at: number;
};

/** Workspace change input before it is appended to the runtime event log. */
export type WorkspaceChangeInput =
  | {
      readonly type: Exclude<WorkspaceChangeType, "rename">;
      readonly workspaceId: string;
      readonly namespace: string;
      readonly path: string;
      readonly at?: number;
    }
  | {
      readonly type: "rename";
      readonly workspaceId: string;
      readonly namespace: string;
      readonly path: string;
      readonly from: string;
      readonly at?: number;
    };

/** Function used by workspace mutation modules to publish durable changes. */
export type WorkspaceChangeEmitter = (
  change: WorkspaceChangeInput,
) => Promise<void>;

/** Filtering scope for a `workspace.watch()` handle. */
export interface WorkspaceWatchScope {
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: string;
  readonly recursive: boolean;
}

/** Convert a workspace change into a JSON payload for the runtime event log. */
export function workspaceChangePayload(
  input: WorkspaceChangeInput,
): WorkspaceChangeEventPayload {
  const payload = {
    version: 1,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    type: input.type,
    path: input.path,
    at: input.at ?? Date.now(),
  } satisfies WorkspaceChangeEventPayload;
  if (input.type !== "rename") return payload;
  return { ...payload, from: input.from };
}

/** Decode a runtime event into a workspace change event when it matches v1. */
export function workspaceChangeFromRuntimeEvent(
  event: RuntimeEvent,
): WorkspaceChangeEvent | undefined {
  if (event.name !== WORKSPACE_CHANGE_EVENT_NAME) return undefined;
  const payload = event.payload;
  if (!isWorkspaceChangeEventPayload(payload)) return undefined;
  const base = {
    workspaceId: payload.workspaceId,
    namespace: payload.namespace,
    path: payload.path,
    cursor: event.eventId,
    at: payload.at,
  };
  if (payload.type === "rename") {
    if (typeof payload.from !== "string") return undefined;
    return { ...base, type: "rename", from: payload.from };
  }
  return { ...base, type: payload.type };
}

/** Test whether a decoded event belongs to a watch scope. */
export function matchesWorkspaceWatchScope(
  event: WorkspaceChangeEvent,
  scope: WorkspaceWatchScope,
): boolean {
  if (event.workspaceId !== scope.workspaceId) return false;
  if (event.namespace !== scope.namespace) return false;
  if (pathMatches(event.path, scope)) return true;
  return event.type === "rename" && pathMatches(event.from, scope);
}

function isWorkspaceChangeEventPayload(
  value: JsonValue,
): value is WorkspaceChangeEventPayload {
  if (!isJsonObject(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.workspaceId !== "string") return false;
  if (typeof value.namespace !== "string") return false;
  if (!isWorkspaceChangeType(value.type)) return false;
  if (typeof value.path !== "string") return false;
  if (typeof value.at !== "number") return false;
  if (value.type !== "rename") return value.from === undefined;
  return typeof value.from === "string";
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkspaceChangeType(value: unknown): value is WorkspaceChangeType {
  return (
    value === "create" ||
    value === "update" ||
    value === "delete" ||
    value === "rename"
  );
}

function pathMatches(path: string, scope: WorkspaceWatchScope): boolean {
  if (scope.path === "/") {
    if (scope.recursive || path === "/") return true;
    return isDirectRootChild(path);
  }
  if (path === scope.path) return true;
  return scope.recursive && path.startsWith(`${scope.path}/`);
}

function isDirectRootChild(path: string): boolean {
  if (!path.startsWith("/") || path === "/") return false;
  return !path.slice(1).includes("/");
}
