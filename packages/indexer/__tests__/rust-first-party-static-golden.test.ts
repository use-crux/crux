import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readStaticIndexRuntimeSharedFixture } from "../contracts/fixtures";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../testing/rust-oxc-frontend";
import { generateFirstPartyStaticGolden } from "./ts-first-party-static-golden-helper";

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
    "matches the captured TypeScript first-party static reference output",
    async () => {
      const expected = readStaticIndexRuntimeSharedFixture(
        "ts-first-party-static-golden",
      );

      const actual = await generateFirstPartyStaticGolden(repoRoot, {
        frontend: "oxc-rust",
        syntaxFrontend: createRustOxcStaticSyntaxFrontend,
      });

      expect(actual.schemaVersion).toBe(expected.schemaVersion);
      expect(actual.fileSelection).toBe(expected.fileSelection);
      expect(actual.projection).toBe(expected.projection);
      expect(actual.rootPlaceholder).toBe(expected.rootPlaceholder);
      expect(actual.totals).toEqual(expected.totals);
      expect(actual.files).toEqual(expected.files);
    },
    300_000,
  );
});
