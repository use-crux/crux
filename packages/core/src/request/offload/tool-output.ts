/**
 * Tool output lowering through exact-recovery references.
 *
 * @module
 */

import { countTokens } from "../../shared/tokenizer";
import type {
  JsonValue,
  ToolModelOutput,
} from "../../types/tool";
import type { ToolOutputOffloadPolicy } from "../representation/ladder-types";
import type { OffloadReceipt } from "./handle";
import { prepareOffload } from "./publish";

interface OutputPolicyTool {
  readonly output?: ToolOutputOffloadPolicy;
  readonly [activateOffloadSupport]?: () => void;
  readonly toModelOutput?: (args: {
    readonly toolCallId: string;
    readonly input: Record<string, unknown>;
    readonly output: unknown;
  }) => ToolModelOutput | Promise<ToolModelOutput>;
}

const receipts = new WeakMap<object, OffloadReceipt>();

/** Internal activation hook carried by lifecycle-wrapped Tools. @internal */
export const activateOffloadSupport = Symbol("activateOffloadSupport");

/** Lower one output to an exact-recovery reference when explicitly authorized. @internal */
export async function offloadedToolModelOutput(input: {
  readonly output: unknown;
  readonly policy?: ToolOutputOffloadPolicy;
  readonly activateSupport?: () => void;
}): Promise<ToolModelOutput | undefined> {
  const forced = forcedValue(input.output);
  const value = forced.found ? forced.value : input.output;
  if (!forced.found && !input.policy) return undefined;
  if (
    !forced.found &&
    input.policy?.options.aboveTokens !== undefined &&
    countTokens(serialized(value)) <= input.policy.options.aboveTokens
  ) {
    return undefined;
  }
  const prepared = prepareOffload(value);
  if (!prepared) {
    if (forced.found) {
      throw new TypeError(
        "Forced Tool output offload requires exact-recovery backing.",
      );
    }
    return undefined;
  }
  await prepared.publish();
  await prepared.validate();
  if (forced.found) input.activateSupport?.();
  const modelOutput: ToolModelOutput = Object.freeze({
    type: "json",
    value: {
      type: "exact-recovery-reference",
      handle: prepared.handle.id,
      preview: prepared.text,
    },
  });
  receipts.set(modelOutput, Object.freeze({
    handle: prepared.handle.id,
    revision: prepared.handle.revision,
    bytes: prepared.bytes,
  }));
  return modelOutput;
}

/** Read publication evidence attached to one model-facing Tool output. @internal */
export function toolOutputOffloadReceipt(
  output: ToolModelOutput,
): OffloadReceipt | undefined {
  return receipts.get(output);
}

/** Unwrap a forced exact-recovery result to its canonical evidence value. @internal */
export function canonicalToolOutput(output: unknown): unknown {
  const forced = forcedValue(output);
  return forced.found ? forced.value : output;
}

/** Install output-policy lowering on every SDK-executable Tool. @internal */
export function withToolOutputOffloadPolicies<
  TTools extends Record<string, unknown>,
>(
  tools: TTools,
  activateSupport?: () => void,
): TTools {
  const entries = Object.entries(tools).map(([name, value]) => {
    if (!value || typeof value !== "object") return [name, value] as const;
    const tool = value as OutputPolicyTool;
    const original = tool.toModelOutput;
    return [
      name,
      {
        ...value,
        ...(activateSupport
          ? { [activateOffloadSupport]: activateSupport }
          : {}),
        async toModelOutput(args: {
          readonly toolCallId: string;
          readonly input: Record<string, unknown>;
          readonly output: unknown;
        }): Promise<ToolModelOutput> {
          const offloaded = await offloadedToolModelOutput({
            output: args.output,
            policy: tool.output,
            activateSupport,
          });
          if (offloaded) return offloaded;
          if (original) return original(args);
          return defaultModelOutput(args.output);
        },
      },
    ] as const;
  });
  return Object.fromEntries(entries) as TTools;
}

function forcedValue(value: unknown): {
  readonly found: boolean;
  readonly value: unknown;
} {
  if (
    value &&
    typeof value === "object" &&
    (value as { readonly _tag?: unknown })._tag === "offload" &&
    "value" in value
  ) {
    return {
      found: true,
      value: (value as { readonly value: unknown }).value,
    };
  }
  return { found: false, value };
}

function defaultModelOutput(value: unknown): ToolModelOutput {
  return typeof value === "string"
    ? { type: "text", value }
    : { type: "json", value: jsonValue(value) };
}

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  const encoded = JSON.stringify(value);
  return encoded === undefined
    ? null
    : JSON.parse(encoded) as JsonValue;
}

function serialized(value: unknown): string {
  return typeof value === "string"
    ? value
    : (JSON.stringify(value) ?? "null");
}
