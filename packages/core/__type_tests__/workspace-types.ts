import { expectTypeOf } from "vitest";
import { z } from "zod";
import { workspace, retrieverWorkspaceMountSource } from "../workspace";
import type {
  WorkspaceLimits,
  WorkspaceProvenance,
  WorkspaceRetention,
} from "../index";
import type { Context } from "../prompt/context-types";
import type { Retriever } from "../retrieval";
import type {
  WorkspaceArtifact,
  WorkspaceCustomMountSource,
  WorkspaceContent,
  WorkspaceJsonContent,
  WorkspaceMountGrepOptions,
  WorkspaceMountListOptions,
  WorkspaceMountPathOptions,
  WorkspaceMountReadOptions,
  WorkspaceRetrieverMountSource,
  WorkspaceRetrieverMountSourceOptions,
  WorkspaceMountSource,
  WorkspaceTools,
} from "../workspace";

const ws = workspace({ id: "research", namespace: "thread:1" });

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
    pathForHit: (hit) => `${hit.sourceId}/${hit.chunkId}.md`,
  }),
).toExtend<WorkspaceCustomMountSource>();
expectTypeOf<{
  query: "docs";
  limit: 5;
}>().toExtend<WorkspaceRetrieverMountSourceOptions>();
