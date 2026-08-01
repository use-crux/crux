import { describe, expect, it } from "vitest";
import {
  context,
  droppable,
  offload,
  offloadable,
  prefer,
  summarizable,
} from "../src";

const full = context({ id: "full", system: "Full instructions." });
const compact = context({ id: "compact", system: "Compact instructions." });

describe("request representation ladder types", () => {
  it("accepts the fixed source-to-omission grammar", () => {
    const authored = prefer(full, compact);
    const summarized = summarizable(authored);
    const referenced = offloadable(summarized);

    expect(droppable(referenced)._tag).toBe("droppable");
    expect(droppable(prefer(full, compact))._tag).toBe("droppable");
    expect(summarizable([full, compact] as const)._tag).toBe(
      "summarizable",
    );
    expect(offload("canonical")._tag).toBe("offload");
    expect(offloadable({ aboveTokens: 100 })._tag).toBe(
      "offload-output",
    );
  });

  it("rejects Contributor-tagged values without a callable contribution at construction", () => {
    const invalidContributor = {
      _tag: "Contributor",
      id: "not-a-contributor",
      useEntries: [],
    } as never;

    expect(() => summarizable(invalidContributor)).toThrowError(
      /callable contribute/,
    );
    expect(() => droppable(invalidContributor)).toThrowError(
      /callable contribute/,
    );
  });

  it("rejects order-reversing and terminal nesting at compile time", () => {
    const omitted = droppable(full);
    const referenced = offloadable(full);
    const summarized = summarizable(full);
    const authored = prefer(full, compact);

    // @ts-expect-error droppable() is terminal.
    prefer(omitted, compact);
    // @ts-expect-error prefer() cannot be nested.
    prefer(authored, compact);
    // @ts-expect-error offloadable() cannot move back to a summary rung.
    summarizable(referenced);
    // @ts-expect-error summarizable() cannot be nested.
    summarizable(summarized);
    // @ts-expect-error droppable() cannot be nested.
    droppable(omitted);
    // @ts-expect-error prefer() alternatives must be exact sources.
    prefer(full, droppable(compact));
    // @ts-expect-error offloadable() cannot wrap a terminal ladder.
    offloadable(omitted);
    // @ts-expect-error offloadable() cannot be nested.
    offloadable(referenced);
    // @ts-expect-error Tool output policy is not a prompt ladder.
    droppable(offloadable({ aboveTokens: 100 }));
  });
});
