/**
 * Aggregation helpers for grepping source-backed workspace mounts.
 *
 * @module
 */

import {
  grepWorkspaceMountSource,
  hasWorkspaceMountSource,
} from "./virtual-source";
import type {
  NormalizedMount,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
} from "./types";

/** Grep every source-backed mount until the caller's result budget is filled. */
export async function grepWorkspaceSourceMounts(input: {
  readonly mounts: readonly NormalizedMount[];
  readonly query: string;
  readonly options: WorkspaceGrepOptions | undefined;
  readonly usedResults: number;
}): Promise<readonly WorkspaceGrepMatch[]> {
  const maxResults =
    input.options?.maxResults && input.options.maxResults > 0
      ? input.options.maxResults
      : 100;
  const matches: WorkspaceGrepMatch[] = [];

  for (const mount of input.mounts) {
    if (!hasWorkspaceMountSource(mount)) continue;
    const remaining = maxResults - input.usedResults - matches.length;
    if (remaining <= 0) break;
    const result = await grepWorkspaceMountSource(mount, input.query, {
      path: mount.path,
      ...(input.options?.ignoreCase !== undefined
        ? { ignoreCase: input.options.ignoreCase }
        : {}),
      ...(input.options?.regex !== undefined
        ? { regex: input.options.regex }
        : {}),
      maxResults: remaining,
    });
    matches.push(...result.matches);
  }

  return matches;
}
