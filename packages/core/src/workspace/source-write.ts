/**
 * Write helpers for source-backed workspace mounts.
 *
 * Source-backed mutations are explicit provider opt-ins. Crux validates the
 * workspace path and delegates the byte write/delete to the mount source
 * instead of storing provider-owned content in the local workspace store.
 *
 * @module
 */

import { workspaceMountSourceToCustomSource } from "./mount-source";
import { normalizePath } from "./path";
import { virtualFileFromReadResult } from "./read-result-file";
import type {
  WorkspaceContent,
  WorkspaceCustomMountSource,
  WorkspaceFile,
  WorkspaceMountPathOptions,
  WorkspaceMountWriteOptions,
  WorkspacePath,
  WorkspaceReadResult,
} from "./types";
import type { SourceBackedMount } from "./virtual-source";

/** Delegate a workspace write/edit/append to a source-backed mount. */
export async function writeWorkspaceMountSource(
  mount: SourceBackedMount,
  path: WorkspacePath,
  content: WorkspaceContent,
  options: WorkspaceMountWriteOptions,
): Promise<WorkspaceFile> {
  const source = workspaceMountSourceToCustomSource(mount.source);
  const operation = options.operation ?? "write";
  if (!source.write) {
    throw new Error(
      `workspace.${operation}(): source-backed mount "${mount.path}" does not support writes.`,
    );
  }

  const result = await source.write(path, content, {
    ...options,
    mountPath: mount.path,
  });
  if (result) return normalizeSourceWriteResult(result, path, mount);

  const reread = await readWrittenSourceFile(source.read, path, mount);
  if (reread) return fileFromReadResult(reread, path, mount);

  throw new Error(
    `workspace.${operation}(): source-backed mount "${mount.path}" wrote "${path}" but did not return file metadata.`,
  );
}

/** Delegate a workspace delete to a source-backed mount. */
export async function deleteWorkspaceMountSource(
  mount: SourceBackedMount,
  path: WorkspacePath,
  options: WorkspaceMountPathOptions = {},
): Promise<void> {
  const source = workspaceMountSourceToCustomSource(mount.source);
  if (!source.delete) {
    throw new Error(
      `workspace.delete(): source-backed mount "${mount.path}" does not support deletes.`,
    );
  }
  await source.delete(path, { ...options, mountPath: mount.path });
}

function normalizeSourceWriteResult(
  result: WorkspaceFile | WorkspaceReadResult,
  path: WorkspacePath,
  mount: SourceBackedMount,
): WorkspaceFile {
  return result.kind === "file"
    ? normalizeFile(result, mount)
    : fileFromReadResult(result, path, mount);
}

async function readWrittenSourceFile(
  read: WorkspaceCustomMountSource["read"],
  path: WorkspacePath,
  mount: SourceBackedMount,
): Promise<WorkspaceReadResult | null> {
  const delaysMs = [0, 25, 75];
  for (const delayMs of delaysMs) {
    if (delayMs > 0) await delay(delayMs);
    const result = await read(path, { mountPath: mount.path });
    if (result) return result;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileFromReadResult(
  result: WorkspaceReadResult,
  path: WorkspacePath,
  mount: SourceBackedMount,
): WorkspaceFile {
  return virtualFileFromReadResult({ ...result, path }, mount.path);
}

function normalizeFile(
  file: WorkspaceFile,
  mount: SourceBackedMount,
): WorkspaceFile {
  const path = normalizeProviderEntryPath(file.path, mount);
  return { ...file, path, mount: mount.path, storage: "virtual" };
}

function normalizeProviderEntryPath(
  rawPath: string,
  mount: SourceBackedMount,
): WorkspacePath {
  const path = normalizePath(rawPath);
  if (path !== mount.path && !path.startsWith(`${mount.path}/`)) {
    throw new Error(
      `workspace mount source "${mount.source.kind}" returned path outside mount "${mount.path}".`,
    );
  }
  return path;
}
