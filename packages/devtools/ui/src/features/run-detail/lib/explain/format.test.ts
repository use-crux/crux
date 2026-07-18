import { describe, expect, it } from "vitest";
import { fmtAge } from "./format";

describe("fmtAge", () => {
  it("renders sub-hour ages in minutes", () => {
    expect(fmtAge(60_000)).toBe("1m");
    expect(fmtAge(5_400_000 - 3_600_000)).toBe("30m");
  });

  it("renders hour-plus ages in hours, trimming a trailing .0", () => {
    expect(fmtAge(3_600_000)).toBe("1h");
    expect(fmtAge(5_400_000)).toBe("1.5h");
  });

  it("renders a dash for missing ages", () => {
    expect(fmtAge(undefined)).toBe("—");
  });
});
