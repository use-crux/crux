import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";
import { assertStaticRepositoryInvariants } from "./static-repository-invariants";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const required = process.env.CRUX_STATIC_INDEX_CONTRACTS_REQUIRED === "1";
const rustOxcStatus = required
  ? rustOxcSyntaxFrontendTestStatus()
  : {
      available: false,
      reason: "CRUX_STATIC_INDEX_CONTRACTS_REQUIRED is not set",
    };
const itWhenRequired = required && rustOxcStatus.available ? it : it.skip;

describe("Rust/Oxc first-party repository invariants", () => {
  itWhenRequired(
    "is structurally valid and deterministic",
    async () => {
      await assertStaticRepositoryInvariants(repoRoot, {
        syntaxFrontend: createRustOxcStaticSyntaxFrontend,
      });
    },
    300_000,
  );
});
