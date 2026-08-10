/**
 * Process-local ordered steering mailbox for Agent Work.
 *
 * Identity records store only command ids and payload digests. Raw content is
 * retained in memory for later delivery and is never part of the identity key.
 * Delivered payloads and closed mailboxes are disposed so process-local memory
 * does not retain raw steering content after it is no longer needed.
 *
 * @internal
 * @module
 */

import type { Asset } from "../../asset/types";
import { sha256Hex } from "../../content/sha256";
import type { Message } from "../../generation/messages";
import type { MessageContent } from "../../types/content";
import type {
  AgentSteeringContent,
  WorkSteeringReceipt,
} from "../agent-handle";
import { WorkNotActiveError } from "../errors";

const encoder = new TextEncoder();
const AGENT_STEERING_PROVENANCE = "agent-steering" as const;

/** Identity-safe acceptance record without raw payload content. */
export interface AgentSteeringIdentityRecord {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly cursor: string;
  readonly acceptedAt: string;
  readonly outcome: "accepted";
}

/** One accepted steering entry retained only in process memory. */
export interface AcceptedAgentSteering {
  readonly identity: AgentSteeringIdentityRecord;
  content: AgentSteeringContent | undefined;
  delivered: boolean;
}

/** Inputs for accepting one process-local steering command. */
export interface AcceptAgentSteeringInput {
  readonly commandId: string;
  readonly content: AgentSteeringContent;
}

/** Process-local steering mailbox for one Work occurrence. @internal */
export interface AgentSteeringMailbox {
  /** Accept one ordered command idempotently, or reject terminal Work. */
  accept(input: AcceptAgentSteeringInput): Promise<WorkSteeringReceipt>;
  /** Claim undelivered steering as ordered canonical user messages. */
  claimForProviderStep(): readonly Message[];
  /** Read identity-only records for tests and diagnostics. */
  identities(): readonly AgentSteeringIdentityRecord[];
  /** Mark the mailbox closed so further acceptance rejects. */
  close(): void;
  /** Drop raw content and close the mailbox permanently. */
  dispose(): void;
  /** Whether the mailbox still accepts commands. */
  isOpen(): boolean;
  /** Whether any raw undelivered content remains (tests and diagnostics). */
  hasRawContent(): boolean;
}

/** Create one isolated ordered mailbox for a single Work id. */
export function createAgentSteeringMailbox(options: {
  readonly workId: string;
  readonly now?: () => Date;
}): AgentSteeringMailbox {
  const now = options.now ?? (() => new Date());
  const byCommand = new Map<string, AcceptedAgentSteering>();
  const ordered: AcceptedAgentSteering[] = [];
  let nextCursor = 0;
  let open = true;

  return Object.freeze({
    async accept(input: AcceptAgentSteeringInput): Promise<WorkSteeringReceipt> {
      if (!open) {
        throw new WorkNotActiveError(options.workId);
      }
      const content = normalizeSteeringContent(input.content);
      const payloadHash = await hashSteeringContent(content);
      const existing = byCommand.get(input.commandId);
      if (existing) {
        if (existing.identity.payloadHash !== payloadHash) {
          throw new TypeError(
            "Agent steering command identity was reused with different content.",
          );
        }
        return receiptFrom(existing.identity);
      }

      nextCursor += 1;
      const acceptedAt = now();
      const identity = Object.freeze({
        commandId: input.commandId,
        payloadHash,
        cursor: String(nextCursor),
        acceptedAt: acceptedAt.toISOString(),
        outcome: "accepted" as const,
      });
      // Content is process-local delivery state only; identity stays payload-free.
      const entry: AcceptedAgentSteering = {
        identity,
        content,
        delivered: false,
      };
      byCommand.set(input.commandId, entry);
      ordered.push(entry);
      return receiptFrom(identity);
    },

    claimForProviderStep(): readonly Message[] {
      const claimed: Message[] = [];
      for (const entry of ordered) {
        if (entry.delivered || entry.content === undefined) {
          continue;
        }
        entry.delivered = true;
        claimed.push(steeringMessage(entry.content));
        // Retain identity for idempotent command replay; drop raw payload bytes.
        entry.content = undefined;
      }
      return Object.freeze(claimed);
    },

    identities(): readonly AgentSteeringIdentityRecord[] {
      return Object.freeze(ordered.map((entry) => entry.identity));
    },

    close(): void {
      open = false;
    },

    dispose(): void {
      open = false;
      for (const entry of ordered) {
        entry.content = undefined;
        entry.delivered = true;
      }
      byCommand.clear();
      ordered.length = 0;
    },

    isOpen(): boolean {
      return open;
    },

    hasRawContent(): boolean {
      return ordered.some((entry) => entry.content !== undefined);
    },
  });
}

/** Digest steering content for identity records without storing the payload. */
export async function hashSteeringContent(
  content: AgentSteeringContent,
): Promise<string> {
  return `sha256:${sha256Hex(
    encoder.encode(await fingerprintSteeringContent(content)),
  )}`;
}

function receiptFrom(
  identity: AgentSteeringIdentityRecord,
): WorkSteeringReceipt {
  return Object.freeze({
    id: identity.commandId,
    cursor: Object.freeze({ value: identity.cursor }),
    acceptedAt: new Date(identity.acceptedAt),
    outcome: identity.outcome,
  });
}

function normalizeSteeringContent(
  content: AgentSteeringContent,
): AgentSteeringContent {
  if (typeof content === "string") {
    if (content.length === 0) {
      throw new TypeError("Agent steering content must not be empty.");
    }
    return content;
  }
  if (!Array.isArray(content) || content.length === 0) {
    throw new TypeError(
      "Agent steering content must be a non-empty string or content-part list.",
    );
  }
  return Object.freeze([...content]) as MessageContent;
}

async function fingerprintSteeringContent(
  content: AgentSteeringContent,
): Promise<string> {
  if (typeof content === "string") {
    return JSON.stringify({ kind: "text", text: content });
  }
  const parts = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    parts.push({
      type: part.type,
      mediaType: "mediaType" in part ? part.mediaType ?? null : null,
      filename: "filename" in part ? part.filename ?? null : null,
      source: await fingerprintMediaSource(part.source),
    });
  }
  return JSON.stringify({
    kind: "parts",
    parts,
  });
}

async function fingerprintMediaSource(source: unknown): Promise<string> {
  if (typeof source === "string") {
    return `string:${source}`;
  }
  if (source instanceof URL) {
    return `url:${source.href}`;
  }
  if (source instanceof Uint8Array) {
    return `bytes:${sha256Hex(source)}`;
  }
  if (source instanceof ArrayBuffer) {
    return `bytes:${sha256Hex(new Uint8Array(source))}`;
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const bytes = new Uint8Array(await source.arrayBuffer());
    return `bytes:${sha256Hex(bytes)}`;
  }
  if (isAsset(source)) {
    return fingerprintAsset(source);
  }
  if (
    typeof source === "object" &&
    source !== null &&
    "sha256" in source &&
    typeof (source as { sha256?: unknown }).sha256 === "string"
  ) {
    return `asset:${(source as { sha256: string }).sha256}`;
  }
  throw new TypeError(
    "Agent steering media source is not identity-safe. Provide bytes, a Blob, a URL/string, or a source with a stable sha256 digest.",
  );
}

async function fingerprintAsset(asset: Asset): Promise<string> {
  if (typeof asset.sha256 === "string" && asset.sha256.length > 0) {
    return `asset:${asset.sha256}`;
  }
  if (asset.type === "data") {
    if (asset.data instanceof Uint8Array) {
      return `bytes:${sha256Hex(asset.data)}`;
    }
    if (typeof Blob !== "undefined" && asset.data instanceof Blob) {
      const bytes = new Uint8Array(await asset.data.arrayBuffer());
      return `bytes:${sha256Hex(bytes)}`;
    }
  }
  if (asset.type === "url") {
    return `url:${asset.url.href}`;
  }
  if (asset.type === "provider-file") {
    return `provider-file:${asset.provider}:${asset.fileId}`;
  }
  throw new TypeError(
    "Agent steering Asset source is not identity-safe without bytes or sha256.",
  );
}

function isAsset(source: unknown): source is Asset {
  return (
    typeof source === "object" &&
    source !== null &&
    "type" in source &&
    (source.type === "data" ||
      source.type === "url" ||
      source.type === "provider-file")
  );
}

function steeringMessage(content: AgentSteeringContent): Message {
  return Object.freeze({
    role: "user" as const,
    content,
    metadata: Object.freeze({
      provenance: AGENT_STEERING_PROVENANCE,
    }),
  });
}
