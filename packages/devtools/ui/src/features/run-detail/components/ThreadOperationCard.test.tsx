import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { ThreadOperationCard } from "./ThreadOperationCard";

function threadNode(
  attributes: Record<string, unknown>,
): ObservabilityRunDetailNode {
  return {
    primitive: "thread.operation",
    attributes,
  } as unknown as ObservabilityRunDetailNode;
}

describe("ThreadOperationCard", () => {
  it("renders structural commit facts without exposing unknown payloads", () => {
    const html = renderToStaticMarkup(
      <ThreadOperationCard
        node={threadNode({
          threadId: "support-42",
          operation: "append",
          decision: "selected",
          messageCount: 2,
          roles: ["user", "assistant"],
          parentId: "message-parent",
          selectedHead: "message-head",
          replayed: false,
          content: "SECRET_MESSAGE_CONTENT",
          input: { prompt: "SECRET_PROMPT" },
        })}
      />,
    );

    expect(html).toContain("Append");
    expect(html).toContain("support-42");
    expect(html).toContain("selected");
    expect(html).toContain("2 messages");
    expect(html).toContain("user");
    expect(html).toContain("assistant");
    expect(html).toContain("message-parent");
    expect(html).toContain("message-head");
    expect(html).not.toMatch(/SECRET_MESSAGE_CONTENT|SECRET_PROMPT/);
  });

  it.each([
    {
      label: "select",
      attributes: {
        operation: "select",
        targetId: "answer-b",
        head: "answer-b",
      },
      expected: ["Target", "answer-b", "Head"],
    },
    {
      label: "edit",
      attributes: {
        operation: "edit",
        targetId: "answer-a",
        selectedHead: "answer-edit",
      },
      expected: ["Target", "answer-a", "Selected head", "answer-edit"],
    },
    {
      label: "alternative append",
      attributes: {
        operation: "append",
        decision: "alternative",
        parentId: "root-message",
        selectedHead: "answer-a",
      },
      expected: ["Parent", "root-message", "Selected head", "answer-a"],
    },
  ])("renders truthful $label head facts", ({ attributes, expected }) => {
    const html = renderToStaticMarkup(
      <ThreadOperationCard node={threadNode(attributes)} />,
    );

    for (const value of expected) expect(html).toContain(value);
    expect(html).not.toContain("Head movement");
    expect(html).not.toContain("→");
    expect(html).not.toContain(">root<");
  });
});
