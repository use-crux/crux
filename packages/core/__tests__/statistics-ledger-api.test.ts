import { describe, expect, it } from "vitest";

import * as core from "../src";
import { createMemoryStatisticsLedger } from "../src/statistics";

describe("internal statistics ledger API", () => {
  it("is available to Core hosts without creating a competing root API", () => {
    expect(createMemoryStatisticsLedger()).toBeDefined();
    expect(core).not.toHaveProperty("createMemoryStatisticsLedger");
  });
});
