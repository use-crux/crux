import type {
  LoweredImagePrompt,
  UnsupportedCapabilityIssue,
} from "@use-crux/core";
import type { GoogleImageInput } from "./image-types";

const KNOWN_UNSUPPORTED_IMAGE_MODELS = Object.freeze(
  new Set([
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "text-embedding-004",
  ]),
);

/** Collect Google image capability failures without provider I/O. */
export function googleImageIssues(
  options: GoogleImageInput,
  prompt: LoweredImagePrompt,
): UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = [];
  if (KNOWN_UNSUPPORTED_IMAGE_MODELS.has(options.model)) {
    issues.push(issue("image.model"));
  }
  if (options.size !== undefined) issues.push(issue("image.size"));
  if (isGeminiEndpoint(options.model)) {
    if (prompt.mask) issues.push(issue("image.edit.mask", "prompt.mask"));
  } else {
    prompt.images.forEach((asset, index) => {
      if (asset.type !== "data")
        issues.push(issue("image.edit.reference", `prompt.images[${index}]`));
    });
    if (prompt.mask?.type !== undefined && prompt.mask.type !== "data")
      issues.push(issue("image.edit.mask", "prompt.mask"));
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
  if (isGeminiEndpoint(options.model) && options.extra?.edit !== undefined)
    issues.push(issue("image.extra.edit", "extra.edit"));
  if (
    !isGeminiEndpoint(options.model) &&
    prompt.images.length > 0 &&
    options.extra?.imagen !== undefined
  )
    issues.push(issue("image.extra.imagen", "extra.imagen"));
  if (
    !isGeminiEndpoint(options.model) &&
    prompt.images.length === 0 &&
    options.extra?.edit !== undefined
  )
    issues.push(issue("image.extra.edit", "extra.edit"));
  return issues;
}

export function isGeminiEndpoint(model: string): boolean {
  return model.startsWith("gemini-");
}

function issue(capability: string, path?: string): UnsupportedCapabilityIssue {
  return {
    capability,
    ...(path === undefined ? {} : { path }),
    remediation: remediation(capability),
  };
}

function remediation(capability: string): string {
  if (capability === "image.edit.mask")
    return "Use a data-asset mask with an Imagen edit model; Gemini masks are not emulated.";
  if (capability === "image.edit.reference")
    return "Use data-asset references with an Imagen edit model.";
  if (capability.startsWith("image.extra."))
    return "Use only the typed extra namespace for the selected Google image endpoint.";
  return "Use a native Google image model and supported portable controls.";
}
