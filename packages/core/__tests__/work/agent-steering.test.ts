import { describe, expect, it } from "vitest";
import {
  createAgentSteeringMailbox,
  hashSteeringContent,
} from "../../src/work/internal/agent-steering";
import { WorkNotActiveError } from "../../src/work/errors";

describe("process-local Agent steering mailbox", () => {
  it("accepts ordered commands idempotently without storing raw content in identity records", async () => {
    const mailbox = createAgentSteeringMailbox({
      workId: "work_1",
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });

    const first = await mailbox.accept({
      commandId: "command_1",
      content: "Prioritize primary sources.",
    });
    const replay = await mailbox.accept({
      commandId: "command_1",
      content: "Prioritize primary sources.",
    });
    const second = await mailbox.accept({
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
      payloadHash: await hashSteeringContent("Prioritize primary sources."),
      cursor: "1",
      acceptedAt: "2026-08-10T12:00:00.000Z",
      outcome: "accepted",
    });
    expect(identities[0]).not.toHaveProperty("content");
    expect(identities[0]).not.toHaveProperty("payload");
    expect(JSON.stringify(identities)).not.toContain("Prioritize");

    await expect(
      mailbox.accept({
        commandId: "command_1",
        content: "Different payload",
      }),
    ).rejects.toThrow(
      "Agent steering command identity was reused with different content.",
    );
  });

  it("claims undelivered steering once at a provider-step boundary and drops raw content", async () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_2" });
    await mailbox.accept({ commandId: "a", content: "first" });
    await mailbox.accept({ commandId: "b", content: "second" });
    expect(mailbox.hasRawContent()).toBe(true);

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
    expect(mailbox.hasRawContent()).toBe(false);
    // Identity records remain for idempotent command replay.
    expect(mailbox.identities()).toHaveLength(2);
  });

  it("rejects steering after the mailbox closes", async () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_3" });
    mailbox.close();
    await expect(
      mailbox.accept({ commandId: "late", content: "too late" }),
    ).rejects.toBeInstanceOf(WorkNotActiveError);
  });

  it("keeps concurrent identical commandId accepts idempotent", async () => {
    const mailbox = createAgentSteeringMailbox({
      workId: "work_concurrent",
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      mailbox.accept({
        commandId: "same",
        content: "shared guidance",
      }),
      mailbox.accept({
        commandId: "same",
        content: "shared guidance",
      }),
    ]);

    expect(second).toEqual(first);
    expect(mailbox.identities()).toHaveLength(1);
    expect(mailbox.identities()[0]?.cursor).toBe("1");
  });

  it("rejects when close races with in-flight hashing", async () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_close_race" });
    const blob = new Blob(["steering-bytes"], { type: "image/png" });
    let releaseHash!: () => void;
    const hashGate = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const originalArrayBuffer = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, "arrayBuffer", {
      configurable: true,
      value: async () => {
        await hashGate;
        return originalArrayBuffer();
      },
    });

    const acceptPromise = mailbox.accept({
      commandId: "during-hash",
      content: [
        {
          type: "image",
          source: blob,
          mediaType: "image/png",
        },
      ],
    });

    await Promise.resolve();
    mailbox.close();
    releaseHash();

    await expect(acceptPromise).rejects.toBeInstanceOf(WorkNotActiveError);
    expect(mailbox.identities()).toHaveLength(0);
  });

  it("hashes Blob bytes so distinct content does not collide", async () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_blob" });
    const first = await mailbox.accept({
      commandId: "blob_cmd",
      content: [
        {
          type: "image",
          source: new Blob(["alpha-bytes"], { type: "image/png" }),
          mediaType: "image/png",
        },
      ],
    });
    const replay = await mailbox.accept({
      commandId: "blob_cmd",
      content: [
        {
          type: "image",
          source: new Blob(["alpha-bytes"], { type: "image/png" }),
          mediaType: "image/png",
        },
      ],
    });
    expect(replay).toEqual(first);

    await expect(
      mailbox.accept({
        commandId: "blob_cmd",
        content: [
          {
            type: "image",
            source: new Blob(["beta-bytes-different"], { type: "image/png" }),
            mediaType: "image/png",
          },
        ],
      }),
    ).rejects.toThrow(
      "Agent steering command identity was reused with different content.",
    );

    const sameSizeDifferent = await hashSteeringContent([
      {
        type: "image",
        source: new Blob(["aaaaaaaa"], { type: "image/png" }),
        mediaType: "image/png",
      },
    ]);
    const sameSizeOther = await hashSteeringContent([
      {
        type: "image",
        source: new Blob(["bbbbbbbb"], { type: "image/png" }),
        mediaType: "image/png",
      },
    ]);
    expect(sameSizeDifferent).not.toBe(sameSizeOther);
  });

  it("rejects unsupported opaque media sources instead of collapsing them", async () => {
    const mailbox = createAgentSteeringMailbox({ workId: "work_opaque" });
    await expect(
      mailbox.accept({
        commandId: "opaque",
        content: [
          {
            type: "image",
            // plain object without sha256 or recognized media shape
            source: { kind: "mystery" } as never,
            mediaType: "image/png",
          },
        ],
      }),
    ).rejects.toThrow(/not identity-safe/);
  });

  it("accepts stable sha256 asset refs without requiring raw bytes in identity", async () => {
    const hashA = await hashSteeringContent([
      {
        type: "file",
        source: {
          type: "url",
          url: new URL("https://example.com/a.pdf"),
          sha256: "a".repeat(64),
        },
        mediaType: "application/pdf",
      },
    ]);
    const hashB = await hashSteeringContent([
      {
        type: "file",
        source: {
          type: "url",
          url: new URL("https://example.com/b.pdf"),
          sha256: "b".repeat(64),
        },
        mediaType: "application/pdf",
      },
    ]);
    expect(hashA).not.toBe(hashB);
  });
});
