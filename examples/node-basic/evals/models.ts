/** Model bindings shared by the Node Eval examples. @module */

import { openai } from "@ai-sdk/openai";

/**
 * Default production model used by the example task.
 *
 * Keeping the model next to the task makes task identity explicit. Credentials
 * still come from the provider environment.
 */
export const supportModel = openai("gpt-4o-mini");
