/**
 * In-memory Storage Beta adapters.
 *
 * Use these factories for tests, examples, and local development when a
 * process-local implementation is sufficient.
 *
 * @module
 */

import { storage } from "./bundle";
import { inMemoryAssetStore } from "../asset";
import { inMemoryRecordStore } from "./memory-record";
import { inMemorySearchStore } from "./memory-search";
import type { Storage } from "./types";

export { inMemoryAssetStore } from "../asset";
export { inMemoryRecordStore } from "./memory-record";
export { inMemorySearchStore } from "./memory-search";

/** Create the default in-memory storage bundle. */
export function inMemoryStorage(): Storage {
  return storage({
    records: inMemoryRecordStore(),
    search: inMemorySearchStore(),
    assets: inMemoryAssetStore(),
  });
}
