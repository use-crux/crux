import { z } from "zod";

/** Input projected through a provider Tool for a backgroundable Agent. */
export interface BackgroundToolInput {
  readonly schema: z.ZodType;
  readonly bind: (input: unknown) => {
    readonly input: unknown;
    readonly runInBackground: boolean | undefined;
  };
}

/**
 * Create the provider-facing input schema and child-input binding for a
 * backgroundable Agent.
 *
 * Object inputs retain their fields at the Tool boundary. Other roots are
 * carried in a single `input` field so every provider Tool remains object-root.
 *
 * @throws {TypeError} If an object input reserves `run_in_background`.
 */
export function bindBackgroundToolInput(
  inputSchema: z.ZodType | undefined,
  toolName: string,
): BackgroundToolInput {
  if (inputSchema === undefined) {
    return {
      schema: z.object({ run_in_background: z.boolean().optional() }),
      bind(input) {
        if (!isToolInputObject(input)) {
          throw new TypeError("Backgroundable Agent tool input must be an object.");
        }
        const { run_in_background: runInBackground } = input;
        return { input: {}, runInBackground };
      },
    };
  }

  if (inputSchema instanceof z.ZodObject) {
    if (Object.prototype.hasOwnProperty.call(inputSchema.shape, "run_in_background")) {
      throw new TypeError(
        `Backgroundable Agent tool "${toolName}" cannot use reserved input field "run_in_background".`,
      );
    }
    return {
      schema: inputSchema.extend({ run_in_background: z.boolean().optional() }),
      bind(input) {
        if (!isToolInputObject(input)) {
          throw new TypeError("Backgroundable Agent tool input must be an object.");
        }
        const { run_in_background: runInBackground, ...businessInput } = input;
        return { input: businessInput, runInBackground };
      },
    };
  }

  return {
    schema: z.object({ input: inputSchema, run_in_background: z.boolean().optional() }),
    bind(input) {
      if (!isScalarToolInput(input)) {
        throw new TypeError("Backgroundable Agent tool input must contain input.");
      }
      return { input: input.input, runInBackground: input.run_in_background };
    },
  };
}

function isToolInputObject(
  input: unknown,
): input is { readonly run_in_background?: boolean; readonly [key: string]: unknown } {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isScalarToolInput(
  input: unknown,
): input is { readonly input: unknown; readonly run_in_background?: boolean } {
  return isToolInputObject(input) && "input" in input;
}
