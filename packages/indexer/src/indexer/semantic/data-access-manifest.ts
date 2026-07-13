import type { DataAccessFact } from "@use-crux/core/project-index";

export type PrimitiveDataAccessKind = "read" | "write";
export type PrimitiveDataAccessOperation = NonNullable<
  DataAccessFact["operation"]
>;
export type PrimitiveDataAccessTargetKind = NonNullable<
  DataAccessFact["targetKind"]
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
  "watch",
  "history",
  "diff",
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
  "undo",
  "finalize",
  "transaction",
]);

const exactOperations = new Set([
  "grep",
  "artifacts",
  "stat",
  "exists",
  "watch",
  "rename",
  "move",
  "copy",
  "history",
  "diff",
  "undo",
  "finalize",
  "transaction",
]);

const targetKindDeclarations = [
  { kind: "blackboard", aliases: ["blackboard", "board"] },
  { kind: "workspace", aliases: ["workspace", "file", "fs"] },
  { kind: "storage.recordStore", aliases: ["record"] },
  { kind: "storage.vectorStore", aliases: ["vector"] },
  { kind: "storage.assetStore", aliases: ["asset"] },
  { kind: "storage.bundle", aliases: ["storage"] },
  { kind: "store", aliases: ["store"] },
  { kind: "block", aliases: ["block"] },
  { kind: "memory", aliases: ["memory", "mem", "state"] },
] satisfies readonly {
  readonly kind: PrimitiveDataAccessTargetKind;
  readonly aliases: readonly string[];
}[];

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

/** Maps authored target variable names onto normalized Project Index target kinds. */
export function dataAccessTargetKindForVariable(
  targetVariable: string,
): PrimitiveDataAccessTargetKind | undefined {
  const tokens = identifierTokens(targetVariable);
  return targetKindDeclarations.find((declaration) =>
    declaration.aliases.some((alias) => tokens.includes(alias)),
  )?.kind;
}

function identifierTokens(identifier: string): readonly string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
