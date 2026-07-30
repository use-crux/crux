/**
 * Compile-time contract for the standard config storage bundle.
 *
 * Runs under `tsc --noEmit`; the expected error preserves targeted migration
 * guidance in editor tooling without retaining the old configuration shape.
 */

import { config } from "../src/runtime/config";
import { inMemoryRecordStore } from "../src/storage";

const records = inMemoryRecordStore();

config({
  storage: { records },
});

config({
  // @ts-expect-error Configure the standard `storage` bundle instead.
  persistence: { records },
});
