/** Compile-time contract for canonical structured-generation inputs. */

import { z } from "zod";
import type { GenerateObjectFn } from "../src/generation/support-types";
import type { Message } from "../src/generation/messages";

declare const generateObject: GenerateObjectFn;

const schema = z.object({ safe: z.boolean() });
const model = { provider: "test", modelId: "multimodal" };
const messages = [
  {
    role: "user",
    content: [
      { type: "text", text: "Classify this image." },
      {
        type: "image",
        source: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
      },
    ],
  },
] as const satisfies readonly Message[];

void generateObject({
  model,
  prompt: "Return a structured result.",
  schema,
  temperature: 0,
  topP: 1,
});

void generateObject({
  model,
  system: "Return only the requested object.",
  messages,
  schema,
});

void generateObject({
  model,
  system: "Return only the requested object.",
  prompt: "Classify this input.",
  schema,
});

// @ts-expect-error - structured generation accepts either prompt or messages, never both.
void generateObject({
  model,
  prompt: "Classify this input.",
  messages,
  schema,
});

// @ts-expect-error - structured generation requires prompt or messages.
void generateObject({
  model,
  schema,
});
