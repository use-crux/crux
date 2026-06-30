/**
 * Generated workspace tool definitions.
 *
 * Builds the `list`/`read`/`write`/`edit` (and opt-in `delete`) tools that let a
 * model operate on a workspace. The tools delegate to the bound workspace
 * operations; passing `namespace` to `asTools()` targets a pre-resolved
 * namespace (used by {@link Workspace.inject}).
 *
 * @module
 */

import { z } from "zod";
import type { ToolDef } from "../types/tool";
import {
  fileModelOutput,
  modelJsonOutput,
  readModelOutput,
  readOptionalBoolean,
  readOptionalPositiveInteger,
  readOptionalString,
  readRequiredString,
  readWorkspaceToolContent,
  workspaceToolNames,
} from "./tool-io";
import type {
  WorkspaceContent,
  WorkspaceDeleteOptions,
  WorkspaceEditOptions,
  WorkspaceEditPatch,
  WorkspaceFile,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceMoveOptions,
  WorkspaceNamespaceOption,
  WorkspaceReadOptions,
  WorkspaceReadResult,
  WorkspaceToolOptions,
  WorkspaceToolDeleteWithDefaults,
  WorkspaceToolPrefixWithDefaults,
  WorkspaceTools,
  WorkspaceToolUndoWithDefaults,
  WorkspaceWriteOptions,
} from "./types";

/** The bound workspace operations the generated tools delegate to. */
export interface WorkspaceToolOperations {
  list(
    path: string,
    options?: WorkspaceListOptions,
  ): Promise<WorkspaceListResult>;
  read(
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult>;
  write(
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile>;
  edit(
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile>;
  rename(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  grep(
    query: string,
    options?: WorkspaceGrepOptions,
  ): Promise<WorkspaceGrepResult>;
  remove(path: string, options?: WorkspaceDeleteOptions): Promise<void>;
  undo(path: string, options?: WorkspaceNamespaceOption): Promise<WorkspaceFile>;
}

/**
 * Build the `asTools` function for a workspace.
 *
 * @param args.workspaceId - Workspace id, used in tool descriptions.
 * @param args.defaultToolOptions - Tool options from {@link WorkspaceConfig.tools}.
 * @param args.ops - Bound workspace operations.
 * @returns A function producing the tool set, optionally for a fixed namespace.
 */
export function createWorkspaceTools<
  const Defaults extends WorkspaceToolOptions | undefined = undefined,
>(args: {
  readonly workspaceId: string;
  readonly defaultToolOptions?: Defaults;
  readonly ops: WorkspaceToolOperations;
}): <
  const Options extends WorkspaceToolOptions & WorkspaceNamespaceOption = {},
>(
  options?: Options,
) => WorkspaceTools<
  WorkspaceToolPrefixWithDefaults<Defaults, Options>,
  WorkspaceToolDeleteWithDefaults<Defaults, Options>,
  WorkspaceToolUndoWithDefaults<Defaults, Options>
> {
  const { workspaceId, defaultToolOptions, ops } = args;
  return <
    const Options extends WorkspaceToolOptions & WorkspaceNamespaceOption = {},
  >(
    options?: Options,
  ): WorkspaceTools<
    WorkspaceToolPrefixWithDefaults<Defaults, Options>,
    WorkspaceToolDeleteWithDefaults<Defaults, Options>,
    WorkspaceToolUndoWithDefaults<Defaults, Options>
  > => {
    const toolOptions = { ...defaultToolOptions, ...options };
    const namespace = options?.namespace;
    const names = workspaceToolNames(toolOptions);
    const tools: Record<string, ToolDef> = {
      [names.list]: {
        description: `List files in workspace "${workspaceId}". Supports directory paths and simple globs like /workspace/**/*.md.`,
        parameters: z.object({
          path: z
            .string()
            .optional()
            .describe("Directory path or glob. Defaults to /."),
          limit: z.number().int().positive().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.list(readOptionalString(toolArgs.path) ?? "/", {
            limit: readOptionalPositiveInteger(toolArgs.limit),
            namespace,
          }),
        toModelOutput: modelJsonOutput("Workspace listing"),
      },
      [names.readFile]: {
        description: `Read a workspace file from "${workspaceId}". Text/JSON may be returned inline; binary files return safe metadata and URI.`,
        parameters: z.object({
          path: z
            .string()
            .describe("Absolute workspace path, e.g. /workspace/notes.md."),
          maxInlineBytes: z.number().int().positive().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.read(readRequiredString(toolArgs.path, "path"), {
            maxInlineBytes: readOptionalPositiveInteger(
              toolArgs.maxInlineBytes,
            ),
            namespace,
          }),
        toModelOutput: ({ output }) => readModelOutput(output),
      },
      [names.writeFile]: {
        description: `Write a workspace file in "${workspaceId}". Binary and oversized content require a WorkspaceBlobStore.`,
        parameters: z.object({
          path: z
            .string()
            .describe("Absolute workspace path, e.g. /outputs/report.md."),
          content: z
            .union([
              z.string(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.number(),
              z.boolean(),
              z.null(),
            ])
            .describe("Text content or JSON content."),
          mimeType: z.string().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.write(
            readRequiredString(toolArgs.path, "path"),
            readWorkspaceToolContent(toolArgs.content),
            {
              mimeType: readOptionalString(toolArgs.mimeType),
              namespace,
            },
          ),
        toModelOutput: fileModelOutput,
      },
      [names.editFile]: {
        description: `Edit a text workspace file in "${workspaceId}" with simple find/replace.`,
        parameters: z.object({
          path: z.string(),
          find: z.string(),
          replace: z.string(),
          occurrence: z.number().int().positive().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.edit(
            readRequiredString(toolArgs.path, "path"),
            {
              find: readRequiredString(toolArgs.find, "find"),
              replace: readRequiredString(toolArgs.replace, "replace"),
              occurrence: readOptionalPositiveInteger(toolArgs.occurrence),
            },
            { namespace },
          ),
        toModelOutput: fileModelOutput,
      },
      [names.renameFile]: {
        description: `Rename or move a workspace file in "${workspaceId}". Fails if the destination exists unless overwrite is true.`,
        parameters: z.object({
          from: z.string().describe("Existing absolute workspace path."),
          to: z.string().describe("Destination absolute workspace path."),
          overwrite: z.boolean().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.rename(
            readRequiredString(toolArgs.from, "from"),
            readRequiredString(toolArgs.to, "to"),
            {
              overwrite: readOptionalBoolean(toolArgs.overwrite),
              namespace,
            },
          ),
        toModelOutput: fileModelOutput,
      },
      [names.grep]: {
        description: `Search text files in workspace "${workspaceId}". Returns at most maxResults matches, defaulting to 100.`,
        parameters: z.object({
          query: z
            .string()
            .describe(
              "Literal text to search for, or a regular expression when regex is true.",
            ),
          path: z
            .string()
            .optional()
            .describe("Optional absolute path or glob scope."),
          ignoreCase: z.boolean().optional(),
          regex: z.boolean().optional(),
          maxResults: z.number().int().positive().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.grep(readRequiredString(toolArgs.query, "query"), {
            path: readOptionalString(toolArgs.path),
            ignoreCase: readOptionalBoolean(toolArgs.ignoreCase),
            regex: readOptionalBoolean(toolArgs.regex),
            maxResults: readOptionalPositiveInteger(toolArgs.maxResults),
            namespace,
          }),
        toModelOutput: modelJsonOutput("Workspace grep matches"),
      },
    };

    if (toolOptions.delete) {
      tools[names.deleteFile] = {
        description: `Delete a workspace file from "${workspaceId}". This tool is opt-in because deletion is irreversible.`,
        parameters: z.object({
          path: z.string(),
        }),
        execute: async (toolArgs: Record<string, unknown>) => {
          const path = readRequiredString(toolArgs.path, "path");
          await ops.remove(path, { namespace });
          return { deleted: true, path };
        },
        toModelOutput: modelJsonOutput("Workspace file deleted"),
      };
    }

    if (toolOptions.undo) {
      tools[names.undoFile] = {
        description: `Revert the last change to a workspace file in "${workspaceId}", restoring its previous version. Appends a new version; never rewrites history.`,
        parameters: z.object({
          path: z
            .string()
            .describe("Absolute workspace path to roll back one version."),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          ops.undo(readRequiredString(toolArgs.path, "path"), { namespace }),
        toModelOutput: fileModelOutput,
      };
    }
    return tools as WorkspaceTools<
      WorkspaceToolPrefixWithDefaults<Defaults, Options>,
      WorkspaceToolDeleteWithDefaults<Defaults, Options>,
      WorkspaceToolUndoWithDefaults<Defaults, Options>
    >;
  };
}
