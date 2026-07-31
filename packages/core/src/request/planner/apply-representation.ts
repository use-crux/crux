/**
 * Model-facing request edits for one selected representation rung.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";

/** Apply one resolved rung without retaining stale canonical metadata. @internal */
export function applyRepresentationRung<
  TExtra extends Record<string, unknown>,
>(
  request: CallArgs<TExtra>,
  policy: ResolvedRepresentationPolicy,
  rung: ResolvedRepresentationPolicy["rungs"][number],
): CallArgs<TExtra> {
  const omitted = rung.kind === "omitted";
  const replacement = omitted ? "" : (rung.text ?? "");
  let systemBlocks = request.systemBlocks?.flatMap((block) => {
    const omissionEdit = omitted
      ? policy.omissionEdits.find((edit) => edit.source === block.source)
      : undefined;
    if (omissionEdit) {
      return omissionEdit.replacement
        ? [{ ...block, text: omissionEdit.replacement }]
        : [];
    }
    if (!policy.sources.includes(block.source)) return [block];
    if (omitted) return [];
    return [{
      source: block.source,
      text: replacement,
      providerCache: block.providerCache,
      ...(block.cacheBoundary ? { cacheBoundary: true as const } : {}),
    }];
  });
  const appendedOffload =
    rung.kind === "offload" && policy.offload?.forced === true;
  if (appendedOffload && systemBlocks) {
    systemBlocks = [
      ...systemBlocks,
      {
        source: `offload:${policy.contributor}`,
        text: replacement,
        providerCache: false,
      },
    ];
  }
  let system = systemBlocks
    ? systemBlocks.map((block) => block.text).join("\n\n")
    : (request.system ?? "");
  if (!systemBlocks) {
    policy.fullTexts.forEach((fullText, index) => {
      system = replaceJoinedPart(
        system,
        fullText,
        index === 0 ? replacement : "",
      );
    });
    if (omitted) {
      for (const edit of policy.omissionEdits) {
        system = replaceJoinedPart(
          system,
          edit.fullText,
          edit.replacement,
        );
      }
    }
  }
  if (appendedOffload && !systemBlocks) {
    system = system ? `${system}\n\n${replacement}` : replacement;
  }
  const messages = rung.messages
    ? [...rung.messages]
    : !systemBlocks && !request.system
      ? replaceFoldedSystem(
          request.messages,
          policy.fullTexts,
          replacement,
          omitted ? policy.omissionEdits : [],
        )
      : request.messages;
  const tools =
    omitted && policy.ownedToolNames.length > 0
      ? request.tools?.filter(
          (tool) => !policy.ownedToolNames.includes(tool.name),
        )
      : request.tools;
  return {
    ...request,
    messages,
    ...(request.system !== undefined || systemBlocks || appendedOffload
      ? { system }
      : {}),
    ...(systemBlocks ? { systemBlocks } : {}),
    ...(tools ? { tools } : {}),
  };
}

function replaceFoldedSystem(
  messages: CallArgs<Record<string, unknown>>["messages"],
  fullTexts: readonly string[],
  replacement: string,
  omissionEdits: ResolvedRepresentationPolicy["omissionEdits"],
): CallArgs<Record<string, unknown>>["messages"] {
  let replaced = false;
  return messages.map((message) => {
    if (
      replaced ||
      message.role !== "system" ||
      typeof message.content !== "string"
    ) {
      return message;
    }
    let content = message.content;
    for (let index = 0; index < fullTexts.length; index++) {
      const fullText = fullTexts[index]!;
      if (!content.includes(fullText)) continue;
      content = replaceJoinedPart(
        content,
        fullText,
        index === 0 ? replacement : "",
      );
      replaced = true;
    }
    for (const edit of omissionEdits) {
      content = replaceJoinedPart(
        content,
        edit.fullText,
        edit.replacement,
      );
    }
    return content === message.content ? message : { ...message, content };
  });
}

function replaceOnce(
  value: string,
  search: string,
  replacement: string,
): string {
  if (!search) return value;
  const index = value.indexOf(search);
  if (index < 0) return value;
  const before = value.slice(0, index);
  const after = value.slice(index + search.length);
  return `${before}${replacement}${after}`;
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
