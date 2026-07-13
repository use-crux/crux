import type {
  EditImageConfig,
  GenerateContentConfig,
  GenerateImagesConfig,
} from "@google/genai";
import type { GenerateImageOptions, ImagePrompt } from "@use-crux/core";

/** Native Imagen generation controls, excluding portable fields owned by Crux. */
export type GoogleImagenImageExtra = Omit<
  GenerateImagesConfig,
  "numberOfImages" | "aspectRatio" | "seed"
>;

/** Native Gemini image controls, excluding portable fields owned by Crux. */
export type GoogleGeminiImageExtra = Omit<
  GenerateContentConfig,
  "abortSignal" | "responseModalities" | "imageConfig" | "seed"
>;

/**
 * Native Imagen edit controls that do not overlap portable Crux controls.
 *
 * Supply these as `extra.edit`. Crux owns the model, prompt, references,
 * mask, count, aspect ratio, seed, cancellation, and timeout fields.
 */
export type GoogleImagenEditExtra = Omit<
  EditImageConfig,
  "abortSignal" | "numberOfImages" | "aspectRatio" | "seed"
>;

/** Model-family and endpoint-specific native image options. */
export interface GoogleImageExtra {
  /** Native controls used by Imagen text-to-image generation. */
  readonly imagen?: GoogleImagenImageExtra;
  /** Native controls used by Gemini image generation and reference input. */
  readonly gemini?: GoogleGeminiImageExtra;
  /** Native controls used when an Imagen prompt contains reference images. */
  readonly edit?: GoogleImagenEditExtra;
}

/** Internal normalized Google image call input. */
export type GoogleImageInput = GenerateImageOptions<
  string,
  GoogleImageExtra,
  ImagePrompt
>;
