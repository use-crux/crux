import { describe, expect, it } from "vitest";
import {
  createAgentSteeringMailbox,
  hashSteeringContent,
} from "../../src/work/internal/agent-steering";
import { WorkNotActiveError } from "../../src/work/errors";

describe("process-local Agent steering mailbox", () => {
  it("accepts ordered commands idempotently without storing raw content in identity records", () => {
    const mailbox = createAgentSteeringMailbox({
      workId: "work_1",
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });

    const first = mailbox.accept({
      commandId: "command_1",
      content: "Prioritize primary sources.",
    });
    const replay = mailbox.accept({
      commandId: "command_1",
      content: "Prioritize primary sources.",
    });
    const second = mailbox.accept({
      commandId: "command_2",
      content: [
        { type: "text", text: "Also inspect this screenshot." },
        {
          type: "image",
          source: "https://example.com/chart.png",
          mediaType: "image/png",
        },
      ],
    });

    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual({
      id: "command_1",
      cursor: { value: "1" },
      acceptedAt: new Date("2026-08-10T12:00:00.000Z"),
      outcome: "accepted",
    });
    expect(replay).toEqual(first);
    expect(second.cursor.value).toBe("2");

    const identities = mailbox.identities();
    expect(identities).toHaveLength(2);
    expect(identities[0]).toEqual({
      commandId: "command_1",
      payloadHash: hashSteeringContent("Prioritize primary sources."),
      cursor: "1",
      acceptedAt: "2026-08-10T12:00:00.000Z",
      outcome: "accepted",
    });
    expect(identities[0]).not.toHaveProperty("content");
    expect(identities[0]).not.toHaveProperty("payload");
    expect(JSON.stringify(identities)).not.toContain("Prioritize");

    expect(() =>
      mailbox.accept({
        commandId: "command_1",
        content: "Different payload",
      }),
    ).toThrow(
      "Agent steering command identity was reused with different content.",
    );
  });

  it("claims undelivered steering once at a provider-step boundary", () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_2" });
    mailbox.accept({ commandId: "a", content: "first" });
    mailbox.accept({ commandId: "b", content: "second" });

    const claimed = mailbox.claimForProviderStep();
    expect(claimed).toEqual([
      {
        role: "user",
        content: "first",
        metadata: { provenance: "agent-steering" },
      },
      {
        role: "user",
        content: "second",
        metadata: { provenance: "agent-steering" },
      },
    ]);
    expect(mailbox.claimForProviderStep()).toEqual([]);
  });

  it("rejects steering after the mailbox closes", () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_3" });
    mailbox.close();
    expect(() =>
      mailbox.accept({ commandId: "late", content: "too late" }),
    ).toThrow(WorkNotActiveError);
  });
});
