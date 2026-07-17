type MediaKind = "image" | "audio" | "video" | "file";

/** Canonical observability source categories (matches SafeMediaDescriptor). */
export type MediaSourceCategory =
  | "data"
  | "url"
  | "provider-file"
  | "asset-ref"
  | "bytes"
  | "blob"
  | "unknown";

const SAFE_SOURCE_CATEGORIES = new Set<string>([
  "data",
  "url",
  "provider-file",
  "asset-ref",
  "bytes",
  "blob",
  "unknown",
]);

export type MediaContentDescriptor = Readonly<{
  kind: MediaKind;
  mediaType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  pageCount?: number;
  digestPrefix?: string;
  sourceCategory: MediaSourceCategory;
}>;

interface MediaContentPreviewProps {
  readonly descriptor: MediaContentDescriptor;
  readonly label?: string;
}

/** Render retained media facts as one compact, non-expandable accessible label. */
export function MediaContentPreview({
  descriptor,
  label,
}: MediaContentPreviewProps) {
  const title =
    descriptor.kind === "image"
      ? "Image"
      : descriptor.kind === "audio"
        ? "Audio"
        : descriptor.kind === "video"
          ? "Video"
          : "File";
  const visible = [
    title,
    descriptor.mediaType,
    descriptor.sizeBytes !== undefined
      ? formatBytes(descriptor.sizeBytes)
      : undefined,
    dimensions(descriptor),
    descriptor.durationSeconds !== undefined
      ? `${formatNumber(descriptor.durationSeconds)}s`
      : undefined,
    descriptor.pageCount !== undefined
      ? `${formatNumber(descriptor.pageCount)} pages`
      : undefined,
  ].filter((item): item is string => item !== undefined);
  const accessible = [
    title,
    descriptor.mediaType,
    descriptor.sizeBytes !== undefined
      ? formatBytes(descriptor.sizeBytes)
      : undefined,
    accessibleDimensions(descriptor),
    descriptor.durationSeconds !== undefined
      ? `${formatNumber(descriptor.durationSeconds)} seconds`
      : undefined,
    descriptor.pageCount !== undefined
      ? `${formatNumber(descriptor.pageCount)} pages`
      : undefined,
    descriptor.digestPrefix ? `digest ${descriptor.digestPrefix}` : undefined,
  ].filter((item): item is string => item !== undefined);
  const ariaLabel = `${label ? `${label}: ` : ""}${accessible.join(", ")}`;

  return (
    <span
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded border border-(--qw-border) px-1.5 py-0.5 text-(--qw-fg-muted)"
    >
      {label ? <span>{label}:</span> : null}
      {visible.map((item, index) => (
        <span key={`${item}-${index}`}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {item}
        </span>
      ))}
    </span>
  );
}

/** Recognize only the scalar descriptor envelope emitted by observability retention. */
export function isMediaContentDescriptor(
  value: unknown,
): value is MediaContentDescriptor {
  if (
    !isRecord(value) ||
    (value.kind !== "image" &&
      value.kind !== "audio" &&
      value.kind !== "video" &&
      value.kind !== "file")
  ) {
    return false;
  }
  if (
    typeof value.sourceCategory !== "string" ||
    !SAFE_SOURCE_CATEGORIES.has(value.sourceCategory)
  ) {
    return false;
  }
  return (
    optionalString(value.mediaType) &&
    optionalNumber(value.sizeBytes) &&
    optionalNumber(value.width) &&
    optionalNumber(value.height) &&
    optionalNumber(value.durationSeconds) &&
    optionalNumber(value.pageCount) &&
    optionalString(value.digestPrefix)
  );
}

function dimensions(value: MediaContentDescriptor): string | undefined {
  if (value.width === undefined || value.height === undefined) return undefined;
  return `${formatNumber(value.width)}×${formatNumber(value.height)}`;
}

function accessibleDimensions(
  value: MediaContentDescriptor,
): string | undefined {
  if (value.width === undefined || value.height === undefined) return undefined;
  return `${formatNumber(value.width)} by ${formatNumber(value.height)} pixels`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${formatNumber(value / 1024)} KB`;
  return `${formatNumber(value / (1024 * 1024))} MB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
