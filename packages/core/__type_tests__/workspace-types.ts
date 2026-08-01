import { expectTypeOf } from "vitest";
import { z } from "zod";
import { workspace, retrieverWorkspaceMountSource } from "../src/workspace";
import type {
  WorkspaceLimits,
  WorkspaceProvenance,
  WorkspaceRetention,
  WorkspaceSnapshotOperations as RootWorkspaceSnapshotOperations,
  WorkspaceSnapshotErrorCode as RootWorkspaceSnapshotErrorCode,
  WorkspaceSnapshotRef as RootWorkspaceSnapshotRef,
} from "../src/index";
import type { Context } from "../src/prompt/context-types";
import type { Retriever } from "../src/retrieval";
import type {
  WorkspaceArtifact,
  WorkspaceChangeEvent,
  WorkspaceCustomMountSource,
  WorkspaceContent,
  WorkspaceJsonContent,
  WorkspaceMountGrepOptions,
  WorkspaceMountListOptions,
  WorkspaceMountPathOptions,
  WorkspaceMountReadOptions,
  WorkspaceRetrieverMountSource,
  WorkspaceRetrieverMountSourceOptions,
  WorkspaceSnapshotOperations,
  WorkspaceSnapshotErrorCode,
  WorkspaceSnapshotPage,
  WorkspaceSnapshotRef,
  WorkspaceSnapshotRestoreResult,
  WorkspaceMountSource,
  WorkspaceTransaction,
  WorkspaceTransactionOptions,
  WorkspaceTools,
  WorkspaceVersionOperation,
  WorkspaceWatchHandle,
  WorkspaceWatchOptions,
} from "../src/workspace";

const ws = workspace({ id: "research", namespace: "thread:1" });

expectTypeOf<keyof typeof ws.snapshot>().toEqualTypeOf<
  "create" | "list" | "restore" | "delete"
>();
expectTypeOf(ws.snapshot).toEqualTypeOf<WorkspaceSnapshotOperations>();
expectTypeOf<WorkspaceSnapshotOperations>().toEqualTypeOf<RootWorkspaceSnapshotOperations>();
expectTypeOf<WorkspaceSnapshotErrorCode>().toEqualTypeOf<RootWorkspaceSnapshotErrorCode>();
expectTypeOf<WorkspaceVersionOperation>().toEqualTypeOf<
  "write" | "edit" | "append" | "undo" | "restore"
>();

declare const snapshotErrorCode: WorkspaceSnapshotErrorCode;
switch (snapshotErrorCode) {
  case "not_found":
  case "invalid_reference":
  case "invalid_cursor":
  case "unsupported_mount":
  case "corrupt_snapshot":
  case "backend_error":
    break;
  default:
    expectTypeOf(snapshotErrorCode).toEqualTypeOf<never>();
}

const snapshot = await ws.snapshot.create({ path: "/outputs" });
expectTypeOf(snapshot).toEqualTypeOf<WorkspaceSnapshotRef>();
expectTypeOf(snapshot).toEqualTypeOf<RootWorkspaceSnapshotRef>();
expectTypeOf(await ws.snapshot.list()).toEqualTypeOf<WorkspaceSnapshotPage>();
expectTypeOf(
  await ws.snapshot.restore(snapshot),
).toEqualTypeOf<WorkspaceSnapshotRestoreResult>();
expectTypeOf(await ws.snapshot.delete(snapshot)).toEqualTypeOf<void>();

declare const snapshotCandidate:
  | WorkspaceSnapshotRef
  | { readonly kind: "other"; readonly value: unknown };
if (snapshotCandidate.kind === "workspace.snapshot") {
  expectTypeOf(snapshotCandidate).toEqualTypeOf<WorkspaceSnapshotRef>();
}

// @ts-expect-error — snapshot references are immutable value objects.
snapshot.id = "replacement";

const persistedSnapshot = JSON.parse(
  JSON.stringify(snapshot),
) as WorkspaceSnapshotRef;
expectTypeOf(
  ws.snapshot.restore(persistedSnapshot),
).resolves.toEqualTypeOf<WorkspaceSnapshotRestoreResult>();

// @ts-expect-error — snapshot operations are grouped under ws.snapshot.
ws.restore(snapshot);

const defaultTools = ws.asTools();
expectTypeOf<keyof typeof defaultTools>().toEqualTypeOf<
  | "listWorkspace"
  | "readWorkspaceFile"
  | "writeWorkspaceFile"
  | "editWorkspaceFile"
  | "renameWorkspaceFile"
  | "grepWorkspace"
>();
expectTypeOf(defaultTools).toEqualTypeOf<WorkspaceTools>();

const researchTools = ws.asTools({ prefix: "research", delete: true });
expectTypeOf<keyof typeof researchTools>().toEqualTypeOf<
  | "listResearchWorkspace"
  | "readResearchWorkspaceFile"
  | "writeResearchWorkspaceFile"
  | "editResearchWorkspaceFile"
  | "renameResearchWorkspaceFile"
  | "grepResearchWorkspace"
  | "deleteResearchWorkspaceFile"
>();

const configured = workspace({
  id: "configured",
  namespace: "thread:1",
  tools: { prefix: "research", delete: true },
});
const configuredTools = configured.asTools();
expectTypeOf<keyof typeof configuredTools>().toEqualTypeOf<
  | "listResearchWorkspace"
  | "readResearchWorkspaceFile"
  | "writeResearchWorkspaceFile"
  | "editResearchWorkspaceFile"
  | "renameResearchWorkspaceFile"
  | "grepResearchWorkspace"
  | "deleteResearchWorkspaceFile"
>();

const context = ws.asContext();
expectTypeOf(context).toEqualTypeOf<Context<z.ZodObject<{}>>>();

expectTypeOf<
  Awaited<ReturnType<typeof ws.finalize>>
>().toEqualTypeOf<WorkspaceArtifact>();
expectTypeOf<Awaited<ReturnType<typeof ws.artifacts>>>().toEqualTypeOf<
  readonly WorkspaceArtifact[]
>();
expectTypeOf<ReturnType<typeof ws.watch>>().toEqualTypeOf<WorkspaceWatchHandle>();
expectTypeOf<{
  namespace: "thread:2";
  recursive: true;
  cursor: "evt_1";
  pollIntervalMs: 50;
  onError(error: {
    readonly error: unknown;
    readonly failures: number;
    readonly retryDelayMs: number;
  }): void;
}>().toExtend<WorkspaceWatchOptions>();

declare const workspaceEvent: WorkspaceChangeEvent;
if (workspaceEvent.type === "rename") {
  expectTypeOf(workspaceEvent.from).toEqualTypeOf<string>();
} else {
  expectTypeOf(workspaceEvent.from).toEqualTypeOf<undefined>();
}

expectTypeOf<string>().toExtend<WorkspaceContent>();
expectTypeOf<{ readonly ok: true }>().toExtend<WorkspaceContent>();
expectTypeOf<readonly ["a", 1]>().toExtend<WorkspaceContent>();
expectTypeOf<number>().toExtend<WorkspaceContent>();
expectTypeOf<Extract<WorkspaceJsonContent, string>>().toEqualTypeOf<never>();
expectTypeOf<{
  runId: "run";
  spanId?: "span";
}>().toExtend<WorkspaceProvenance>();
expectTypeOf<{
  maxFileBytes: 1;
  maxNamespaceBytes: 2;
}>().toExtend<WorkspaceLimits>();
expectTypeOf<{ ttlMs: 1 }>().toExtend<WorkspaceRetention>();
expectTypeOf<{ namespace: "thread:2" }>().toExtend<
  WorkspaceTransactionOptions
>();
expectTypeOf(
  ws.transaction(async (tx) => {
    expectTypeOf(tx).toEqualTypeOf<WorkspaceTransaction>();
    expectTypeOf<
      Awaited<ReturnType<typeof tx.write>>
    >().toExtend<{ path: string }>();
    // @ts-expect-error — transaction callbacks cannot create prompt adapters.
    tx.asContext();
    // @ts-expect-error — transactions cannot create or manage snapshots.
    tx.snapshot.create({ path: "/outputs" });
    // @ts-expect-error — transactions have no root restore alias.
    tx.restore(snapshot);
    return { ok: true as const };
  }),
).resolves.toEqualTypeOf<{ ok: true }>();

expectTypeOf<{
  kind: "custom";
  list: (
    path: string,
    options?: WorkspaceMountListOptions,
  ) => {
    entries: [];
  };
  read: (path: string, options?: WorkspaceMountReadOptions) => null;
  exists: (path: string, options?: WorkspaceMountPathOptions) => true;
  grep: (
    query: string,
    options?: WorkspaceMountGrepOptions,
  ) => {
    matches: [];
  };
}>().toExtend<WorkspaceCustomMountSource>();
expectTypeOf<WorkspaceCustomMountSource>().toExtend<WorkspaceMountSource>();

declare const sourceRetriever: Retriever;
expectTypeOf<{
  kind: "retriever";
  retriever: Retriever;
  query: "docs";
}>().toExtend<WorkspaceRetrieverMountSource>();
expectTypeOf<WorkspaceRetrieverMountSource>().toExtend<WorkspaceMountSource>();
expectTypeOf(
	  retrieverWorkspaceMountSource(sourceRetriever, {
	    query: ({ operation }) => operation,
	    pathForHit: (hit) => hit.kind === "finding"
	      ? `findings/${hit.citation.findingTarget}.md`
	      : `${hit.source.id}/${hit.chunkId}.md`,
	  }),
).toExtend<WorkspaceCustomMountSource>();
expectTypeOf<{
  query: "docs";
  limit: 5;
}>().toExtend<WorkspaceRetrieverMountSourceOptions>();
