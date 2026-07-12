import type {
  GenerateImagesConfig,
  GenerateImagesResponse,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from "@google/genai";
import {
  createGeneratedImageResult,
  createUnsupportedCapabilityError,
  lowerImagePrompt,
  validateGenerateImageOptions,
  type GenerateImage,
  type GenerateImageOptions,
  type ImagePrompt,
  type UnsupportedCapabilityIssue,
} from "@use-crux/core";
import {
  bindCompletedOperation,
  defineCompletedOperation,
} from "@use-crux/core/adapter";

/** Native Imagen controls, excluding portable fields owned by Crux. */
export type GoogleImagenImageExtra = Omit<
  GenerateImagesConfig,
  "numberOfImages" | "aspectRatio" | "seed"
>;

/** Native Gemini generation controls, excluding image lifecycle fields owned by Crux. */
export type GoogleGeminiImageExtra = Omit<
  GenerateContentConfig,
  "abortSignal" | "responseModalities" | "imageConfig" | "seed"
>;

/** Model-family-specific native image options. */
export interface GoogleImageExtra {
  readonly imagen?: GoogleImagenImageExtra;
  readonly gemini?: GoogleGeminiImageExtra;
}

/**
 * Flat Google image operation attached to a bound adapter.
 *
 * @example
 * ```ts
 * const result = await google.generateImage({ model: 'imagen-4.0-generate-001', prompt: 'A quiet canal' })
 * await assetStore.put(result.image) // optional, explicit persistence
 * ```
 */
export type GoogleGenerateImage = GenerateImage<
  string,
  GoogleImageExtra,
  GenerateImagesResponse | GenerateContentResponse
>;
type GoogleImageInput = GenerateImageOptions<
  string,
  GoogleImageExtra,
  ImagePrompt
>;

const GOOGLE_IMAGE_OPERATION_SUPPORT = Object.freeze({
  knownUnsupportedModels: Object.freeze(
    new Set([
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "text-embedding-004",
    ]),
  ),
  common: Object.freeze({
    n: true,
    aspectRatio: true,
    seed: true,
    size: false,
  }),
  edits: false,
});

/** Create one native Google image operation sharing the bound SDK client. */
export function createGoogleGenerateImage(
  client: GoogleGenAI,
): GoogleGenerateImage {
  return bindCompletedOperation({
    definition: createGoogleImageOperation(client),
    provider: "google",
    operation: "generateImage",
  });
}

/** Define Google image mechanics for first-class provider-runtime compilation. */
export function createGoogleImageOperation(client: GoogleGenAI) {
  const definition = defineCompletedOperation({
    async normalize(input: GoogleImageInput, context) {
      const options = { ...input, model: context.model };
      validateGenerateImageOptions(options);
      const prompt = await lowerImagePrompt(options, {
        adapter: "google",
        model: options.model,
      });
      const issues = googleImageIssues(options, prompt);
      if (issues.length > 0) {
        throw createUnsupportedCapabilityError({
          adapter: "google",
          model: options.model,
          issues: issues as [
            UnsupportedCapabilityIssue,
            ...UnsupportedCapabilityIssue[],
          ],
        });
      }
      return { options, prompt };
    },
    support: () => "supported" as const,
    async invoke(
      { options, prompt },
      { signal, call },
    ): Promise<GenerateImagesResponse | GenerateContentResponse> {
      if (isGeminiEndpoint(options.model)) {
        return call("image.generate", async () =>
          client.models.generateContent({
            model: options.model,
            contents: [
              { role: "user", parts: await geminiPromptParts(prompt) },
            ],
            config: {
              ...options.extra?.gemini,
              abortSignal: signal,
              responseModalities: ["IMAGE"],
              ...(options.seed === undefined ? {} : { seed: options.seed }),
              ...(options.aspectRatio === undefined
                ? {}
                : { imageConfig: { aspectRatio: options.aspectRatio } }),
            },
          }),
        );
      }
      return call("image.generate", () =>
        client.models.generateImages({
          model: options.model,
          prompt: prompt.text,
          config: {
            ...options.extra?.imagen,
            abortSignal: signal,
            ...(options.n === undefined ? {} : { numberOfImages: options.n }),
            ...(options.aspectRatio === undefined
              ? {}
              : { aspectRatio: options.aspectRatio }),
            ...(options.seed === undefined ? {} : { seed: options.seed }),
          },
        }),
      );
    },
    validate(raw) {
      if (!("generatedImages" in raw)) {
        const contentRaw = raw as GenerateContentResponse;
        const images =
          contentRaw.candidates?.flatMap((candidate) =>
            (candidate.content?.parts ?? []).flatMap((part) =>
              part.inlineData?.data &&
              part.inlineData.mimeType?.startsWith("image/")
                ? [
                    {
                      data: part.inlineData.data,
                      mediaType: part.inlineData.mimeType,
                    },
                  ]
                : [],
            ),
          ) ?? [];
        return createGeneratedImageResult(images, {
          raw,
          warnings: [],
          execution: { kind: "native", calls: 1 },
        });
      }
      const generated = raw.generatedImages ?? [];
      const images = generated.flatMap((item) =>
        item.image?.imageBytes && item.image.mimeType
          ? [{ data: item.image.imageBytes, mediaType: item.image.mimeType }]
          : [],
      );
      const warnings = generated.flatMap((item) =>
        item.raiFilteredReason
          ? [`Image blocked: ${item.raiFilteredReason}`]
          : [],
      );
      const headers = raw.sdkHttpResponse?.headers;
      const requestId =
        headers?.["x-request-id"] ?? headers?.["x-goog-request-id"];
      const status = raw.sdkHttpResponse?.responseInternal?.status;
      const safety = generated.flatMap((item) =>
        item.safetyAttributes
          ? [
              {
                categories: item.safetyAttributes.categories,
                scores: item.safetyAttributes.scores,
              },
            ]
          : [],
      );
      return createGeneratedImageResult(images, {
        raw,
        warnings,
        execution: { kind: "native", calls: 1 },
        providerMetadata: {
          ...(requestId === undefined ? {} : { requestId }),
          ...(status === undefined ? {} : { status }),
          ...(safety.length === 0 ? {} : { safety }),
        },
      });
    },
    report: (result) => ({ kind: "image", count: result.images.length }),
    conformance: [],
  });
  return definition;
}

function googleImageIssues(
  options: GoogleImageInput,
  prompt: Awaited<ReturnType<typeof lowerImagePrompt>>,
): UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = [];
  if (
    GOOGLE_IMAGE_OPERATION_SUPPORT.knownUnsupportedModels.has(options.model)
  ) {
    issues.push(issue("image.model"));
  }
  if (!GOOGLE_IMAGE_OPERATION_SUPPORT.common.size && options.size !== undefined)
    issues.push(issue("image.size"));
  if (!isGeminiEndpoint(options.model)) {
    prompt.images.forEach((_asset, index) =>
      issues.push(issue("image.edit.reference", `prompt.images[${index}]`)),
    );
    if (prompt.mask) issues.push(issue("image.edit.mask", "prompt.mask"));
  }
  if (
    isGeminiEndpoint(options.model) &&
    options.n !== undefined &&
    options.n !== 1
  )
    issues.push(issue("image.n"));
  if (isGeminiEndpoint(options.model) && options.extra?.imagen !== undefined)
    issues.push(issue("image.extra.imagen", "extra.imagen"));
  if (!isGeminiEndpoint(options.model) && options.extra?.gemini !== undefined)
    issues.push(issue("image.extra.gemini", "extra.gemini"));
  return issues;
}

function isGeminiEndpoint(model: string): boolean {
  return model.startsWith("gemini-");
}

async function geminiPromptParts(
  prompt: Awaited<ReturnType<typeof lowerImagePrompt>>,
): Promise<Part[]> {
  const parts: Part[] = [{ text: prompt.text }];
  for (const asset of prompt.images) parts.push(await googleImagePart(asset));
  if (prompt.mask)
    parts.push({ text: "Mask image:" }, await googleImagePart(prompt.mask));
  return parts;
}

async function googleImagePart(
  asset: Awaited<ReturnType<typeof lowerImagePrompt>>["images"][number],
): Promise<Part> {
  if (asset.type === "url") {
    if (!asset.mediaType)
      throw new TypeError("Google image URLs require a mediaType.");
    return { fileData: { fileUri: asset.url.href, mimeType: asset.mediaType } };
  }
  if (asset.type === "provider-file") {
    if (asset.provider !== "google" || !asset.mediaType)
      throw new TypeError(
        "Google provider image files require Google ownership and a mediaType.",
      );
    return { fileData: { fileUri: asset.fileId, mimeType: asset.mediaType } };
  }
  const bytes =
    asset.data instanceof Blob
      ? new Uint8Array(await asset.data.arrayBuffer())
      : asset.data;
  return {
    inlineData: {
      data: Buffer.from(bytes).toString("base64"),
      mimeType: asset.mediaType,
    },
  };
}

function issue(capability: string, path?: string): UnsupportedCapabilityIssue {
  return {
    capability,
    ...(path === undefined ? {} : { path }),
    remediation:
      "Use a native Imagen generation model and Google-supported generation controls.",
  };
}
