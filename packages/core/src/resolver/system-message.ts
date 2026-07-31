/**
 * System message composition for the prompt compiler.
 *
 * This module turns prompt-owned system text and active context contributions
 * into the final system string, inspect parts, provider-cache blocks, and
 * exact contribution metadata. It is deliberately below `compilePrompt()` so the
 * public compiler boundary can stay small while this lower layer owns the
 * ordering and budget rules.
 *
 * @module
 */

import { z } from "zod";
import type { Context } from "../prompt/context-types";
import type { DroppedContext, InspectPart, SystemBlock } from "./types";
import type {
  CruxArtifactId,
  CruxContextContributionPreview,
} from "../observability/contract";
import type { ResolvedSystemContent } from "./contract";
import { contextDefinitionRef } from "../observability/definition-ref";
import {
  contextContributionKind,
  contextInjectedToolNames,
  contextInjects,
} from "./lower";
import type { ResolverPorts } from "./ports";
import {
  inputForSourceKeys,
  normalizeSystemContent,
  recountSystemContent,
} from "./system-content";
import { freshnessProjection, markLive, markMemo } from "./freshness";
import type { SystemIngressBlock } from "./system-ingress-provenance";
import { contextualizePromptTextError } from "../prompt-text/internal";

/** Result returned by {@link buildSystemMessage}. */
export interface BuiltSystemMessage {
  system: string;
  parts: InspectPart[];
  droppedContexts: DroppedContext[];
  blocks: SystemBlock[];
  /** Exact ordered semantic ownership retained for managed model ingress. */
  ingressBlocks: readonly SystemIngressBlock[];
}

/** Internal representation of a resolved context contribution. */
interface ResolvedContextPart {
  source: string;
  injectableKind: ReturnType<typeof contextContributionKind>;
  text: string;
  tokens: number;
  priority: number;
  index: number;
  providerCache: boolean;
  injectedTools?: readonly string[];
  segments?: InspectPart["segments"];
  staticTokens?: number;
  dynamicTokens?: number;
  servedFrom?: "live" | "memo";
  resolvedAt?: number;
  age?: number;
  observedAt?: number;
  sourceVersion?: string;
  contextId?: string;
  artifactId?: CruxArtifactId;
}

/**
 * Compute a stable context-cache key from context id and relevant input fields.
 *
 * Only keys declared in the context's input schema participate; storage and
 * expiry remain behind the `ContextCachePort`.
 */
function computeCacheKey(
  contextId: string,
  input: Record<string, unknown>,
  inputKeys: readonly string[],
): string {
  if (inputKeys.length === 0) {
    return `cache:ctx:${contextId}:`;
  }
  const relevant: Record<string, unknown> = {};
  const sortedKeys = [...inputKeys].sort();
  for (const key of sortedKeys) {
    relevant[key] = input[key];
  }
  return `cache:ctx:${contextId}:${JSON.stringify(relevant)}`;
}

/** Evaluate and normalize one context while retaining stable owner diagnostics. */
async function resolveContextContent(
  ctx: Context<z.ZodType>,
  input: Record<string, unknown>,
  count: (text: string) => number,
  source: string,
): Promise<ResolvedSystemContent> {
  try {
    return normalizeSystemContent(
      await ctx.systemFn(input),
      ctx.systemKind !== "static",
      count,
      `Context "${source}" system function`,
      inputForSourceKeys(input, ctx.inputKeys),
    );
  } catch (error) {
    throw contextualizePromptTextError(
      error,
      `in context "${ctx.id ?? source}" field "system"`,
    );
  }
}

/** Compose prompt and context system text into final call-ready structures. */
export async function buildSystemMessage(
  ownSystem: string | ResolvedSystemContent,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
  ports: ResolverPorts,
  options: {
    ownProviderCache?: boolean;
    ownSystemIsStatic?: boolean;
    ownSystemIsDynamic?: boolean;
    promptId?: string;
  } = {},
): Promise<BuiltSystemMessage> {
  const parts: InspectPart[] = [];
  const droppedContexts: DroppedContext[] = [];

  const count = ports.tokenizer.count;
  const ownContent =
    typeof ownSystem === "string"
      ? normalizeSystemContent(ownSystem, false, count)
      : ownSystem;
  const ownTokens = ownContent.text ? count(ownContent.text) : 0;
  parts.push({
    source: "prompt",
    text: ownContent.text,
    tokens: ownTokens,
    skipped: !ownContent.text,
    ...(ownContent.segments ? { segments: ownContent.segments } : {}),
    ...(ownContent.staticTokens !== undefined
      ? { staticTokens: ownContent.staticTokens }
      : {}),
    ...(ownContent.dynamicTokens !== undefined
      ? { dynamicTokens: ownContent.dynamicTokens }
      : {}),
  });

  const resolved: ResolvedContextPart[] = [];
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i];
    const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`;

    let contextArtifactId: CruxArtifactId | undefined;
    let injectedTools: readonly string[] | undefined;
    const text = await ports.observability.scope(
      {
        name: ctx.id ?? `context[${i}]`,
        family: "context",
        primitive: "context.resolve",
        attributes: {
          contextId: ctx.id,
          source,
          priority: ctx.priority,
          memoTtl: ctx.memoTtl,
          providerCache: ctx.providerCache,
        },
        // Only authored context ids reconstruct the indexer's canonical
        // `context:<safeId(id)>`; anonymous contexts fall back to the
        // compile-time local name we cannot observe, so we omit the ref.
        ...(ctx.id ? { definitionRefs: [contextDefinitionRef(ctx.id)] } : {}),
      },
      async () => {
        let resolvedContent: ResolvedSystemContent;
        let cacheStatus: "hit" | "miss" | "disabled" = "disabled";
        if (ctx.memoTtl > 0 && ctx.id) {
          const cacheKey = computeCacheKey(ctx.id, input, ctx.inputKeys);
          const cached = ports.cache.get(cacheKey);
          if (cached !== null) {
            // Segments are cached tokenizer-independently; refresh the token
            // split so it matches the active tokenizer on this hit.
            resolvedContent = markMemo(
              recountSystemContent(cached.content, count),
              {
                ageMs: cached.ageMs,
                now: ports.clock.now(),
              },
            );
            cacheStatus = "hit";
            ports.instrumentation.contextCacheHit({
              contextId: ctx.id,
              cacheKey,
              ageMs: cached.ageMs,
            });
          } else {
            const start = ports.clock.now();
            resolvedContent = markLive(
              await resolveContextContent(ctx, input, count, source),
              start,
            );
            cacheStatus = "miss";
            const resolutionMs = ports.clock.now() - start;
            if (resolvedContent.text) {
              ports.cache.set(cacheKey, resolvedContent, ctx.memoTtl);
            }
            ports.instrumentation.contextCacheMiss({
              contextId: ctx.id,
              cacheKey,
              resolutionMs,
            });
          }
        } else {
          const resolvedAt = ports.clock.now();
          resolvedContent = markLive(
            await resolveContextContent(ctx, input, count, source),
            resolvedAt,
          );
        }

        if (resolvedContent.text) {
          const tokens = count(resolvedContent.text);
          injectedTools = contextInjectedToolNames(ctx, input);
          const preview = {
            kind: "context.contribution",
            state: "active",
            included: true,
            sourceId: source,
            injectableKind: contextContributionKind(ctx),
            injects: contextInjects(ctx),
            injectedTools,
            priority: ctx.priority,
            sizeBytes: resolvedContent.text.length,
            tokens,
            cacheStatus,
            ...(resolvedContent.segments
              ? { segments: resolvedContent.segments }
              : {}),
            ...(resolvedContent.staticTokens !== undefined
              ? { staticTokens: resolvedContent.staticTokens }
              : {}),
            ...(resolvedContent.dynamicTokens !== undefined
              ? { dynamicTokens: resolvedContent.dynamicTokens }
              : {}),
            ...freshnessProjection(resolvedContent),
            text: resolvedContent.text,
          } satisfies CruxContextContributionPreview;
          contextArtifactId = ports.observability.artifact(
            {
              kind: "context.contribution",
              contentType: "application/json",
              encoding: "json",
              sizeBytes: resolvedContent.text.length,
              preview,
              attributes: {
                contextId: ctx.id,
                source,
                tokens,
                cacheStatus,
              },
            },
            { source },
          );
        }

        return resolvedContent;
      },
    );

    if (!text.text) {
      parts.push({
        source,
        text: "",
        tokens: 0,
        skipped: true,
        ...freshnessProjection(text),
      });
      continue;
    }

    const tokens = count(text.text);
    resolved.push({
      source,
      injectableKind: contextContributionKind(ctx),
      ...(ctx.id ? { contextId: ctx.id } : {}),
      text: text.text,
      tokens,
      priority: ctx.priority,
      index: i,
      providerCache: ctx.providerCache,
      ...(injectedTools ? { injectedTools } : {}),
      ...(text.segments ? { segments: text.segments } : {}),
      ...(text.staticTokens !== undefined
        ? { staticTokens: text.staticTokens }
        : {}),
      ...(text.dynamicTokens !== undefined
        ? { dynamicTokens: text.dynamicTokens }
        : {}),
      ...freshnessProjection(text),
      ...(contextArtifactId ? { artifactId: contextArtifactId } : {}),
    });
  }

  const orderedResolved = partitionCachePrefix(resolved);
  const ownProviderCache =
    options.ownProviderCache === true ||
    (options.ownSystemIsStatic === true &&
      orderedResolved.some((part) => part.providerCache));
  if (
    options.ownSystemIsDynamic === true &&
    orderedResolved.some((part) => part.providerCache)
  ) {
    ports.diagnostics.warn(
      `prompt "${options.promptId ?? "unknown"}": contexts request provider caching but the prompt-level system is dynamic; content before a cache breakpoint must be byte-stable. Make \`system\` static or move dynamic parts into an uncached context.`,
    );
  }

  for (const part of orderedResolved) {
    parts.push({
      source: part.source,
      text: part.text,
      tokens: part.tokens,
      skipped: false,
      ...(part.segments ? { segments: part.segments } : {}),
      ...(part.staticTokens !== undefined
        ? { staticTokens: part.staticTokens }
        : {}),
      ...(part.dynamicTokens !== undefined
        ? { dynamicTokens: part.dynamicTokens }
        : {}),
      ...freshnessProjection(part),
    });
  }

  const system = parts
    .filter((part) => !part.skipped && part.text)
    .map((part) => part.text)
    .join("\n\n");

  assertNoObjectInterpolation(system, parts);

  const blocks = parts.flatMap((part): SystemBlock[] => {
    if (part.skipped || !part.text) return [];
    const resolvedPart = resolved.find((r) => r.source === part.source);
    return [
      {
        source: part.source,
        text: part.text,
        providerCache:
          part.source === "prompt"
            ? ownProviderCache
            : (resolvedPart?.providerCache ?? false),
        ...(resolvedPart?.artifactId
          ? { artifactId: resolvedPart.artifactId }
          : {}),
        ...(part.segments ? { segments: part.segments } : {}),
        ...(part.staticTokens !== undefined
          ? { staticTokens: part.staticTokens }
          : {}),
        ...(part.dynamicTokens !== undefined
          ? { dynamicTokens: part.dynamicTokens }
          : {}),
      },
    ];
  });
  markCacheBoundary(blocks);
  const ingressBlocks = blocks.map((block): SystemIngressBlock => {
    const resolvedPart = resolved.find((part) => part.source === block.source);
    return {
      source: block.source,
      text: block.text,
      ...(resolvedPart
        ? {
            family: resolvedPart.injectableKind,
            ...(resolvedPart.contextId
              ? { contextId: resolvedPart.contextId }
              : {}),
          }
        : {}),
    };
  });

  return {
    system,
    parts,
    droppedContexts,
    blocks,
    ingressBlocks,
  };
}

function partitionCachePrefix(
  parts: readonly ResolvedContextPart[],
): ResolvedContextPart[] {
  const cached: ResolvedContextPart[] = [];
  const uncached: ResolvedContextPart[] = [];
  for (const part of parts) {
    if (part.providerCache) {
      cached.push(part);
    } else {
      uncached.push(part);
    }
  }
  return [...cached, ...uncached];
}

function markCacheBoundary(blocks: SystemBlock[]): void {
  let boundaryIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index]?.providerCache) {
      boundaryIndex = index;
      break;
    }
  }
  if (boundaryIndex === -1) return;
  blocks[boundaryIndex] = { ...blocks[boundaryIndex], cacheBoundary: true };
}

function assertNoObjectInterpolation(
  system: string,
  parts: readonly InspectPart[],
): void {
  if (!system.includes("[object Object]")) return;
  const culprit = parts.find((part) => part.text.includes("[object Object]"));
  throw new Error(
    `Assembled system message contains "[object Object]" - an object was interpolated ` +
      `into a string instead of being serialized. ` +
      (culprit ? `Source: ${culprit.source}. ` : "") +
      `Check your system/prompt functions for unserialised objects (use JSON.stringify() or String()).`,
  );
}
