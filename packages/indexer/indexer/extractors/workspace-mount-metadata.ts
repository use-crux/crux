import type { StaticObjectReader } from "../extensions";

export const RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER =
  "retrieverWorkspaceMountSource";

export const RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES = [
  "list",
  "read",
  "grep",
  "exists",
  "stat",
] as const;

export const WORKSPACE_MOUNT_SOURCE_CAPABILITY_PROPERTIES = [
  "list",
  "read",
  "grep",
  "exists",
  "stat",
  "write",
  "delete",
] as const;

export interface WorkspaceMountSourceMetadata {
  readonly kind: string;
  readonly retriever?: string;
  readonly helper?: string;
  readonly reference?: string;
  readonly capabilities?: readonly string[];
}

export interface WorkspaceMountMetadata {
  readonly path?: string;
  readonly access?: string;
  readonly description?: string;
  readonly source?: WorkspaceMountSourceMetadata;
}

/**
 * Converts authored mount objects into JSON-like metadata suitable for index consumers.
 *
 * Source-backed mounts keep a compact provider summary so detail views can distinguish local,
 * retriever-backed, helper-backed, and custom provider mounts without exposing executable values.
 */
export function workspaceMountsMetadata(
  mounts: readonly StaticObjectReader[],
): WorkspaceMountMetadata[] | undefined {
  const metadata = mounts
    .map((mount) =>
      compactWorkspaceMountMetadata({
        path: mount.string("path"),
        access: mount.string("access"),
        description: mount.string("description"),
        source: workspaceMountSourceMetadata(mount),
      }),
    )
    .filter(isDefined);
  return metadata.length > 0 ? metadata : undefined;
}

/** Builds the mount/source payload consumed by Project Index detail views. */
export function workspaceMountIntelligenceData(
  mounts: readonly WorkspaceMountMetadata[] | undefined,
): Record<string, unknown> {
  if (!mounts || mounts.length === 0) return {};
  const mountRows = mounts
    .filter((mount): mount is WorkspaceMountMetadata & { readonly path: string } =>
      typeof mount.path === "string",
    )
    .map((mount) =>
      compactRecord({
        path: mount.path,
        access: mount.access,
        description: mount.description,
        sourceKind: mount.source?.kind,
        sourceHelper: mount.source?.helper,
        sourceReference: mount.source?.reference,
        sourceRetriever: mount.source?.retriever,
        sourceCapabilities: mount.source?.capabilities,
      }),
    );
  return {
    mounts: mountRows,
    artifacts: mountRows.map((mount) =>
      compactRecord({
        name: mount.path,
        kind: mount.access ?? "mount",
        sourceKind: mount.sourceKind,
        sourceHelper: mount.sourceHelper,
      }),
    ),
  };
}

export function compactWorkspaceMountMetadata(
  mount: WorkspaceMountMetadata,
): WorkspaceMountMetadata | undefined {
  const metadata = compactRecord(mount);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function compactWorkspaceMountSourceMetadata(
  source: WorkspaceMountSourceMetadata,
): WorkspaceMountSourceMetadata | undefined {
  const metadata = compactRecord(source);
  return Object.keys(metadata).length > 0
    ? (metadata as WorkspaceMountSourceMetadata)
    : undefined;
}

function workspaceMountSourceMetadata(
  mount: StaticObjectReader,
): WorkspaceMountSourceMetadata | undefined {
  const source = mount.object("source");
  if (source) return workspaceMountObjectSourceMetadata(source);
  if (!mount.has("source")) return undefined;

  const helper = mount.callName("source");
  if (helper === RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER) {
    return {
      kind: "retriever",
      helper: RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER,
      capabilities: RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES,
    };
  }
  const reference = helper ? undefined : mount.reference("source");
  return compactWorkspaceMountSourceMetadata({
    kind: helper || reference ? "custom" : "unknown",
    helper,
    reference,
  });
}

function workspaceMountObjectSourceMetadata(
  source: StaticObjectReader,
): WorkspaceMountSourceMetadata | undefined {
  const kind = source.string("kind") ?? "custom";
  return compactWorkspaceMountSourceMetadata({
    kind,
    retriever: source.reference("retriever"),
    capabilities: workspaceMountSourceCapabilities(source, kind),
  });
}

function workspaceMountSourceCapabilities(
  source: StaticObjectReader,
  kind: string,
): readonly string[] | undefined {
  if (kind === "retriever") return RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES;
  const capabilities = WORKSPACE_MOUNT_SOURCE_CAPABILITY_PROPERTIES.filter(
    (property) => source.has(property),
  );
  return capabilities.length > 0 ? capabilities : undefined;
}

function compactRecord<T extends object>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
