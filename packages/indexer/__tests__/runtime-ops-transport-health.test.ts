/**
 * Runtime status transport-health loading must use a bounded program import.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("runtime status transport binding health loading", () => {
  it("imports the generated program with an explicit bounded timeout", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/indexer/runtime-ops.ts", import.meta.url)),
      "utf8",
    );

    // Missing timeoutMs made withTimeout race setTimeout(undefined) (~1ms) and
    // silently drop transports from Runtime status / Devtools.
    expect(source).toMatch(
      /importUserModule\(\s*modulePath\s*,\s*8_000\s*,\s*root\s*\)/,
    );
  });
});
