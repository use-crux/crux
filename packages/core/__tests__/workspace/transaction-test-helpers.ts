import type {
  JsonObject,
  RecordStore,
  RecordWriteOptions,
} from "../../src/storage";

export function failLiveNamespacePut(
  records: RecordStore,
  options: {
    readonly workspaceId: string;
    readonly namespace: string;
    readonly onAttempt: number;
  },
): { readonly records: RecordStore; readonly enable: () => void } {
  let enabled = false;
  let attempts = 0;
  return {
    enable: () => {
      enabled = true;
    },
    records: {
      ...records,
      async put(
        key: string,
        value: JsonObject,
        writeOptions?: RecordWriteOptions,
      ): Promise<void> {
        if (
          enabled &&
          isLiveNamespaceFileKey(key, options.workspaceId, options.namespace)
        ) {
          attempts += 1;
          if (attempts === options.onAttempt) {
            throw new Error("commit write failed");
          }
        }
        await records.put(key, value, writeOptions);
      },
    },
  };
}

export function failStagingNamespacePut(
  records: RecordStore,
  options: { readonly onAttempt: number },
): { readonly records: RecordStore; readonly enable: () => void } {
  let enabled = false;
  let attempts = 0;
  return {
    enable: () => {
      enabled = true;
    },
    records: {
      ...records,
      async put(
        key: string,
        value: JsonObject,
        writeOptions?: RecordWriteOptions,
      ): Promise<void> {
        if (enabled && isStagingNamespaceFileKey(key)) {
          attempts += 1;
          if (attempts === options.onAttempt) {
            throw new Error("staging write failed");
          }
        }
        await records.put(key, value, writeOptions);
      },
    },
  };
}

export function failLiveNamespaceVersionPut(
  records: RecordStore,
  options: {
    readonly workspaceId: string;
    readonly namespace: string;
    readonly onAttempt: number;
  },
): { readonly records: RecordStore; readonly enable: () => void } {
  let enabled = false;
  let attempts = 0;
  return {
    enable: () => {
      enabled = true;
    },
    records: {
      ...records,
      async put(key, value, writeOptions): Promise<void> {
        if (
          enabled &&
          isLiveNamespaceVersionKey(key, options.workspaceId, options.namespace)
        ) {
          attempts += 1;
          if (attempts === options.onAttempt) {
            throw new Error("commit version write failed");
          }
        }
        await records.put(key, value, writeOptions);
      },
    },
  };
}

export function failLiveNamespacePuts(
  records: RecordStore,
  options: {
    readonly workspaceId: string;
    readonly namespace: string;
    readonly failures: ReadonlyMap<number, Error>;
  },
): { readonly records: RecordStore; readonly enable: () => void } {
  let enabled = false;
  let attempts = 0;
  return {
    enable: () => {
      enabled = true;
    },
    records: {
      ...records,
      async put(key, value, writeOptions): Promise<void> {
        if (
          enabled &&
          isLiveNamespaceFileKey(key, options.workspaceId, options.namespace)
        ) {
          attempts += 1;
          const failure = options.failures.get(attempts);
          if (failure) throw failure;
        }
        await records.put(key, value, writeOptions);
      },
    },
  };
}

export function failLiveNamespaceDelete(
  records: RecordStore,
  options: {
    readonly workspaceId: string;
    readonly namespace: string;
    readonly path: string;
  },
): { readonly records: RecordStore; readonly enable: () => void } {
  let enabled = false;
  let failed = false;
  return {
    enable: () => {
      enabled = true;
    },
    records: {
      ...records,
      async delete(key): Promise<void> {
        if (
          enabled &&
          !failed &&
          isLiveNamespaceFileKey(key, options.workspaceId, options.namespace) &&
          decodeURIComponent(key).endsWith(`:file:${options.path}`)
        ) {
          failed = true;
          throw new Error("commit delete failed");
        }
        await records.delete(key);
      },
    },
  };
}

function isLiveNamespaceFileKey(
  key: string,
  workspaceId: string,
  namespace: string,
): boolean {
  const decoded = decodeURIComponent(key);
  return decoded.startsWith(`workspace:${workspaceId}:${namespace}:file:`);
}

function isStagingNamespaceFileKey(key: string): boolean {
  const decoded = decodeURIComponent(key);
  return decoded.includes(".__crux_tx_") && decoded.includes(":file:");
}

function isLiveNamespaceVersionKey(
  key: string,
  workspaceId: string,
  namespace: string,
): boolean {
  const decoded = decodeURIComponent(key);
  return decoded.startsWith(`workspace:${workspaceId}:${namespace}:version:`);
}
