import type { Message } from "../generation/messages";
import type { AssistantContentPart } from "../types/content";
import { normalizeInvocationMediaSource } from "./invocation-media";

/** Normalize media-bearing invocation messages before provider or store I/O. */
export async function normalizeInvocationMessages(
  messages: readonly Message[],
  options: Readonly<{ provider?: string }> = {},
): Promise<Message[]> {
  return Promise.all(
    messages.map(async (message, messageIndex) => {
      const path = `messages[${messageIndex}].content`;
      const content = await normalizeInvocationContent(
        message.content,
        path,
        options,
      );
      return {
        ...message,
        content,
        ...(message.metadata
          ? {
              metadata: await normalizeToolMedia(
                message.metadata,
                message.content,
                content,
                `messages[${messageIndex}].metadata.modelOutput.value`,
                options,
              ),
            }
          : {}),
      } as Message;
    }),
  );
}

async function normalizeToolMedia(
  metadata: Record<string, unknown>,
  originalContent: Message["content"],
  normalizedContent: Message["content"],
  path: string,
  options: Readonly<{ provider?: string }>,
): Promise<Record<string, unknown>> {
  const modelOutput = metadata.modelOutput;
  if (!isContentModelOutput(modelOutput)) return metadata;
  const value =
    modelOutput.value === originalContent
      ? normalizedContent
      : await normalizeInvocationContent(modelOutput.value, path, options);
  return {
    ...metadata,
    modelOutput: {
      ...modelOutput,
      value,
    },
  };
}

function isContentModelOutput(
  value: unknown,
): value is Readonly<{ type: "content"; value: Message["content"] }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "content" &&
    "value" in value &&
    Array.isArray(value.value)
  );
}

async function normalizeInvocationContent(
  content: Message["content"],
  path: string,
  options: Readonly<{ provider?: string }>,
): Promise<Message["content"]> {
  if (typeof content === "string") return content;
  return Promise.all(
    content.map((part, partIndex) =>
      normalizeInvocationContentPart(part, `${path}[${partIndex}]`, options),
    ),
  );
}

async function normalizeInvocationContentPart(
  part: AssistantContentPart,
  path: string,
  options: Readonly<{ provider?: string }>,
): Promise<AssistantContentPart> {
  switch (part.type) {
    case "text":
    case "tool-call":
    case "reasoning":
      return part;
    case "image":
    case "audio":
    case "video":
      return {
        ...part,
        source: await normalizeInvocationMediaSource({
          kind: part.type,
          source: part.source,
          path: `${path}.source`,
          mediaType: part.mediaType,
          provider: options.provider,
        }),
      };
    case "file":
      return {
        ...part,
        source: await normalizeInvocationMediaSource({
          kind: "file",
          source: part.source,
          path: `${path}.source`,
          mediaType: part.mediaType,
          filename: part.filename,
          provider: options.provider,
        }),
      };
  }
}
