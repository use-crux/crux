/**
 * Static Project Index facts for authored `sse()` transports.
 *
 * @module
 */

import type { SignalTransportFacts } from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import { staticObjectValue } from "../static-index/syntax/record/value";
import { transportModules } from "./modules";

/** Projects one authored managed SSE transport declaration. */
export function extractSseStaticFacts(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") {
    return none();
  }

  if (
    native.match.callee.importedName !== "sse" &&
    native.match.callee.name !== "sse"
  ) {
    return none();
  }

  const moduleSpecifier = native.match.callee.moduleSpecifier;
  if (
    !moduleSpecifier ||
    !(transportModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return none();
  }

  const options = staticObjectValue(native.match.args[0], native.initializers);
  const hasOpen = Boolean(
    options?.properties.some(
      (property) => !property.spread && property.name === "open",
    ),
  );
  const authoredIdentity = `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`;
  const definitionId = `signal.transport:${ctx.source.safeId(authoredIdentity)}`;
  const transportFacts: SignalTransportFacts = {
    kind: "signal.transport",
    transportKind: "sse",
    hasOpen,
  };

  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id: definitionId,
        kind: "signal.transport",
        name: ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: transportFacts,
        },
      }),
    ],
  });
}
