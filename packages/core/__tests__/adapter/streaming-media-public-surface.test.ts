import { describe, expect, it } from "vitest";
import * as core from "../../src";
import * as adapter from "../../src/adapter";

describe("bounded media streaming public surface", () => {
  it("keeps contracts at the root and authoring mechanics in adapter", () => {
    expect(core).not.toHaveProperty("streamImage");
    expect(core).not.toHaveProperty("streamSpeech");
    expect(core).not.toHaveProperty("defineStreamingOperation");
    expect(core).not.toHaveProperty("bindStreamingOperation");

    expect(adapter.defineStreamingOperation).toBeTypeOf("function");
    expect(adapter.bindStreamingOperation).toBeTypeOf("function");
  });
});
