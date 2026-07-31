import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThreadInspection } from "@/types";
import { ThreadTopology } from "./ThreadTopology";

const inspection = {
  status: "ok",
  source: "runtime_bridge",
  resourceId: "thread:support-42",
  kind: "thread",
  value: {
    schema: 1,
    threadId: "support-42",
    state: "live",
    heads: { main: "assistant-2" },
    leaves: { "user-1": "assistant-1" },
    tree: [
      {
        id: "user-1",
        groupId: "group-1",
        seq: 0,
        groupEnd: true,
        state: "live",
        role: "user",
      },
      {
        id: "assistant-1",
        parentId: "user-1",
        groupId: "group-2",
        seq: 0,
        groupEnd: true,
        state: "live",
        role: "assistant",
      },
      {
        id: "assistant-2",
        parentId: "user-1",
        groupId: "group-3",
        seq: 0,
        groupEnd: true,
        state: "live",
        role: "assistant",
      },
    ],
    groups: [
      {
        id: "group-1",
        messageIds: ["user-1"],
        terminalId: "user-1",
        state: "live",
        selectedBy: ["main"],
      },
      {
        id: "group-2",
        parentId: "user-1",
        messageIds: ["assistant-1"],
        terminalId: "assistant-1",
        state: "live",
        selectedBy: [],
      },
      {
        id: "group-3",
        parentId: "user-1",
        messageIds: ["assistant-2"],
        terminalId: "assistant-2",
        state: "live",
        selectedBy: ["main"],
      },
    ],
    branches: [
      { parentId: "user-1", groupIds: ["group-2", "group-3"] },
    ],
  },
} satisfies ThreadInspection;

describe("ThreadTopology", () => {
  it("renders structural topology without message payloads", () => {
    const html = renderToStaticMarkup(<ThreadTopology inspection={inspection} />);

    expect(html).toContain("support-42");
    expect(html).toContain("Owner heads");
    expect(html).toContain("main");
    expect(html).toContain("assistant-2");
    expect(html).toContain("Conversation tree");
    expect(html).toContain("user-1");
    expect(html).toContain("Causal groups");
    expect(html).toContain("group-3");
    expect(html).toContain("Branch points");
    expect(html).toContain("group-2");
    expect(html).not.toMatch(/content|prompt|message text/i);
  });

  it("keeps descendants beside parents and exposes capped-depth identities", () => {
    const reordered = {
      ...inspection,
      value: {
        ...inspection.value,
        tree: [
          {
            id: "a-parent",
            groupId: "group-parent",
            seq: 0,
            groupEnd: true,
            state: "live",
            role: "user",
          },
          {
            id: "b-root",
            groupId: "group-root",
            seq: 0,
            groupEnd: true,
            state: "live",
            role: "user",
          },
          {
            id: "z-child",
            parentId: "a-parent",
            groupId: "group-child",
            seq: 0,
            groupEnd: true,
            state: "live",
            role: "assistant",
          },
        ],
      },
    } satisfies ThreadInspection;

    const html = renderToStaticMarkup(
      <ThreadTopology inspection={reordered} />,
    );

    expect(html.indexOf("a-parent")).toBeLessThan(html.indexOf("z-child"));
    expect(html.indexOf("z-child")).toBeLessThan(html.indexOf("b-root"));
    expect(html).toContain("parent a-parent");
    expect(html).toContain("group group-child");
  });
});
