import type { Message } from "../generation/messages";
import { normalizeInvocationMediaSource } from "./invocation-media";

/** Normalize media-bearing invocation messages before provider or store I/O. */
export async function normalizeInvocationMessages(
  messages: readonly Message[],
  options: Readonly<{ provider?: string }> = {},
): Promise<Message[]> {
  return Promise.all(
    messages.map(async (message, messageIndex) => ({
      ...message,
      content: await normalizeInvocationContent(
        message.content,
        `messages[${messageIndex}].content`,
        options,
      ),
    })),
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
