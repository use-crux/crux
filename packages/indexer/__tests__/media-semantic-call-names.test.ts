import { describe, expect, it } from "vitest";
import { semanticPrimitiveCallNames } from "../src/indexer/semantic/semantic-call-names";

describe("bounded media streaming semantic discovery", () => {
  it("keeps both authored operations in native semantic call interests", () => {
    expect(semanticPrimitiveCallNames).toEqual(
      expect.arrayContaining(["streamImage", "streamSpeech"]),
    );
  });
});
