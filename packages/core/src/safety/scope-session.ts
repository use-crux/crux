/** Execution-scope adapter for the segmented Safety protocol. */

import type { TraceMeta } from "../generation/types";
import { currentScope, openScope } from "../scope/kernel";
import type { Safety, SafetyStream } from "./session";
import {
  structuredStreamOpen,
  structuredStreamOpenRaw,
  streamOpenRaw,
  type SafetySession,
  type StructuredSafetyContext,
} from "./session-bridge";

/** Restore one safety-session frame across every asynchronous segment. */
export function createScopedSafetySession(
  promptId: string | undefined,
  session: Safety,
): Safety {
  const parent = currentScope();
  const controller = openScope(
    {
      kind: "safety-session",
      ...(promptId ? { name: promptId } : {}),
    },
    {},
  );
  parent?.onClose((outcome) => controller.seal(outcome));

  const runAsync = async <T>(
    segment: () => T | PromiseLike<T>,
    terminal = false,
  ): Promise<Awaited<T>> => {
    try {
      const result = (await controller.run(segment)) as Awaited<T>;
      if (terminal) controller.seal("success");
      return result;
    } catch (error) {
      controller.seal("error");
      throw error;
    }
  };

  const scopedStream = (stream: SafetyStream): SafetyStream => {
    const api: SafetyStream = {
      feed: (chunk) => runAsync(() => stream.feed(chunk)),
      finish: () => runAsync(() => stream.finish(), true),
      transform: () =>
        new TransformStream<string, string>({
          async transform(chunk, output) {
            const directive = await api.feed(chunk);
            if (directive.kind === "emit" && directive.content.length > 0) {
              output.enqueue(directive.content);
            }
          },
          async flush(output) {
            const seal = await api.finish();
            if (seal.pending.length > 0) output.enqueue(seal.pending);
          },
        }),
    };
    return api;
  };

  const scoped: Safety = {
    get enabled() {
      return session.enabled;
    },
    guardInput: (input) => runAsync(() => session.guardInput(input)),
    finalizeOutput: (output, regenerate, options) =>
      runAsync(() => session.finalizeOutput(output, regenerate, options), true),
    guardOutputTextParts: (parts) =>
      runAsync(() => session.guardOutputTextParts(parts), true),
    get audit() {
      return session.audit;
    },
    stamp<TMeta extends TraceMeta>(meta: TMeta): TMeta {
      try {
        const stamped = controller.run(() => session.stamp(meta)) as TMeta;
        controller.seal("success");
        return stamped;
      } catch (error) {
        controller.seal("error");
        throw error;
      }
    },
    openStream() {
      try {
        return scopedStream(
          controller.run(() => session.openStream()) as SafetyStream,
        );
      } catch (error) {
        controller.seal("error");
        throw error;
      }
    },
    get transcript() {
      return session.transcript;
    },
  };

  // The structured stream returns a `SafetyStream` synchronously (like the public
  // `openStream`), so it must be scoped like one — not wrapped as an async segment
  // by the generic symbol forwarding below. The raw (coordinated) variant is scoped
  // identically.
  const defineScopedStructuredStream = (key: symbol): void => {
    Object.defineProperty(scoped, key, {
      configurable: false,
      enumerable: false,
      value: (structuredContext?: StructuredSafetyContext): SafetyStream => {
        try {
          return scopedStream(
            controller.run(() =>
              (session as unknown as Record<symbol, (ctx?: StructuredSafetyContext) => SafetyStream>)[
                key
              ](structuredContext),
            ) as SafetyStream,
          );
        } catch (error) {
          controller.seal("error");
          throw error;
        }
      },
    });
  };
  defineScopedStructuredStream(structuredStreamOpen);
  defineScopedStructuredStream(structuredStreamOpenRaw);

  // The coordinated text stream takes no structured context but is scoped identically.
  Object.defineProperty(scoped, streamOpenRaw, {
    configurable: false,
    enumerable: false,
    value: (): SafetyStream => {
      try {
        return scopedStream(
          controller.run(() =>
            (session as unknown as Record<symbol, () => SafetyStream>)[streamOpenRaw](),
          ) as SafetyStream,
        );
      } catch (error) {
        controller.seal("error");
        throw error;
      }
    },
  });

  // Internal adapter bridges use symbol-keyed methods. Preserve them without
  // making the public Safety contract aware of executor-only capabilities.
  for (const key of Reflect.ownKeys(session)) {
    if (Reflect.has(scoped, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(session, key);
    const value = Reflect.get(session, key);
    Object.defineProperty(scoped, key, {
      configurable: false,
      enumerable: descriptor?.enumerable ?? false,
      ...(typeof value === "function"
        ? {
            value: (...args: unknown[]) =>
              runAsync(() => Reflect.apply(value, session, args)),
          }
        : { get: () => Reflect.get(session, key) }),
    });
  }
  return scoped;
}
