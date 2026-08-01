import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readStaticIndexRuntimeSharedFixture } from "../src/contracts/fixtures";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";
import { generateRustFirstPartyStaticGolden } from "./first-party-static-golden-helper";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runFullRustGolden =
  process.env.CRUX_RUST_FIRST_PARTY_STATIC_GOLDEN_REQUIRED === "1";
const rustOxcStatus = runFullRustGolden
  ? rustOxcSyntaxFrontendTestStatus()
  : {
      available: false,
      reason: "CRUX_RUST_FIRST_PARTY_STATIC_GOLDEN_REQUIRED is not set",
    };
const itWhenRustGoldenRequired =
  runFullRustGolden && rustOxcStatus.available ? it : it.skip;

describe("Rust first-party static golden", () => {
  itWhenRustGoldenRequired(
    "matches the captured Rust first-party static golden",
    async () => {
      const expected = readStaticIndexRuntimeSharedFixture(
        "rust-first-party-static-golden",
      );

      const actual = await generateRustFirstPartyStaticGolden(repoRoot, {
        syntaxFrontend: createRustOxcStaticSyntaxFrontend,
      });

      if (process.env.CRUX_UPDATE_RUST_FIRST_PARTY_STATIC_GOLDEN === "1") {
        await writeFile(
          resolve(
            repoRoot,
            "packages/indexer/src/contracts/fixtures/rust-first-party-static-golden.json",
          ),
          `${JSON.stringify(actual, null, 2)}\n`,
        );
        return;
      }

      expect(actual.schemaVersion).toBe(expected.schemaVersion);
      expect(actual.fileSelection).toBe(expected.fileSelection);
      expect(actual.projection).toBe(expected.projection);
      expect(actual.rootPlaceholder).toBe(expected.rootPlaceholder);
      expect(actual.files).toEqual(expected.files);
      expect(actual.totals).toEqual(expected.totals);
    },
    300_000,
  );
});
