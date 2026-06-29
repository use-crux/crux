/**
 * Generated workspace tool definitions.
 *
 * Builds the `list`/`read`/`write`/`edit` (and opt-in `delete`) tools that let a
 * model operate on a workspace. The tools delegate to the bound workspace
 * operations; passing a `namespaceOverride` targets a pre-resolved namespace
 * (used by {@link Workspace.inject}).
 *
 * @module
 */

import { z } from 'zod'
import type { ToolDef } from '../types/tool'
import {
  fileModelOutput,
  modelJsonOutput,
  readModelOutput,
  readOptionalPositiveInteger,
  readOptionalString,
  readRequiredString,
  readWorkspaceToolContent,
  workspaceToolNames,
} from './tool-io'
import type {
  WorkspaceContent,
  WorkspaceEditOptions,
  WorkspaceEditPatch,
  WorkspaceFile,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceReadOptions,
  WorkspaceReadResult,
  WorkspaceToolOptions,
  WorkspaceWriteOptions,
} from './types'

/** The bound workspace operations the generated tools delegate to. */
export interface WorkspaceToolOperations {
  list(path: string, options?: WorkspaceListOptions): Promise<WorkspaceListResult>
  read(path: string, options?: WorkspaceReadOptions): Promise<WorkspaceReadResult>
  write(path: string, content: WorkspaceContent, options?: WorkspaceWriteOptions): Promise<WorkspaceFile>
  edit(path: string, patch: WorkspaceEditPatch, options?: WorkspaceEditOptions): Promise<WorkspaceFile>
  remove(path: string): Promise<void>
  listForNamespace(namespace: string, path: string, options?: WorkspaceListOptions): Promise<WorkspaceListResult>
  readForNamespace(namespace: string, path: string, options?: WorkspaceReadOptions): Promise<WorkspaceReadResult>
  writeForNamespace(
    namespace: string,
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile>
  editForNamespace(
    namespace: string,
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile>
  removeForNamespace(namespace: string, path: string): Promise<void>
}

/**
 * Build the `asTools` function for a workspace.
 *
 * @param args.workspaceId - Workspace id, used in tool descriptions.
 * @param args.defaultToolOptions - Tool options from {@link WorkspaceConfig.tools}.
 * @param args.ops - Bound workspace operations.
 * @returns A function producing the tool set, optionally for a fixed namespace.
 */
export function createWorkspaceTools(args: {
  readonly workspaceId: string
  readonly defaultToolOptions?: WorkspaceToolOptions
  readonly ops: WorkspaceToolOperations
}): (options?: WorkspaceToolOptions, namespaceOverride?: string) => Record<string, ToolDef> {
  const { workspaceId, defaultToolOptions, ops } = args
  return (options?: WorkspaceToolOptions, namespaceOverride?: string): Record<string, ToolDef> => {
    const toolOptions = { ...defaultToolOptions, ...options }
    const names = workspaceToolNames(toolOptions)
    const tools: Record<string, ToolDef> = {
      [names.list]: {
        description: `List files in workspace "${workspaceId}". Supports directory paths and simple globs like /workspace/**/*.md.`,
        parameters: z.object({
          path: z.string().optional().describe('Directory path or glob. Defaults to /.'),
          limit: z.number().int().positive().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          namespaceOverride
            ? ops.listForNamespace(namespaceOverride, readOptionalString(toolArgs.path) ?? '/', {
                limit: readOptionalPositiveInteger(toolArgs.limit),
              })
            : ops.list(readOptionalString(toolArgs.path) ?? '/', {
                limit: readOptionalPositiveInteger(toolArgs.limit),
              }),
        toModelOutput: modelJsonOutput('Workspace listing'),
      },
      [names.readFile]: {
        description: `Read a workspace file from "${workspaceId}". Text/JSON may be returned inline; binary files return safe metadata and URI.`,
        parameters: z.object({
          path: z.string().describe('Absolute workspace path, e.g. /workspace/notes.md.'),
          maxInlineBytes: z.number().int().positive().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          namespaceOverride
            ? ops.readForNamespace(namespaceOverride, readRequiredString(toolArgs.path, 'path'), {
                maxInlineBytes: readOptionalPositiveInteger(toolArgs.maxInlineBytes),
              })
            : ops.read(readRequiredString(toolArgs.path, 'path'), {
                maxInlineBytes: readOptionalPositiveInteger(toolArgs.maxInlineBytes),
              }),
        toModelOutput: ({ output }) => readModelOutput(output),
      },
      [names.writeFile]: {
        description: `Write a workspace file in "${workspaceId}". Binary and oversized content require a WorkspaceBlobStore.`,
        parameters: z.object({
          path: z.string().describe('Absolute workspace path, e.g. /outputs/report.md.'),
          content: z.union([z.string(), z.record(z.string(), z.unknown())]).describe('Text content or JSON content.'),
          mimeType: z.string().optional(),
        }),
        execute: (toolArgs: Record<string, unknown>) =>
          namespaceOverride
            ? ops.writeForNamespace(
                namespaceOverride,
                readRequiredString(toolArgs.path, 'path'),
                readWorkspaceToolContent(toolArgs.content),
                {
                  mimeType: readOptionalString(toolArgs.mimeType),
                },
              )
            : ops.write(readRequiredString(toolArgs.path, 'path'), readWorkspaceToolContent(toolArgs.content), {
                mimeType: readOptionalString(toolArgs.mimeType),
              }),
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
          namespaceOverride
            ? ops.editForNamespace(namespaceOverride, readRequiredString(toolArgs.path, 'path'), {
                find: readRequiredString(toolArgs.find, 'find'),
                replace: readRequiredString(toolArgs.replace, 'replace'),
                occurrence: readOptionalPositiveInteger(toolArgs.occurrence),
              })
            : ops.edit(readRequiredString(toolArgs.path, 'path'), {
                find: readRequiredString(toolArgs.find, 'find'),
                replace: readRequiredString(toolArgs.replace, 'replace'),
                occurrence: readOptionalPositiveInteger(toolArgs.occurrence),
              }),
        toModelOutput: fileModelOutput,
      },
    }

    if (toolOptions.delete) {
      tools[names.deleteFile] = {
        description: `Delete a workspace file from "${workspaceId}". This tool is opt-in because deletion is irreversible.`,
        parameters: z.object({
          path: z.string(),
        }),
        execute: async (toolArgs: Record<string, unknown>) => {
          const path = readRequiredString(toolArgs.path, 'path')
          if (namespaceOverride) {
            await ops.removeForNamespace(namespaceOverride, path)
          } else {
            await ops.remove(path)
          }
          return { deleted: true, path }
        },
        toModelOutput: modelJsonOutput('Workspace file deleted'),
      }
    }
    return tools
  }
}
