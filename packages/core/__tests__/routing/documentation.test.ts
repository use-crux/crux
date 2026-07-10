import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("routing documentation", () => {
  it("documents the full canonical receipt shape without an inner artifact kind", () => {
    const receiptGuide = readRepoFile("apps/docs/content/docs/guides/routing/receipts.mdx");
    const streamingGuide = readRepoFile("apps/docs/content/docs/guides/routing/streaming.mdx");
    const fallbackGuide = readRepoFile("apps/docs/content/docs/guides/routing/fallback.mdx");
    const cascadeGuide = readRepoFile("apps/docs/content/docs/guides/routing/cascade.mdx");
    const observabilityReference = readRepoFile(
      "apps/docs/content/docs/reference/crux-core/observability.mdx",
    );
    const readme = readRepoFile("packages/core/README.md");
    const architecture = readRepoFile("packages/core/ARCHITECTURE.md");

    expect(receiptGuide).toContain("firstTokenAt?: number");
    expect(receiptGuide).toContain("receipt itself has no `kind` property");
    expect(streamingGuide).toContain("firstTokenAt");
    expect(fallbackGuide).toContain("error text");
    expect(cascadeGuide).toContain("note");
    expect(cascadeGuide).toContain("budget");
    expect(observabilityReference).toContain("receipt itself has no inner `kind`");
    expect(observabilityReference).toContain(
      "unavailable `cost` values are represented as `null`",
    );
    expect(readme).toContain("firstTokenAt");
    expect(architecture).toContain("firstTokenAt");
  });
});
