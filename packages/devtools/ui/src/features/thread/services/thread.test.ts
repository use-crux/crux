import { afterEach, describe, expect, it, vi } from "vitest";
import { threadService } from "./thread";

describe("Thread inspection service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the encoded Runtime Bridge resource identity", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(
          JSON.stringify({
            status: "ok",
            resourceId: "thread:support/42",
            value: { schema: 1, threadId: "support/42", state: "empty" },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await threadService.inspect("support/42");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:5173/api/resources/thread%3Asupport%252F42",
    );
  });
});
