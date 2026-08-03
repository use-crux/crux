import type {
  IndexedStorageCapabilities,
  ProjectDefinitionKind,
} from "@use-crux/core/project-index";

export type SemanticStorageDefinitionKind = Extract<
  ProjectDefinitionKind,
  | "storage.recordStore"
  | "storage.searchStore"
  | "storage.assetStore"
  | "storage.bundle"
  | "storage.scope"
>;

export interface SemanticStorageFactoryDescriptor {
  readonly kind: SemanticStorageDefinitionKind;
  readonly backend?: string;
  readonly capabilities?: IndexedStorageCapabilities;
}

const inMemoryRecordCapabilities = {
  record: { ttl: "lazy", filter: "scan", watch: true, batch: false },
} as const satisfies IndexedStorageCapabilities;

const inMemorySearchCapabilities = {
  search: {
    legs: { dense: true, sparse: true, lexical: false },
    fusion: ["rrf"],
    filter: "pre",
    consistency: "strong",
  },
} as const satisfies IndexedStorageCapabilities;

const postgresSearchCapabilities = (
  sparse: boolean,
  lexical: boolean,
): IndexedStorageCapabilities => ({
  search: {
    legs: { dense: true, sparse, lexical },
    fusion: sparse || lexical ? ["rrf"] : [],
    filter: "pre",
    consistency: "strong",
  },
});

const convexSearchCapabilities = {
  search: {
    legs: { dense: true, sparse: false, lexical: false },
    fusion: [],
    filter: "post",
    consistency: "strong",
  },
} as const satisfies IndexedStorageCapabilities;

const upstashSearchCapabilities = {
  search: {
    legs: { dense: true, sparse: false, lexical: false },
    fusion: [],
    filter: "pre",
    consistency: "eventual",
  },
} as const satisfies IndexedStorageCapabilities;

const postgresRecordCapabilities = {
  record: { ttl: "lazy", filter: "native", watch: false, batch: true },
} as const satisfies IndexedStorageCapabilities;

const storageFactoryByCallName: Readonly<
  Record<string, SemanticStorageFactoryDescriptor | undefined>
> = {
  storage: { kind: "storage.bundle", backend: "storage" },
  scope: { kind: "storage.scope" },
  inMemoryRecordStore: {
    kind: "storage.recordStore",
    backend: "inMemoryRecordStore",
    capabilities: inMemoryRecordCapabilities,
  },
  inMemorySearchStore: {
    kind: "storage.searchStore",
    backend: "inMemorySearchStore",
    capabilities: inMemorySearchCapabilities,
  },
  inMemoryAssetStore: {
    kind: "storage.assetStore",
    backend: "inMemoryAssetStore",
  },
  inMemoryStorage: {
    kind: "storage.bundle",
    backend: "inMemoryStorage",
    capabilities: {
      ...inMemoryRecordCapabilities,
      ...inMemorySearchCapabilities,
    },
  },
  convexRecordStore: {
    kind: "storage.recordStore",
    backend: "convexRecordStore",
    capabilities: {
      record: { ttl: "lazy", filter: "scan", watch: false, batch: false },
    },
  },
  convexSearchStore: {
    kind: "storage.searchStore",
    backend: "convexSearchStore",
    capabilities: convexSearchCapabilities,
  },
  convexAssetStore: {
    kind: "storage.assetStore",
    backend: "convexAssetStore",
  },
  convexStorage: {
    kind: "storage.bundle",
    backend: "convexStorage",
    capabilities: {
      record: { ttl: "lazy", filter: "scan", watch: false, batch: false },
      ...convexSearchCapabilities,
    },
  },
  upstashRedisRecordStore: {
    kind: "storage.recordStore",
    backend: "upstashRedisRecordStore",
    capabilities: {
      record: { ttl: "native", filter: "scan", watch: "unknown", batch: false },
    },
  },
  upstashSearchStore: {
    kind: "storage.searchStore",
    backend: "upstashSearchStore",
    capabilities: upstashSearchCapabilities,
  },
  postgresRecordStore: {
    kind: "storage.recordStore",
    backend: "postgresRecordStore",
    capabilities: postgresRecordCapabilities,
  },
  postgresSearchStore: {
    kind: "storage.searchStore",
    backend: "postgresSearchStore",
    capabilities: postgresSearchCapabilities(false, false),
  },
  postgresStorage: {
    kind: "storage.bundle",
    backend: "postgresStorage",
    capabilities: {
      ...postgresRecordCapabilities,
      ...postgresSearchCapabilities(false, false),
    },
  },
};

/** Storage factory names that make a file semantically relevant. */
export const semanticStorageCallNames = Object.keys(
  storageFactoryByCallName,
).sort();

/** Returns the beta storage descriptor for a known factory call. */
export function semanticStorageFactoryDescriptor(
  callName: string | undefined,
  hasLiteralSparseDimensions = false,
  hasLiteralLexical = false,
): SemanticStorageFactoryDescriptor | undefined {
  const descriptor = callName ? storageFactoryByCallName[callName] : undefined;
  if (
    !descriptor ||
    (!hasLiteralSparseDimensions && !hasLiteralLexical) ||
    (callName !== "postgresSearchStore" && callName !== "postgresStorage")
  ) {
    return descriptor;
  }
  return {
    ...descriptor,
    capabilities: {
      ...(callName === "postgresStorage" ? postgresRecordCapabilities : {}),
      ...postgresSearchCapabilities(
        hasLiteralSparseDimensions,
        hasLiteralLexical,
      ),
    },
  };
}

/** Returns whether a Project Index kind belongs to the Storage Beta vocabulary. */
export function isSemanticStorageDefinitionKind(
  kind: ProjectDefinitionKind,
): kind is SemanticStorageDefinitionKind {
  return (
    kind === "storage.recordStore" ||
    kind === "storage.searchStore" ||
    kind === "storage.assetStore" ||
    kind === "storage.bundle" ||
    kind === "storage.scope"
  );
}

/** Returns whether an object literal carries Storage Beta bundle fields. */
export function hasSemanticStorageBundleFields(
  fields: ReadonlySet<string>,
): boolean {
  return fields.has("records") || fields.has("search") || fields.has("assets");
}
