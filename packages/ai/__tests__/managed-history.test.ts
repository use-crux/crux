import { describe, expect, it } from "vitest";
import { history, prompt, type Message } from "@use-crux/core";
import { createCruxAi } from "../src";
import { capturingEmissionModel } from "./mock-model";

const messages: Message[] = [
  { role: "user", content: "old question with detailed account context" },
  { role: "assistant", content: "old answer with detailed preferences" },
  { role: "user", content: "middle question with more account context" },
  { role: "assistant", content: "middle answer with more preferences" },
  { role: "user", content: "new question" },
  { role: "assistant", content: "new answer" },
];

describe("AI SDK managed history", () => {
  it("prepares a portable summary with the resolved model before dispatch", async () => {
    const captured = capturingEmissionModel([
      { text: "portable history summary" },
      { text: "done" },
    ]);
    const managed = prompt({
      id: "ai-managed-history",
      use: [
        history({
          recent: 2,
          providerNative: false,
        }),
      ],
      prompt: "unused in manual transcript mode",
    });

    const result = await createCruxAi().generate(managed, {
      model: captured.model,
      messages,
      inputBudget: { max: 75, optimizeAt: 60 },
    });

    expect(result.text).toBe("done");
    expect(captured.prompts).toHaveLength(2);
    expect(JSON.stringify(captured.prompts[0])).toContain(
      "conversation summarizer",
    );
    expect(JSON.stringify(captured.prompts[1])).toContain(
      "Historical summary",
    );
    expect(result.steps[0]?.request?.adaptations).toEqual([
      expect.objectContaining({
        representation: "summary",
        supportRequestId: expect.stringMatching(/^request_/),
      }),
    ]);
  });
});
