import {
  lowerImagePrompt,
  validateGenerateImageOptions,
  type ImagePrompt,
  type StreamImageOptions,
} from "@use-crux/core";

const GOOGLE_IMAGE_STREAM_MODELS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
]);

export type GoogleImageStreamInput = StreamImageOptions<
  string,
  never,
  ImagePrompt
>;

export type NormalizedGoogleImageStream = Readonly<{
  options: GoogleImageStreamInput;
  prompt: Awaited<ReturnType<typeof lowerImagePrompt>>;
}>;

/** Validate and lower one image-only Interactions request without provider I/O. */
export async function normalizeGoogleImageStream(
  input: GoogleImageStreamInput,
  model: string,
): Promise<NormalizedGoogleImageStream> {
  const options = { ...input, model };
  validateGenerateImageOptions(options);
  const prompt = await lowerImagePrompt(options, {
    adapter: "google",
    model,
  });
  return { options, prompt };
}

/** Return whether the current Google Interactions contract can stream the request. */
export function supportsGoogleImageStream({
  options,
  prompt,
}: NormalizedGoogleImageStream): boolean {
  return (
    GOOGLE_IMAGE_STREAM_MODELS.has(String(options.model)) &&
    (options.n === undefined || options.n === 1) &&
    options.size === undefined &&
    options.aspectRatio === undefined &&
    options.seed === undefined &&
    options.extra === undefined &&
    prompt.images.length === 0 &&
    prompt.mask === undefined
  );
}
