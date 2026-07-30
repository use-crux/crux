import { describe, expect, it } from "vitest";
import { evidence as rootEvidence } from "../../src";
import { evidence as subpathEvidence } from "../../src/evidence";

describe("evidence public imports", () => {
  it("exports one frozen namespace from the root and focused subpath", () => {
    expect(rootEvidence).toBe(subpathEvidence);
    expect(Object.isFrozen(rootEvidence)).toBe(true);
    expect(Object.keys(rootEvidence).sort()).toEqual(["inspect", "record"]);
  });
});
