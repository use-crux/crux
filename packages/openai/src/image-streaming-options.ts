import {
  lowerImagePrompt,
  validateGenerateImageOptions,
  type ImagePrompt,
  type StreamImageOptions,
} from "@use-crux/core";
import type { OpenAIImageExtra } from "./image-generation";

const OPENAI_IMAGE_STREAM_MODELS = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "chatgpt-image-latest",
]);

/** OpenAI controls accepted by native Images API streaming. */
export interface OpenAIImageStreamExtra extends OpenAIImageExtra {
  /**
   * Number of complete provisional images requested from OpenAI.
   *
   * OpenAI may return fewer previews when the final image completes first.
   * @defaultValue 0
   */
  readonly partial_images?: 0 | 1 | 2 | 3 | null;
}

export type OpenAIImageStreamInput = StreamImageOptions<
  string,
  OpenAIImageStreamExtra,
  ImagePrompt
>;

export type NormalizedOpenAIImageStream = Readonly<{
  options: OpenAIImageStreamInput;
  prompt: Awaited<ReturnType<typeof lowerImagePrompt>>;
}>;

/** Validate and lower one portable image-stream request without provider I/O. */
export async function normalizeOpenAIImageStream(
  input: OpenAIImageStreamInput,
  model: string,
): Promise<NormalizedOpenAIImageStream> {
  const options = { ...input, model };
  validateGenerateImageOptions(options);
  validatePartialImages(options.extra?.partial_images);
  const prompt = await lowerImagePrompt(options, {
    adapter: "openai",
    model,
  });
  return { options, prompt };
}

/** Return whether the installed Images API can honestly stream this request. */
export function supportsOpenAIImageStream({
  options,
  prompt,
}: NormalizedOpenAIImageStream): boolean {
  return (
    OPENAI_IMAGE_STREAM_MODELS.has(String(options.model)) &&
    (options.n === undefined || options.n === 1) &&
    options.aspectRatio === undefined &&
    options.seed === undefined &&
    options.extra?.input_fidelity === undefined &&
    prompt.images.length === 0 &&
    prompt.mask === undefined
  );
}

function validatePartialImages(value: number | null | undefined): void {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isInteger(value) || value < 0 || value > 3)
  ) {
    throw new RangeError(
      "OpenAI image streaming extra.partial_images must be an integer from 0 to 3.",
    );
  }
}
