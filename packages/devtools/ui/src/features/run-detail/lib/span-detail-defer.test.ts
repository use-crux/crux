import { describe, expect, it } from "vitest";
import { deferPresentationFromAttributes } from "./span-detail-defer";

describe("deferPresentationFromAttributes", () => {
  it("surfaces handler-returned streaming honesty for scheduled work", () => {
    expect(
      deferPresentationFromAttributes(
        {
          mode: "inline",
          completion: "handler-returned",
          sequence: 0,
        },
        "defer.scheduled",
      ),
    ).toMatchObject({
      mode: "inline",
      completion: "handler-returned",
      stateLabel: "scheduled",
      streamingNote: expect.stringContaining("may overlap the response body"),
    });
  });

  it("maps named intent and run outcomes for UI state chips", () => {
    expect(
      deferPresentationFromAttributes(
        {
          mode: "named",
          completion: "response-finished",
          intentState: "released",
          workId: "work_1",
          targetId: "task:email",
          sequence: 2,
        },
        "defer.scheduled",
      ),
    ).toMatchObject({
      intentState: "released",
      stateLabel: "released",
      workId: "work_1",
      streamingNote: expect.stringContaining("response finishes"),
    });

    expect(
      deferPresentationFromAttributes(
        {
          mode: "inline",
          completion: "handler-returned",
          outcome: "failed",
          sequence: 1,
        },
        "defer.run",
      ),
    ).toMatchObject({
      outcome: "failed",
      stateLabel: "failed",
    });
  });

  it("ignores non-defer primitives", () => {
    expect(
      deferPresentationFromAttributes({ mode: "inline" }, "tool.call"),
    ).toBeUndefined();
  });
});
