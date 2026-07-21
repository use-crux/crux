/** Opaque logical pagination cursors for Workspace snapshot listings. */

import { WorkspaceSnapshotError } from "./types";

interface WorkspaceSnapshotCursor {
  readonly version: 1;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: string | null;
  readonly createdAt: number;
  readonly id: string;
}

/** Encode the last logical sort tuple and its bound listing scope. */
export function encodeSnapshotCursor(cursor: WorkspaceSnapshotCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Decode and validate a cursor against the current listing scope. */
export function decodeSnapshotCursor(
  encoded: string,
  scope: Pick<WorkspaceSnapshotCursor, "workspaceId" | "namespace" | "path">,
): WorkspaceSnapshotCursor {
  try {
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isSnapshotCursor(value) || !cursorMatchesScope(value, scope)) {
      throw new Error();
    }
    return value;
  } catch {
    throw new WorkspaceSnapshotError(
      "invalid_cursor",
      "Snapshot list cursor is invalid for this Workspace scope.",
    );
  }
}

function isSnapshotCursor(value: unknown): value is WorkspaceSnapshotCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<WorkspaceSnapshotCursor>;
  return (
    cursor.version === 1 &&
    isNonEmptyString(cursor.workspaceId) &&
    isNonEmptyString(cursor.namespace) &&
    (cursor.path === null || typeof cursor.path === "string") &&
    typeof cursor.createdAt === "number" &&
    Number.isFinite(cursor.createdAt) &&
    cursor.createdAt >= 0 &&
    isNonEmptyString(cursor.id)
  );
}

function cursorMatchesScope(
  cursor: WorkspaceSnapshotCursor,
  scope: Pick<WorkspaceSnapshotCursor, "workspaceId" | "namespace" | "path">,
): boolean {
  return (
    cursor.workspaceId === scope.workspaceId &&
    cursor.namespace === scope.namespace &&
    cursor.path === scope.path
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
