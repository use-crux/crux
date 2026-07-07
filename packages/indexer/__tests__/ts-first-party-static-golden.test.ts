import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readStaticIndexRuntimeSharedFixture } from "../contracts/fixtures";
import { generateTsFirstPartyStaticGolden } from "./ts-first-party-static-golden-helper";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runFullGolden =
  process.env.CRUX_TS_FIRST_PARTY_STATIC_GOLDEN_REQUIRED === "1";
const itWhenFullGoldenRequired = runFullGolden ? it : it.skip;

describe("TypeScript first-party static golden", () => {
  it("loads the compact TypeScript reference golden fixture metadata", () => {
    const fixture = readStaticIndexRuntimeSharedFixture(
      "ts-first-party-static-golden",
    );

    expect(fixture).toMatchObject({
      schemaVersion: 1,
      frontend: "typescript",
      rootPlaceholder: "<repo>",
      totals: {
        files: 569,
        definitions: 393,
        relations: 231,
        diagnostics: 15,
        dependencies: 1811,
        canonicalBytes: 2557056,
      },
    });
    expect(fixture.files).toHaveLength(fixture.totals.files);
  });

  itWhenFullGoldenRequired(
    "regenerates the TypeScript first-party static reference output over the repo corpus",
    async () => {
      const expected = readStaticIndexRuntimeSharedFixture(
        "ts-first-party-static-golden",
      );

      await expect(generateTsFirstPartyStaticGolden(repoRoot)).resolves.toEqual(
        expected,
      );
    },
    300_000,
  );
});
