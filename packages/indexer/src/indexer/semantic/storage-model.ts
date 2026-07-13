import type {
  IndexedStorageCapabilities,
  ProjectDefinitionKind,
} from "@use-crux/core/project-index";

export type SemanticStorageDefinitionKind = Extract<
  ProjectDefinitionKind,
  | "storage.recordStore"
  | "storage.vectorStore"
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

const inMemoryVectorCapabilities = {
  vector: {
    dense: true,
    sparse: true,
    hybrid: true,
    fusion: [],
    filter: "pre",
    consistency: "strong",
  },
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
  inMemoryVectorStore: {
    kind: "storage.vectorStore",
    backend: "inMemoryVectorStore",
    capabilities: inMemoryVectorCapabilities,
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
      ...inMemoryVectorCapabilities,
    },
  },
  convexRecordStore: {
    kind: "storage.recordStore",
    backend: "convexRecordStore",
    capabilities: {
      record: { ttl: "lazy", filter: "scan", watch: false, batch: false },
    },
  },
  convexVectorStore: {
    kind: "storage.vectorStore",
    backend: "convexVectorStore",
    capabilities: {
      vector: {
        dense: true,
        sparse: false,
        hybrid: false,
        fusion: [],
        filter: "post",
        consistency: "strong",
      },
    },
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
      vector: {
        dense: true,
        sparse: false,
        hybrid: false,
        fusion: [],
        filter: "post",
        consistency: "strong",
      },
    },
  },
  upstashRedisRecordStore: {
    kind: "storage.recordStore",
    backend: "upstashRedisRecordStore",
    capabilities: {
      record: { ttl: "native", filter: "scan", watch: "unknown", batch: false },
    },
  },
  upstashVectorStore: {
    kind: "storage.vectorStore",
    backend: "upstashVectorStore",
    capabilities: {
      vector: {
        dense: true,
        sparse: false,
        hybrid: false,
        fusion: [],
        filter: "pre",
        consistency: "eventual",
      },
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
): SemanticStorageFactoryDescriptor | undefined {
  return callName ? storageFactoryByCallName[callName] : undefined;
}

/** Returns whether a Project Index kind belongs to the Storage Beta vocabulary. */
export function isSemanticStorageDefinitionKind(
  kind: ProjectDefinitionKind,
): kind is SemanticStorageDefinitionKind {
  return (
    kind === "storage.recordStore" ||
    kind === "storage.vectorStore" ||
    kind === "storage.assetStore" ||
    kind === "storage.bundle" ||
    kind === "storage.scope"
  );
}

/** Returns whether an object literal carries Storage Beta bundle fields. */
export function hasSemanticStorageBundleFields(
  fields: ReadonlySet<string>,
): boolean {
  return fields.has("records") || fields.has("vectors") || fields.has("assets");
}
