import type { Asset } from "../asset";
import type { ProviderOptions } from "./tool";

/**
 * Media values accepted by message content.
 *
 * Pass app-native media directly to `generate()` or `stream()`: HTTPS/data URL
 * strings, `URL`, `Uint8Array`, `ArrayBuffer`, `Blob`, or an already usable
 * `Asset`. Model calls never persist media; call `assetStore.put(asset)` at an
 * explicit save boundary when durable storage is needed.
 *
 * `AssetRef` is intentionally absent. A persistence owner must hydrate refs
 * with its own `AssetStore.get(ref)` before invoking a model.
 */
export type MediaSource =
  | Asset
  | string
  | URL
  | Uint8Array
  | ArrayBuffer
  | Blob;

/**
 * Canonical multimodal content part.
 *
 * Use `text` for natural language, `image` for image inputs, and `file` for
 * general files such as PDFs. Media sources are validated after prompt
 * resolution and before provider I/O, so malformed URLs, raw base64 strings,
 * unsupported MIME types, and cross-provider file references fail without a
 * model request.
 *
 * @example
 * ```ts
 * await openai.generate(prompt, {
 *   model: 'gpt-5',
 *   messages: [{
 *     role: 'user',
 *     content: [
 *       { type: 'text', text: 'Describe this.' },
 *       { type: 'image', source: new URL('https://example.com/chart.png') },
 *     ],
 *   }],
 * })
 * ```
 */
export type ContentPart =
  | {
      readonly type: "text";
      readonly text: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "image";
      readonly source: MediaSource;
      readonly mediaType?: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "audio";
      readonly source: MediaSource;
      readonly mediaType?: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "video";
      readonly source: MediaSource;
      readonly mediaType?: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "file";
      readonly source: MediaSource;
      readonly mediaType?: string;
      readonly filename?: string;
      readonly providerOptions?: ProviderOptions;
    };

/** Canonical message content: plain text or structured multimodal parts. */
export type MessageContent = string | readonly ContentPart[];

/**
 * A model-requested tool invocation surfaced in assistant output.
 *
 * `ToolCallPart` is assistant lifecycle output, not a `ContentPart`: it never
 * appears in system/user/tool message content, and it is never itself a media
 * or text input to a model. `input` stays `unknown` because tool argument
 * shapes are declared by the tool definition, not by the content contract.
 */
export interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly providerOptions?: ProviderOptions;
}

/**
 * Model-produced reasoning surfaced in assistant output.
 *
 * `ReasoningPart` is assistant lifecycle output, not a `ContentPart`. Providers
 * that do not expose reasoning simply never produce this part; callers must
 * not assume every assistant turn contains one.
 */
export interface ReasoningPart {
  readonly type: "reasoning";
  readonly text: string;
  readonly providerOptions?: ProviderOptions;
}

/**
 * Ordered assistant output: text/media content plus tool-call and reasoning
 * lifecycle parts.
 *
 * Only assistant messages and `GenerateResult.content` use this wider union.
 * System, user, and tool message content stays exactly `ContentPart`, so a
 * persisted or replayed non-assistant message can never carry a tool call or
 * reasoning trace as ordinary input.
 */
export type AssistantContentPart = ContentPart | ToolCallPart | ReasoningPart;
