import type {
  JsonObject,
  RecordStore,
  RecordWriteOptions,
} from "../../storage";

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
