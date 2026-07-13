import type { DataAsset } from "../asset/types";
import { createMediaMaterializationError } from "../content/media-errors";
import { validateAudioBytes } from "./audio-validation";
import {
  assertPublicAudioAddress,
  isAudioRedirect,
  pinnedHttpsFetch,
  resolveAudioAddresses,
  stripAudioCredentials,
  validateSecureAudioUrl,
} from "./downloader-network";

/** Minimal response surface used by the secure downloader. */
export interface SecureAudioFetchResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: AsyncIterable<Uint8Array> | null;
}

/** A connection target pinned to one already-validated DNS answer. */
export interface AudioPinnedDispatcher {
  readonly address: string;
}

/** Injectable network call used by deterministic downloader tests and hosts. */
export type SecureAudioFetch = (
  url: URL,
  init: Readonly<{
    signal: AbortSignal;
    headers: Headers;
    dispatcher: unknown;
  }>,
) => Promise<SecureAudioFetchResponse>;

/** Dependencies and hard bounds for the shared secure audio downloader. */
export interface SecureAudioDownloaderOptions {
  readonly fetch?: SecureAudioFetch;
  readonly resolver?: (hostname: string) => Promise<readonly string[]>;
  readonly dispatcher?: (
    target: Readonly<{ hostname: string; address: string }>,
  ) => unknown;
  readonly clock?: Readonly<{
    setTimeout(
      callback: () => void,
      milliseconds: number,
    ): ReturnType<typeof setTimeout>;
    clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  }>;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
}

/** Per-download request controls. Credentials are stripped on every redirect. */
export interface SecureAudioDownloadRequest {
  readonly signal?: AbortSignal;
  readonly headers?: HeadersInit;
}

/** Build the bounded HTTPS downloader shared by transcription adapters. */
export function createSecureAudioDownloader(
  options: SecureAudioDownloaderOptions = {},
) {
  const fetch = options.fetch ?? pinnedHttpsFetch;
  const resolver = options.resolver ?? resolveAudioAddresses;
  const makeDispatcher =
    options.dispatcher ?? ((target) => ({ address: target.address }));
  const clock = options.clock ?? { setTimeout, clearTimeout };
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 3;

  if (!Number.isFinite(maxBytes) || maxBytes <= 0)
    throw new TypeError("Audio download maxBytes must be positive");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError("Audio download timeoutMs must be positive");
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
    throw new TypeError(
      "Audio download maxRedirects must be a non-negative integer",
    );

  return async function download(
    url: URL,
    requestOptions: SecureAudioDownloadRequest = {},
  ): Promise<DataAsset> {
    throwIfAborted(requestOptions.signal);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(requestOptions.signal?.reason);
    requestOptions.signal?.addEventListener("abort", abort, { once: true });
    const timer = clock.setTimeout(() => {
      timedOut = true;
      controller.abort(
        createMediaMaterializationError({ reason: "time-limit" }),
      );
    }, timeoutMs);
    try {
      let current = new URL(url.href);
      let headers = new Headers(requestOptions.headers);
      for (let redirects = 0; ; redirects += 1) {
        validateSecureAudioUrl(current);
        let addresses: readonly string[];
        try {
          addresses = await raceAbort(
            resolver(current.hostname),
            controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted)
            throw controller.signal.reason ?? error;
          throw networkError(error);
        }
        if (addresses.length === 0) throw materialization("blocked-address");
        for (const address of addresses) assertPublicAudioAddress(address);
        const dispatcher = makeDispatcher({
          hostname: current.hostname,
          address: addresses[0]!,
        });
        let response: SecureAudioFetchResponse;
        try {
          response = await fetch(current, {
            signal: controller.signal,
            headers,
            dispatcher,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            if (timedOut) throw materialization("time-limit");
            throw (
              requestOptions.signal?.reason ?? controller.signal.reason ?? error
            );
          }
          throw networkError(error);
        }
        if (isAudioRedirect(response.status)) {
          if (redirects >= maxRedirects) throw materialization("redirect");
          const location = response.headers.get("location");
          if (!location) throw materialization("redirect");
          await response.body?.[Symbol.asyncIterator]().return?.();
          try {
            current = new URL(location, current);
          } catch {
            throw materialization("redirect");
          }
          headers = stripAudioCredentials(headers);
          continue;
        }
        if (response.status < 200 || response.status >= 300)
          throw httpError(response.status);
        return await readAudioResponse(response, maxBytes, controller);
      }
    } finally {
      clock.clearTimeout(timer);
      requestOptions.signal?.removeEventListener("abort", abort);
    }
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("aborted", "AbortError");
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function httpError(status: number): Error & { readonly status: number } {
  return Object.freeze(
    Object.assign(
      new Error(`Audio download failed with HTTP status ${status}.`),
      { name: "AudioDownloadHttpError", status },
    ),
  );
}

function networkError(error: unknown): Error & { readonly code?: string } {
  const code =
    typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  return Object.freeze(
    Object.assign(new Error("Audio download network operation failed."), {
      name: "AudioDownloadNetworkError",
      ...(code === undefined ? {} : { code }),
    }),
  );
}

/** Default shared secure downloader. */
export const downloadAudio = createSecureAudioDownloader();

async function readAudioResponse(
  response: SecureAudioFetchResponse,
  maxBytes: number,
  controller: AbortController,
): Promise<DataAsset> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort();
    throw materialization("byte-limit");
  }
  if (!response.body) throw materialization("mime-mismatch");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      controller.abort();
      throw materialization("byte-limit");
    }
    chunks.push(chunk.slice());
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let mediaType: string;
  try {
    mediaType = validateAudioBytes(
      data,
      response.headers.get("content-type") ?? undefined,
    );
  } catch {
    throw materialization("mime-mismatch");
  }
  return { type: "data", data, mediaType, size };
}

function materialization(
  reason:
    | "blocked-address"
    | "redirect"
    | "byte-limit"
    | "time-limit"
    | "mime-mismatch",
) {
  return createMediaMaterializationError({ reason });
}
