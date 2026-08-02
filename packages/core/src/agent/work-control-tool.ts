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
import type { InternalWorkOwnerPort } from "../work/internal/owner-retained-work";
import type { InternalWorkStatus } from "../work/internal/process-local-kernel";
import { isBackgroundableAgent } from "./backgroundable";

/** Reserved concise name of the automatic model-facing Work control Tool. */
export const WORK_CONTROL_TOOL_NAME = "work";

const LIST_LIMIT = 50;
const DEFAULT_RESULT_WAIT_MS = 30_000;
const workControlToolBrand: unique symbol = Symbol("work-control-tool");

const workControlInputSchema = z.object({
  action: z.enum(["list", "status", "result", "cancel", "detach"]),
  id: z.string().optional(),
  timeout: z.string().optional(),
});

/** Content-free, immutable lifecycle data safe to return to a parent model. */
interface WorkStatusProjection {
  readonly id: string;
  readonly state: InternalWorkStatus["state"];
  readonly acceptedAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly resultAvailable?: true;
}

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
): AnyToolSet {
  if (!Object.values(tools).some(isBackgroundableAgent)) return tools;
  if (Object.hasOwn(tools, WORK_CONTROL_TOOL_NAME)) {
    throw reservedWorkToolNameError();
  }
  return {
    ...tools,
    [WORK_CONTROL_TOOL_NAME]: createWorkControlTool(owner),
  };
}

/** Create the deterministic diagnostic for an activated reserved-name collision. */
export function reservedWorkToolNameError(): TypeError {
  return new TypeError(
    `Tool name "${WORK_CONTROL_TOOL_NAME}" is reserved for background Work control.`,
  );
}

function createWorkControlTool(owner: InternalWorkOwnerPort): unknown {
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
        const statuses = await Promise.all(
          owner.list().slice(0, LIST_LIMIT).map(async ({ id }) => {
            const handle = owner.lookup(id);
            return handle ? projectStatus(await handle.status()) : notFound();
          }),
        );
        return Object.freeze(statuses);
      }

      const id = requireId(parsed.data.id, parsed.data.action);
      const handle = owner.lookup(id);
      if (!handle) return notFound();

      switch (parsed.data.action) {
        case "status":
          return projectStatus(await handle.status());
        case "result": {
          const status = await handle.status();
          if (status.state === "completed") return await handle.result();
          const waited = await waitForResult(
            handle.result(),
            resultWaitMs(parsed.data.timeout),
            execution.abortSignal,
          );
          return waited.available
            ? waited.result
            : projectStatus(await handle.status());
        }
        case "cancel":
          handle.cancel();
          await Promise.resolve();
          return projectStatus(await handle.status());
        case "detach":
          owner.detach(id);
          return Object.freeze({ id, detached: true as const });
      }
    },
  });
}

function requireId(id: string | undefined, action: string): string {
  if (id !== undefined) return id;
  throw new TypeError(`work action "${action}" requires an id.`);
}

function notFound(): Readonly<{ status: "not_found" }> {
  return Object.freeze({ status: "not_found" as const });
}

function resultWaitMs(timeout: string | undefined): number {
  if (timeout === undefined) return DEFAULT_RESULT_WAIT_MS;
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
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) abortSignal?.removeEventListener("abort", onAbort);
  }
}

function projectStatus(status: InternalWorkStatus): WorkStatusProjection {
  const base = {
    id: status.id,
    state: status.state,
    acceptedAt: status.acceptedAt.toISOString(),
    updatedAt: status.updatedAt.toISOString(),
  };
  switch (status.state) {
    case "queued":
      return Object.freeze(base);
    case "running":
      return Object.freeze({ ...base, startedAt: status.startedAt.toISOString() });
    case "completed":
      return Object.freeze({
        ...base,
        startedAt: status.startedAt.toISOString(),
        completedAt: status.completedAt.toISOString(),
        resultAvailable: true,
      });
    case "failed":
      return Object.freeze({
        ...base,
        startedAt: status.startedAt.toISOString(),
        failedAt: status.failedAt.toISOString(),
      });
  }
}
