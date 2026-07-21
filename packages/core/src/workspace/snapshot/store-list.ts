/** Complete RecordStore pagination for private snapshot storage. */

import type { RecordEntry, RecordStore } from "../../storage";

/** List every record under a prefix while rejecting cyclic backend cursors. */
export async function listAllSnapshotRecords(
  store: RecordStore,
  prefix: string,
): Promise<readonly RecordEntry[]> {
  const records: RecordEntry[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await store.list(prefix, cursor ? { cursor } : undefined);
    records.push(...page.entries);
    cursor = page.cursor;
    if (cursor && seen.has(cursor)) {
      throw new Error("RecordStore returned a repeated pagination cursor.");
    }
    if (cursor) seen.add(cursor);
  } while (cursor);
  return records;
}
