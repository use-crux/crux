import { describe, expect, it } from "vitest";
import { definitionFingerprintFile } from "../src/indexer/definitions";

describe("definition fingerprint source identity", () => {
  it("is stable across absolute checkout roots", () => {
    expect(
      definitionFingerprintFile("/tmp/checkout-a", "/tmp/checkout-a/src/catalog.ts"),
    ).toBe(
      definitionFingerprintFile("/var/build/checkout-b", "/var/build/checkout-b/src/catalog.ts"),
    );
  });

  it("normalizes relative and Windows-style source paths", () => {
    expect(definitionFingerprintFile("/tmp/checkout", "src/catalog.ts")).toBe(
      "src/catalog.ts",
    );
    expect(
      definitionFingerprintFile("C:\\checkout", "C:\\checkout\\src\\catalog.ts"),
    ).toBe("src/catalog.ts");
  });
});
