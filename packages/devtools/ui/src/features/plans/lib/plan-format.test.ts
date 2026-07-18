import { describe, expect, it } from "vitest";
import { taskStatusTone } from "./plan-format";

describe("taskStatusTone", () => {
  it("uses core task statuses without collapsing terminal states", () => {
    expect(taskStatusTone("completed")).toBe("ok");
    expect(taskStatusTone("failed")).toBe("danger");
    expect(taskStatusTone("skipped")).toBe("warn");
    expect(taskStatusTone("cancelled")).toBe("muted");
    expect(taskStatusTone("in_progress")).toBe("crux");
  });
});
