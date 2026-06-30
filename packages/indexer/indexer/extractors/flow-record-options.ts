import type { InternalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import type { StaticObjectValue } from "../static-index/syntax/record/types";
import {
  staticObjectPropertyValue,
  staticObjectValue,
} from "../static-index/syntax/record/value";

/** Returns true for object-style `flow({ ... })` declarations. */
export function isObjectStyleFlowCall(
  ctx: InternalStaticRecordContext,
): boolean {
  return ctx.match.kind === "call" && ctx.match.args[0]?.kind === "object";
}

/** Returns the record object that may contain flow definition options. */
export function recordFlowOptionsObject(
  ctx: InternalStaticRecordContext,
): StaticObjectValue | undefined {
  const objectSignals = ctx.objectArg
    ? staticObjectValue(
        staticObjectPropertyValue(ctx.objectArg, "signals"),
        ctx.initializers,
      )
    : undefined;
  if (ctx.objectArg && objectSignals) return ctx.objectArg;
  if (ctx.match.kind !== "call") return undefined;
  return staticObjectValue(ctx.match.args[1], ctx.initializers);
}
