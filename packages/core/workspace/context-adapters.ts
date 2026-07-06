/**
 * Workspace context and injection adapters.
 *
 * Converts a workspace namespace into prompt context text, generated tools, and
 * metadata for `use: [workspace]` without expanding the main factory.
 *
 * @module
 */

import { z } from "zod";
import { context } from "../prompt/context";
import type { Context } from "../prompt/context-types";
import type { InternalPromptInjection } from "../prompt/internal-injection";
import type { BlobStore, RecordStore } from "../storage";
import { renderWorkspaceManifest } from "./manifest";
import type {
  NormalizedMount,
  WorkspaceContextOptions,
  WorkspaceNamespaceOption,
  WorkspaceToolDeleteWithDefaults,
  WorkspaceToolOptions,
  WorkspaceToolPrefixWithDefaults,
  WorkspaceTools,
  WorkspaceToolUndoWithDefaults,
} from "./types";

/** Bound dependencies for workspace prompt adapters. */
export interface WorkspaceContextAdaptersConfig<
  Defaults extends WorkspaceToolOptions | undefined = undefined,
> {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly blobs?: BlobStore;
  readonly mounts: readonly NormalizedMount[];
  readonly resolveNamespace: (
    input?: Record<string, unknown>,
    promptId?: string,
  ) => Promise<string>;
  readonly asTools: <
    const Options extends WorkspaceToolOptions & WorkspaceNamespaceOption = {},
  >(
    options?: Options,
  ) => WorkspaceTools<
    WorkspaceToolPrefixWithDefaults<Defaults, Options>,
    WorkspaceToolDeleteWithDefaults<Defaults, Options>,
    WorkspaceToolUndoWithDefaults<Defaults, Options>
  >;
}

/** Context and injection methods exposed by a workspace instance. */
export interface WorkspaceContextAdapters {
  readonly asContext: (
    options?: WorkspaceContextOptions,
  ) => Context<z.ZodObject<{}>>;
  readonly inject: (args: {
    input: Record<string, unknown>;
    promptId?: string;
  }) => Promise<InternalPromptInjection>;
}

/** Create prompt-facing adapters for a workspace instance. */
export function createWorkspaceContextAdapters<
  Defaults extends WorkspaceToolOptions | undefined = undefined,
>(config: WorkspaceContextAdaptersConfig<Defaults>): WorkspaceContextAdapters {
  function asContext(
    options?: WorkspaceContextOptions,
  ): Context<z.ZodObject<{}>> {
    return context({
      id: `workspace:${config.workspaceId}`,
      description: `Workspace: ${config.workspaceId}`,
      input: z.object({}).passthrough(),
      priority: options?.priority ?? 65,
      system: async ({ input }) =>
        renderWorkspaceManifest({
          store: config.store,
          blobs: config.blobs,
          workspaceId: config.workspaceId,
          mounts: config.mounts,
          namespace: await config.resolveNamespace(input),
          options,
        }),
    });
  }

  async function inject(args: {
    input: Record<string, unknown>;
    promptId?: string;
  }): Promise<InternalPromptInjection> {
    const namespace = await config.resolveNamespace(args.input, args.promptId);
    return {
      contexts: [
        context({
          id: `workspace:${config.workspaceId}`,
          description: `Workspace: ${config.workspaceId}`,
          input: z.object({}).passthrough(),
          priority: 65,
          system: () =>
            renderWorkspaceManifest({
              store: config.store,
              blobs: config.blobs,
              workspaceId: config.workspaceId,
              mounts: config.mounts,
              namespace,
            }),
        }),
      ],
      tools: config.asTools({ namespace }),
      metadata: {
        workspace: {
          id: config.workspaceId,
          namespace,
          mounts: config.mounts.map((mount) => ({
            path: mount.path,
            access: mount.access,
          })),
        },
      },
    };
  }

  return { asContext, inject };
}
