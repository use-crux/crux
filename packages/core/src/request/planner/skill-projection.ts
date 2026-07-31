/**
 * Aggregate skill projection for complete request candidates.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";

/** Apply all omitted skill owners to their one shared index and loader set. @internal */
export function applySkillProjection<
  TExtra extends Record<string, unknown>,
>(
  request: CallArgs<TExtra>,
  omittedPolicies: readonly ResolvedRepresentationPolicy[],
): CallArgs<TExtra> {
  const projection = omittedPolicies.find(
    (policy) => policy.skillProjection,
  )?.skillProjection;
  if (!projection) return request;
  const disabled = new Set(
    omittedPolicies.flatMap((policy) => policy.ownedSkillIds),
  );
  if (disabled.size === 0) return request;
  const retained = projection.allSkillIds.filter((id) => !disabled.has(id));
  const replacement = projection.renderRetained(retained);
  const systemBlocks = request.systemBlocks?.flatMap((block) => {
    if (block.source !== projection.source) return [block];
    return replacement ? [{ ...block, text: replacement }] : [];
  });
  let system = systemBlocks
    ? systemBlocks.map((block) => block.text).join("\n\n")
    : request.system;
  if (!systemBlocks && system !== undefined) {
    system = replaceJoinedPart(system, projection.fullText, replacement);
  }
  const messages =
    !systemBlocks && request.system === undefined
      ? request.messages.map((message) => {
          if (message.role !== "system" || typeof message.content !== "string") {
            return message;
          }
          const content = replaceJoinedPart(
            message.content,
            projection.fullText,
            replacement,
          );
          return content === message.content
            ? message
            : { ...message, content };
        })
      : request.messages;
  const tools =
    retained.length === 0
      ? request.tools?.filter(
          (tool) => !projection.loaderToolNames.includes(tool.name),
        )
      : request.tools;
  return {
    ...request,
    messages,
    ...(system !== undefined ? { system } : {}),
    ...(systemBlocks ? { systemBlocks } : {}),
    ...(tools ? { tools } : {}),
  };
}

function replaceOnce(
  value: string,
  search: string,
  replacement: string,
): string {
  if (!search) return value;
  const index = value.indexOf(search);
  if (index < 0) return value;
  return `${
    value.slice(0, index)
  }${replacement}${value.slice(index + search.length)}`;
}

function replaceJoinedPart(
  value: string,
  search: string,
  replacement: string,
): string {
  if (!search) return value;
  if (replacement) return replaceOnce(value, search, replacement);
  const index = value.indexOf(search);
  if (index < 0) return value;
  const end = index + search.length;
  if (value.slice(end, end + 2) === "\n\n") {
    return `${value.slice(0, index)}${value.slice(end + 2)}`;
  }
  if (value.slice(Math.max(0, index - 2), index) === "\n\n") {
    return `${value.slice(0, index - 2)}${value.slice(end)}`;
  }
  return `${value.slice(0, index)}${value.slice(end)}`;
}
