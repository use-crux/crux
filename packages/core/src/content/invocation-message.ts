import type { Message } from "../generation/messages";
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
      };
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
    content.map(async (part, partIndex) => {
      switch (part.type) {
        case "text":
          return part;
        case "image":
          return {
            ...part,
            source: await normalizeInvocationMediaSource({
              kind: "image",
              source: part.source,
              path: `${path}[${partIndex}].source`,
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
              path: `${path}[${partIndex}].source`,
              mediaType: part.mediaType,
              filename: part.filename,
              provider: options.provider,
            }),
          };
      }
    }),
  );
}
