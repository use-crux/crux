import { describe, it, expect, vi } from "vitest";
import { prompt as makePrompt } from "@use-crux/core";
import { agent as makeAgent } from "@use-crux/core/agent";
import { z } from "zod";
import { createAnthropic } from "../index";

const simplePrompt = makePrompt({
  id: "test-prompt",
  system: "You are a test agent.",
});

function anthropicResponse(text: string, toolUseBlocks?: any[]) {
  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  if (toolUseBlocks) content.push(...toolUseBlocks);
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-20250514",
    content,
    stop_reason: toolUseBlocks?.length ? "tool_use" : "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe("Anthropic adapter (adapter)", () => {
  function createAdapter() {
    const mockCreate = vi.fn().mockResolvedValue(anthropicResponse("hello"));
    const mockParse = vi.fn();
    const mockClient = {
      messages: { create: mockCreate, parse: mockParse },
    };
    return {
      adapter: createAnthropic(mockClient as any),
      mockCreate,
      mockParse,
    };
  }

  it("returns an adapter with expected methods", () => {
    const { adapter } = createAdapter();

    expect(adapter.providerId).toBe("anthropic");
    expect(typeof adapter.generate).toBe("function");
    expect(typeof adapter.stream).toBe("function");
    expect(typeof adapter.parallel).toBe("function");
    expect(typeof adapter.pipeline).toBe("function");
    expect(typeof adapter.consensus).toBe("function");
    expect(typeof adapter.swarm).toBe("function");
  });

  it("adapter is frozen (immutable)", () => {
    const { adapter } = createAdapter();
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  describe("generate()", () => {
    it("resolves prompt and calls client.messages.create()", async () => {
      const { adapter, mockCreate } = createAdapter();

      const prompt = makePrompt({
        id: "gen-test",
        system: "Be helpful.",
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
      });

      const result = await adapter.generate(prompt, {
        model: "claude-sonnet-4-20250514",
        input: { text: "Hello" },
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(result.text).toBe("hello");
      expect(result.raw).toBeDefined();
      expect(result._meta).toBeDefined();
      expect(result._meta.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });

    it("uses messages.parse for structured output", async () => {
      const mockParse = vi.fn().mockResolvedValue({
        ...anthropicResponse(""),
        parsed_output: { answer: 42 },
      });
      const mockClient = {
        messages: { create: vi.fn(), parse: mockParse },
      };
      const adapter = createAnthropic(mockClient as any);

      const prompt = makePrompt({
        id: "structured-test",
        system: "Return JSON.",
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        output: z.object({ answer: z.number() }),
      });

      const result = await adapter.generate(prompt, {
        model: "claude-sonnet-4-20250514",
        input: { text: "What is 6*7?" },
      });

      expect(mockParse).toHaveBeenCalledOnce();
      const args = mockParse.mock.calls[0][0];
      expect(args.output_config).toBeDefined();
      expect(result.text).toBe('{"answer":42}');
    });

    it("sets max_tokens to 4096 by default", async () => {
      const { adapter, mockCreate } = createAdapter();

      await adapter.generate(simplePrompt, {
        model: "claude-sonnet-4-20250514",
      });

      const args = mockCreate.mock.calls[0][0];
      expect(args.max_tokens).toBe(4096);
    });

    it("maps neutral none toolChoice settings to Anthropic tool_choice", async () => {
      const { adapter, mockCreate } = createAdapter();
      const prompt = makePrompt({
        id: "anthropic-tool-choice",
        system: "Use tools.",
        settings: { toolChoice: "none" },
        tools: {
          search: {
            description: "Search",
            parameters: z.object({ query: z.string() }),
            execute: async () => "result",
          },
        },
      });

      await adapter.generate(prompt, { model: "claude-sonnet-4-20250514" });

      const args = mockCreate.mock.calls[0][0];
      expect(args.tools).toHaveLength(1);
      expect(args.tool_choice).toEqual({ type: "none" });
    });
  });

  describe("tool loop via parallel()", () => {
    it("passes agent tools to the Anthropic API", async () => {
      const { adapter, mockCreate } = createAdapter();

      const agent = makeAgent({
        id: "tooled-agent",
        prompt: simplePrompt,
        tools: {
          search: {
            description: "Search the web",
            parameters: z.object({ query: z.string() }),
            execute: async () => "result",
          },
        } as any,
      });

      await adapter.parallel({
        agents: { a: agent },
        context: {},
        model: "claude-sonnet-4-20250514",
      });

      expect(mockCreate).toHaveBeenCalled();
      const args = mockCreate.mock.calls[0][0];
      expect(args.tools).toHaveLength(1);
      expect(args.tools[0].name).toBe("search");
      expect(args.tools[0].description).toBe("Search the web");
      expect(args.tools[0].input_schema).toHaveProperty("type", "object");
    });

    it("executes Crux tools when the LLM makes tool_use calls", async () => {
      const executeSpy = vi.fn().mockResolvedValue("tool result");
      let callCount = 0;
      const mockCreate = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return anthropicResponse("", [
            {
              type: "tool_use",
              id: "tu-1",
              name: "myTool",
              input: { q: "test" },
            },
          ]);
        }
        // Second call: no tool calls, done
        return anthropicResponse("done");
      });
      const mockClient = { messages: { create: mockCreate, parse: vi.fn() } };
      const adapter = createAnthropic(mockClient as any);

      const agent = makeAgent({
        id: "exec-agent",
        prompt: simplePrompt,
        tools: {
          myTool: {
            description: "My tool",
            parameters: z.object({ q: z.string() }),
            execute: executeSpy,
          },
        } as any,
      });

      await adapter.parallel({
        agents: { a: agent },
        context: {},
        model: "claude-sonnet-4-20250514",
      });

      expect(executeSpy).toHaveBeenCalledWith(
        { q: "test" },
        expect.objectContaining({ toolCallId: "tu-1" }),
      );
    });

    it("returns normalized AgentResult", async () => {
      const { adapter } = createAdapter();
      const agent = makeAgent({ id: "basic", prompt: simplePrompt });

      const result = await adapter.parallel({
        agents: { a: agent },
        context: {},
        model: "claude-sonnet-4-20250514",
      });

      expect(result.results.a.agentId).toBe("basic");
      expect(result.results.a.output).toBe("hello");
      expect(result.results.a.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("sanitizeToolSchema", () => {
    it("strips description fields from tool parameter schemas", async () => {
      const { adapter, mockCreate } = createAdapter();

      const prompt = makePrompt({
        id: "sanitize-test",
        system: "Test.",
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        tools: {
          myTool: {
            description: "A tool",
            parameters: z.object({ name: z.string().describe("the name") }),
            execute: async () => "ok",
          },
        },
      });

      await adapter.generate(prompt, {
        model: "claude-sonnet-4-20250514",
        input: { text: "test" },
      });

      const args = mockCreate.mock.calls[0][0];
      const schema = args.tools[0].input_schema;
      // The description should be stripped from within the schema
      expect(schema.type).toBe("object");
      expect(schema.properties?.name?.description).toBeUndefined();
    });
  });
});
