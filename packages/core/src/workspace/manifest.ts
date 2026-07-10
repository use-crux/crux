/**
 * Workspace manifest rendering for context injection.
 *
 * Produces the markdown system text that lists mounted roots, top-level files,
 * and any explicitly included file contents, so a prompt can see the workspace
 * without calling tools.
 *
 * @module
 */

import type { AssetStore, RecordStore } from "../storage";
import { resolveArtifact } from "./artifacts";
import { mountForPath, normalizePath } from "./path";
import { recordToReadResult } from "./read-result";
import {
  hasWorkspaceMountSource,
  readWorkspaceMountSource,
} from "./virtual-source";
import {
  getRequiredRecord,
  listAllFileEntries,
  listEntries,
  listFileRecords,
} from "./store";
import type {
  NormalizedMount,
  WorkspaceContextOptions,
  WorkspaceListResult,
  WorkspaceReadResult,
} from "./types";

const MANIFEST_FILE_LIMIT = 100;

/** Render the markdown manifest for a workspace namespace. */
export async function renderWorkspaceManifest(args: {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly workspaceId: string;
  readonly mounts: readonly NormalizedMount[];
  readonly namespace: string;
  readonly options?: WorkspaceContextOptions;
}): Promise<string> {
  const { store, assets, workspaceId, mounts, namespace, options } = args;
  const rootListing: WorkspaceListResult = await listEntries({
    store,
    workspaceId,
    namespace,
    mounts,
    queryPath: normalizePath("/"),
    isGlob: false,
  });
  const files = await listAllFileEntries(store, workspaceId, namespace, {
    limit: MANIFEST_FILE_LIMIT,
  });
  const finalArtifacts = await Promise.all(
    (
      await listFileRecords(store, workspaceId, namespace, {
        filter: { status: "final" },
        limit: MANIFEST_FILE_LIMIT,
      })
    ).map((record) =>
      resolveArtifact({ record, store, workspaceId, namespace }),
    ),
  );
  const lines = [
    `## Workspace (${workspaceId})`,
    `Namespace: ${namespace}`,
    "",
    "Mounted roots:",
    ...mounts.map(
      (mount) =>
        `- ${mount.path} (${mountLabel(mount)})${mount.description ? `: ${mount.description}` : ""}`,
    ),
  ];
  if (rootListing.entries.length > 0) {
    lines.push("", "Files:");
    for (const entry of rootListing.entries) {
      if (entry.kind === "directory") {
        lines.push(`- ${entry.path}/`);
      } else {
        lines.push(`- ${entry.path} (${entry.mimeType}, ${entry.size} bytes)`);
      }
    }
    for (const file of files.entries) {
      lines.push(`- ${file.path} (${file.mimeType}, ${file.size} bytes)`);
    }
    if (files.cursor) {
      lines.push(
        `- ...more files omitted; use workspace tools to list additional entries.`,
      );
    }
  }
  if (finalArtifacts.length > 0) {
    lines.push("", "Final artifacts:");
    for (const artifact of finalArtifacts) {
      const label = artifact.kind ?? "artifact";
      lines.push(
        `- ${artifact.path} (${label}, ${artifact.mimeType}, ${artifact.size} bytes)`,
      );
    }
    if (finalArtifacts.length >= MANIFEST_FILE_LIMIT) {
      lines.push(
        `- ...more final artifacts omitted; use workspace tools to list additional entries.`,
      );
    }
  }
  lines.push(
    "",
    "Use workspace tools to list and read file contents when needed. Binary files are returned as metadata/URI references.",
  );

  const includes = options?.include ?? [];
  if (includes.length > 0) {
    lines.push("", "Included workspace files:");
    for (const include of includes) {
      const normalized = normalizePath(include);
      const mount = mountForPath(normalized, mounts, "read");
      if (hasWorkspaceMountSource(mount)) {
        const result = await readWorkspaceMountSource(mount, normalized, {
          maxInlineBytes: options?.maxInlineBytes,
        });
        if (!result) {
          throw new Error(`workspace file not found: "${include}".`);
        }
        pushIncludedFile(lines, result);
        continue;
      }

      const record = await getRequiredRecord(
        store,
        workspaceId,
        namespace,
        normalized,
      );
      const result = await recordToReadResult(record, {
        assets,
        maxInlineBytes: options?.maxInlineBytes,
      });
      pushIncludedFile(lines, result);
    }
  }

  return lines.join("\n");
}

function pushIncludedFile(lines: string[], result: WorkspaceReadResult): void {
  if (result.kind === "text") {
    lines.push(`### ${result.path}`, result.content);
  } else if (result.kind === "json") {
    lines.push(
      `### ${result.path}`,
      "```json",
      JSON.stringify(result.content, null, 2),
      "```",
    );
  } else {
    lines.push(
      `### ${result.path}`,
      `[binary ${result.mimeType}, ${result.size} bytes]`,
    );
  }
}

function mountLabel(mount: NormalizedMount): string {
  return mount.source
    ? `${mount.access}, source: ${mount.source.kind}`
    : mount.access;
}
