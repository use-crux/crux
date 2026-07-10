/**
 * BYO provider transport contracts.
 *
 * `transport` currently covers managed non-streaming generation. Streaming
 * providers expose incompatible live stream handles, so stream transport fails
 * explicitly instead of silently falling back to the SDK client.
 *
 * @module
 */

/** Error thrown when `stream()` receives a `transport` callback. */
export class CruxTransportStreamUnsupportedError extends Error {
  override readonly name = "CruxTransportStreamUnsupportedError";

  constructor(adapterId: string) {
    super(`Adapter "${adapterId}" does not support stream() with transport. Use generate() or the adapter SDK directly.`);
  }
}
