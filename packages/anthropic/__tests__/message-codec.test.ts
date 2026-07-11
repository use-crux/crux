import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { contentText, type Message, type ToolModelOutput } from "@use-crux/core";
import { transcriptCodecConformance } from "@use-crux/core/adapter/testing";
import type { ToolResultEntry } from "@use-crux/core/adapter";
import {
  anthropicTranscript,
  fromMessages,
  toMessages,
} from "../src/message-codec";

describe("anthropic transcript wire encoding", () => {
  it("round-trips native redacted thinking without projecting its payload as text", () => {
    const wire = [
      {
        role: "assistant",
        content: [
          { type: "redacted_thinking", data: "opaque-secret-payload" },
          { type: "text", text: "Visible answer" },
        ],
      },
    ];

    const canonical = toMessages(wire);

    expect(canonical).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              anthropic: {
                continuation: {
                  type: "redacted_thinking",
                  data: "opaque-secret-payload",
                },
              },
            },
          },
          { type: "text", text: "Visible answer" },
        ],
      },
    ]);
    expect(fromMessages(canonical)).toEqual(wire);
    const projection = contentText(canonical[0]?.content ?? "");
    expect(projection).toContain("Visible answer");
    expect(projection).not.toContain("opaque-secret-payload");
  });

  it("replays signed thinking and assistant media without silently dropping native blocks", () => {
    const canonical: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "private chain",
            providerOptions: { anthropic: { signature: "sig_123" } },
          },
          { type: "text", text: "Visible answer" },
          {
            type: "image",
            source: new Uint8Array([1, 2, 3]),
            mediaType: "image/png",
          },
        ],
      },
    ];

    expect(fromMessages(canonical)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private chain", signature: "sig_123" },
          { type: "text", text: "Visible answer" },
          {
            type: "image",
            source: { type: "base64", data: "AQID", media_type: "image/png" },
          },
        ],
      },
    ]);
  });

  it("fails before provider I/O when reasoning cannot be faithfully replayed", () => {
    expect(() =>
      fromMessages([
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "missing signature" }],
        },
      ]),
    ).toThrow("No provider request was made.");
  });
  it("serializes canonical assistant tool calls and tool results to Anthropic blocks", () => {
    const messages = fromMessages([
      { role: "user", content: "Weather in Paris?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "tool-call",
            toolCallId: "toolu_weather",
            toolName: "weather",
            input: { city: "Paris" },
          },
        ],
        metadata: {
          toolCalls: [
            { id: "toolu_weather", name: "weather", args: { city: "Paris" } },
          ],
        },
      },
      toolMessage("toolu_weather", "weather", {
        type: "json",
        value: { forecast: "cloudy" },
      }),
    ]);

    expect(messages).toEqual([
      { role: "user", content: "Weather in Paris?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "tool_use",
            id: "toolu_weather",
            name: "weather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_weather",
            content: '{"forecast":"cloudy"}',
          },
        ],
      },
    ]);
  });

  it("sets is_error on Anthropic tool_result blocks for error model outputs", () => {
    const messages = fromMessages([
      toolMessage("toolu_weather", "weather", {
        type: "error-json",
        value: { error: "unavailable" },
      }),
      toolMessage("toolu_search", "search", {
        type: "error-text",
        value: "Search failed",
      }),
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_weather",
            content: '{"error":"unavailable"}',
            is_error: true,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_search",
            content: "Search failed",
            is_error: true,
          },
        ],
      },
    ]);
  });

  it("serializes execution-denied tool outputs without marking Anthropic is_error", () => {
    const messages = fromMessages([
      toolMessage("toolu_publish", "publishPost", {
        type: "execution-denied",
        reason: "Human approval is required.",
      }),
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_publish",
            content: "Tool execution denied: Human approval is required.",
          },
        ],
      },
    ]);
  });

  it("uses native Anthropic image and PDF blocks for supported rich tool content", () => {
    const messages = fromMessages([
      toolMessage("toolu_render", "render", {
        type: "content",
        value: [
          { type: "text", text: "Rendered report" },
          {
            type: "image",
            source: {
              type: "data",
              data: new Uint8Array([1]),
              mediaType: "image/png",
            },
            mediaType: "image/png",
          },
          { type: "image", source: "https://example.com/image.png" },
          {
            type: "file",
            source: {
              type: "data",
              data: new Uint8Array([2]),
              mediaType: "application/pdf",
            },
            mediaType: "application/pdf",
          },
          {
            type: "file",
            source: {
              type: "data",
              data: new Uint8Array([3]),
              mediaType: "application/pdf",
            },
            mediaType: "application/pdf",
            filename: "report.pdf",
          },
        ],
      }),
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_render",
            content: [
              { type: "text", text: "Rendered report" },
              {
                type: "image",
                source: {
                  type: "base64",
                  data: "AQ==",
                  media_type: "image/png",
                },
              },
              {
                type: "image",
                source: { type: "url", url: "https://example.com/image.png" },
              },
              {
                type: "document",
                source: {
                  type: "base64",
                  data: "Ag==",
                  media_type: "application/pdf",
                },
              },
              {
                type: "document",
                source: {
                  type: "base64",
                  data: "Aw==",
                  media_type: "application/pdf",
                },
                title: "report.pdf",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("rejects unsupported rich tool content before Anthropic request encoding", () => {
    expect(() =>
      fromMessages([
        toolMessage("toolu_file", "readFile", {
          type: "content",
          value: [
            {
              type: "file",
              source: {
                type: "data",
                data: new Uint8Array([4]),
                mediaType: "audio/mpeg",
              },
              mediaType: "audio/mpeg",
            },
            { type: "file", source: "https://example.com/file.csv" },
          ],
        }),
      ]),
    ).toThrow("No provider request was made.");
  });
});

describe("anthropic transcript wire decoding", () => {
  it("reads Anthropic text, tool_use, and tool_result blocks into canonical messages", () => {
    const messages = toMessages([
      {
        role: "assistant",
        content: [
          { type: "text", text: "First. " },
          { type: "text", text: "Second." },
          {
            type: "tool_use",
            id: "toolu_weather",
            name: "weather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_weather",
            content: [{ type: "text", text: "18 C and cloudy" }],
            is_error: true,
          },
        ],
      },
    ] satisfies Anthropic.MessageParam[]);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "First. Second." },
          {
            type: "tool-call",
            toolCallId: "toolu_weather",
            toolName: "weather",
            input: { city: "Paris" },
          },
        ],
        metadata: {
          toolCalls: [
            { id: "toolu_weather", name: "weather", args: { city: "Paris" } },
          ],
        },
      },
      {
        role: "tool",
        content: "18 C and cloudy",
        metadata: { toolCallId: "toolu_weather", isError: true },
      },
    ]);
  });

  it("preserves rich tool_result content through fromMessages/toMessages round-trip", () => {
    const richToolMessage = toolMessage("toolu_render", "render", {
      type: "content",
      value: [
        { type: "text", text: "Rendered report" },
        {
          type: "image",
          source: {
            type: "data",
            data: new Uint8Array([1]),
            mediaType: "image/png",
          },
          mediaType: "image/png",
        },
        { type: "image", source: "https://example.com/image.png" },
        {
          type: "file",
          source: {
            type: "data",
            data: new Uint8Array([3]),
            mediaType: "application/pdf",
          },
          mediaType: "application/pdf",
          filename: "report.pdf",
        },
      ],
    });

    const decoded = toMessages(fromMessages([richToolMessage]));

    // Rich content survives instead of being flattened to text, and the
    // canonical tool-call id is retained. `content` carries the joined text
    // fallback; `toolName` is not part of the Anthropic tool_result wire shape.
    expect(decoded).toEqual([
      {
        role: "tool",
        content: "Rendered report",
        metadata: {
          toolCallId: "toolu_render",
          modelOutput: {
            type: "content",
            value: [
              { type: "text", text: "Rendered report" },
              {
                type: "image",
                source: {
                  type: "data",
                  data: new Uint8Array([1]),
                  mediaType: "image/png",
                },
                mediaType: "image/png",
              },
              { type: "image", source: "https://example.com/image.png" },
              {
                type: "file",
                source: {
                  type: "data",
                  data: new Uint8Array([3]),
                  mediaType: "application/pdf",
                },
                mediaType: "application/pdf",
                filename: "report.pdf",
              },
            ],
          },
        },
      },
    ]);
  });

  it("reads mixed assistant text and tool_use blocks as a canonical assistant turn", () => {
    const turn = anthropicTranscript.readAssistant({
      content: [
        textBlock("I will check. "),
        toolUseBlock("toolu_weather", "weather", { city: "Paris" }),
        textBlock("Then I will compare."),
        toolUseBlock("toolu_calendar", "calendar", { day: "today" }),
      ],
    } as unknown as Pick<Anthropic.Message, "content">);

    expect(turn).toEqual({
      text: "I will check. Then I will compare.",
      content: [
        { type: "text", text: "I will check. " },
        {
          type: "tool-call",
          toolCallId: "toolu_weather",
          toolName: "weather",
          input: { city: "Paris" },
        },
        { type: "text", text: "Then I will compare." },
        {
          type: "tool-call",
          toolCallId: "toolu_calendar",
          toolName: "calendar",
          input: { day: "today" },
        },
      ],
      toolCalls: [
        { id: "toolu_weather", name: "weather", args: { city: "Paris" } },
        { id: "toolu_calendar", name: "calendar", args: { day: "today" } },
      ],
    });
  });
});

describe("anthropic transcript conformance", () => {
  it("passes the native transcript codec laws through one fixture", () => {
    const canonicalMessages: Message[] = [
      { role: "user", content: "Weather in Paris?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "tool-call",
            toolCallId: "toolu_weather",
            toolName: "weather",
            input: { city: "Paris" },
          },
        ],
        metadata: {
          toolCalls: [
            { id: "toolu_weather", name: "weather", args: { city: "Paris" } },
          ],
        },
      },
      toolMessage("toolu_weather", "weather", {
        type: "json",
        value: { forecast: "cloudy" },
      }),
    ];
    const providerMessages: Anthropic.MessageParam[] = [
      { role: "user", content: "Weather in Paris?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "tool_use",
            id: "toolu_weather",
            name: "weather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_weather",
            content: '{"forecast":"cloudy"}',
          },
        ],
      },
    ];
    const decodedMessages: Message[] = [
      { role: "user", content: "Weather in Paris?" },
      canonicalMessages[1]!,
      {
        role: "tool",
        content: '{"forecast":"cloudy"}',
        metadata: { toolCallId: "toolu_weather" },
      },
    ];
    const assistant = {
      text: "I will check.",
      content: [
        { type: "text" as const, text: "I will check." },
        {
          type: "tool-call" as const,
          toolCallId: "toolu_weather",
          toolName: "weather",
          input: { city: "Paris" },
        },
      ],
      toolCalls: [
        { id: "toolu_weather", name: "weather", args: { city: "Paris" } },
      ],
    };
    const toolResults: ToolResultEntry[] = [
      {
        toolCallId: "toolu_weather",
        name: "weather",
        output: { forecast: "cloudy" },
        modelOutput: { type: "json", value: { forecast: "cloudy" } },
        content: '{"forecast":"cloudy"}',
        outputSize: 21,
        modelOutputSize: 21,
      },
    ];

    expect(
      transcriptCodecConformance({
        name: "anthropic transcript",
        transcript: anthropicTranscript,
        canonicalMessages,
        providerMessages,
        decodedMessages,
        rawAssistant: {
          content: [
            textBlock("I will check."),
            toolUseBlock("toolu_weather", "weather", { city: "Paris" }),
          ],
        },
        assistant,
        appendHistory: [canonicalMessages[0]!],
        toolResults,
        appendedMessages: [
          canonicalMessages[0]!,
          canonicalMessages[1]!,
          {
            role: "tool",
            content: '{"forecast":"cloudy"}',
            metadata: {
              toolCallId: "toolu_weather",
              toolName: "weather",
              modelOutput: { type: "json", value: { forecast: "cloudy" } },
            },
          },
        ],
        wrappers: {
          fromMessages: fromMessages(canonicalMessages),
          toMessages: toMessages(providerMessages),
        },
      }),
    ).toEqual([]);
  });
});

function toolMessage(
  toolCallId: string,
  toolName: string,
  modelOutput: ToolModelOutput,
): Message {
  return {
    role: "tool",
    content: "fallback",
    metadata: { toolCallId, toolName, modelOutput },
  };
}

function textBlock(text: string): Anthropic.TextBlock {
  return { type: "text", text, citations: null };
}

function toolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input, caller: { type: "direct" } };
}
