import type { DataAccessFact } from "@use-crux/core/project-index";

export type PrimitiveDataAccessKind = "read" | "write";
export type PrimitiveDataAccessOperation = NonNullable<
  DataAccessFact["operation"]
>;

const readMethods = new Set([
  "get",
  "read",
  "query",
  "find",
  "search",
  "list",
  "readFile",
  "load",
  "grep",
  "artifacts",
  "stat",
  "exists",
]);

const writeMethods = new Set([
  "set",
  "write",
  "update",
  "append",
  "delete",
  "put",
  "writeFile",
  "edit",
  "deleteFile",
  "save",
  "rename",
  "move",
  "copy",
  "finalize",
]);

const exactOperations = new Set([
  "grep",
  "artifacts",
  "stat",
  "exists",
  "rename",
  "move",
  "copy",
  "finalize",
]);

/** Classifies first-party primitive method names as read or write accesses. */
export function dataAccessKindForMethod(
  method: string,
): PrimitiveDataAccessKind | undefined {
  if (readMethods.has(method)) return "read";
  if (writeMethods.has(method)) return "write";
  return undefined;
}

/** Maps first-party primitive method names onto normalized Project Index operations. */
export function dataAccessOperationForMethod(
  method: string,
  kind: PrimitiveDataAccessKind,
): PrimitiveDataAccessOperation {
  if (exactOperations.has(method))
    return method as PrimitiveDataAccessOperation;
  if (
    method === "query" ||
    method === "find" ||
    method === "search" ||
    method === "list"
  )
    return "query";
  if (method === "append" || method === "put" || method === "save")
    return "append";
  if (method === "update" || method === "edit") return "update";
  if (method === "delete" || method === "deleteFile") return "delete";
  return kind;
}
