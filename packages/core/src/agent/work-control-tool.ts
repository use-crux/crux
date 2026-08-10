/**
 * Owner-scoped model-facing control for retained background Work.
 *
 * @internal
 * @module
 */

import { z } from "zod";
import { parseDuration } from "../flow/lifecycle";
import type { AnyToolSet } from "../types";
import type { ToolExecutionOptions } from "../types/tool";
import type { ProcessLocalAgentWorkController } from "../work/internal/agent-work-controller";
import type { InternalWorkOwnerPort } from "../work/internal/owner-retained-work";
import { isBackgroundableAgent } from "./backgroundable";
import {
  OWNER_WORK_STATUS_SCAN_LIMIT,
  projectOwnerWorkStatuses,
  projectWorkStatus,
} from "./work-status-projection";

/** Reserved concise name of the automatic model-facing Work control Tool. */
export const WORK_CONTROL_TOOL_NAME = "work";

const DEFAULT_RESULT_WAIT_MS = 30_000;
const workControlToolBrand: unique symbol = Symbol("work-control-tool");

const workControlInputSchema = z.object({
  action: z.enum(["list", "status", "result", "cancel", "detach", "send"]),
  id: z.string().optional(),
  timeout: z.string().optional(),
  message: z.string().optional(),
});

interface WorkControlToolShape {
  readonly [workControlToolBrand]: true;
}

/** Whether an internal Tool owns cooperative handling of its Tool budget. */
export function isWorkControlTool(value: unknown): value is WorkControlToolShape {
  return (
    typeof value === "object" &&
    value !== null &&
    workControlToolBrand in value
  );
}

/**
 * Add exactly one automatic Work control Tool when backgroundable bindings exist.
 *
 * @throws {TypeError} If the activated reserved name was authored by the user.
 */
export function bindWorkControlTool(
  tools: AnyToolSet,
  owner: InternalWorkOwnerPort,
  agentWork: ProcessLocalAgentWorkController,
): AnyToolSet {
  if (!Object.values(tools).some(isBackgroundableAgent)) {
    return tools;
  }
  if (Object.hasOwn(tools, WORK_CONTROL_TOOL_NAME)) {
    throw reservedWorkToolNameError();
  }
  return {
    ...tools,
    [WORK_CONTROL_TOOL_NAME]: createWorkControlTool(owner, agentWork),
  };
}

/** Create the deterministic diagnostic for an activated reserved-name collision. */
export function reservedWorkToolNameError(): TypeError {
  return new TypeError(
    `Tool name "${WORK_CONTROL_TOOL_NAME}" is reserved for background Work control.`,
  );
}

function createWorkControlTool(
  owner: InternalWorkOwnerPort,
  agentWork: ProcessLocalAgentWorkController,
): unknown {
  return Object.freeze({
    [workControlToolBrand]: true as const,
    description: "Inspect or control background Work started by this Agent.",
    parameters: workControlInputSchema,
    async execute(input: unknown, execution: ToolExecutionOptions) {
      const parsed = workControlInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new TypeError("Invalid work control input.");
      }
      if (parsed.data.action === "list") {
        return projectOwnerWorkStatuses(owner, OWNER_WORK_STATUS_SCAN_LIMIT);
      }

      const id = requireId(parsed.data.id, parsed.data.action);
      const retained = owner.inspect(id);
      if (!retained) {
        return notFound();
      }
      const { handle } = retained;

      switch (parsed.data.action) {
        case "status":
          return projectWorkStatus(await handle.status(), retained);
        case "result": {
          const status = await handle.status();
          if (status.state === "completed") {
            return await handle.result();
          }
          const waited = await waitForResult(
            handle.result(),
            resultWaitMs(parsed.data.timeout),
            execution.abortSignal,
          );
          return waited.available
            ? waited.result
            : projectWorkStatus(await handle.status(), retained);
        }
        case "cancel": {
          const accepted = handle.cancel();
          const status = await handle.status();
          return Object.freeze({
            workId: id,
            accepted,
            state: status.state,
            acceptedAt: new Date().toISOString(),
          });
        }
        case "detach":
          owner.detach(id);
          return Object.freeze({ id, detached: true as const });
        case "send": {
          if (!agentWork.isAgentWork(id)) {
            throw new TypeError(
              "work action \"send\" is only available for Agent Work targets.",
            );
          }
          const message = parsed.data.message;
          if (typeof message !== "string" || message.length === 0) {
            throw new TypeError(
              'work action "send" requires a non-empty message string.',
            );
          }
          // toolCallId makes model retries idempotent without storing raw content.
          const receipt = await agentWork.acceptSteering(
            id,
            message,
            `work-send:${execution.toolCallId}`,
          );
          return Object.freeze({
            workId: id,
            id: receipt.id,
            cursor: receipt.cursor.value,
            acceptedAt: receipt.acceptedAt.toISOString(),
            outcome: receipt.outcome,
          });
        }
      }
    },
  });
}

function requireId(id: string | undefined, action: string): string {
  if (id !== undefined) {
    return id;
  }
  throw new TypeError(`work action "${action}" requires an id.`);
}

function notFound(): Readonly<{ status: "not_found" }> {
  return Object.freeze({ status: "not_found" as const });
}

function resultWaitMs(timeout: string | undefined): number {
  if (timeout === undefined) {
    return DEFAULT_RESULT_WAIT_MS;
  }
  const parsed = parseDuration(timeout);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`Invalid work result timeout: ${timeout}`);
  }
  return Math.min(parsed, DEFAULT_RESULT_WAIT_MS);
}

async function waitForResult(
  result: Promise<unknown>,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
): Promise<
  | { readonly available: true; readonly result: unknown }
  | { readonly available: false }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const unavailable = new Promise<{ readonly available: false }>((resolve) => {
      timer = setTimeout(() => resolve({ available: false }), timeoutMs);
      if (abortSignal) {
        onAbort = () => resolve({ available: false });
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    });
    return await Promise.race([
      result.then(
        (value) => ({ available: true as const, result: value }),
        () => ({ available: false as const }),
      ),
      unavailable,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (onAbort) {
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }
}
