/**
 * Process-local ordered steering mailbox for Agent Work.
 *
 * Identity records store only command ids and payload digests. Raw content is
 * retained in memory for later delivery and is never part of the identity key.
 *
 * @internal
 * @module
 */

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
  readonly content: AgentSteeringContent;
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
  accept(input: AcceptAgentSteeringInput): WorkSteeringReceipt;
  /** Claim undelivered steering as ordered canonical user messages. */
  claimForProviderStep(): readonly Message[];
  /** Read identity-only records for tests and diagnostics. */
  identities(): readonly AgentSteeringIdentityRecord[];
  /** Mark the mailbox closed so further acceptance rejects. */
  close(): void;
  /** Whether the mailbox still accepts commands. */
  isOpen(): boolean;
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
    accept(input: AcceptAgentSteeringInput): WorkSteeringReceipt {
      if (!open) {
        throw new WorkNotActiveError(options.workId);
      }
      const content = normalizeSteeringContent(input.content);
      const payloadHash = hashSteeringContent(content);
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
        if (entry.delivered) {
          continue;
        }
        entry.delivered = true;
        claimed.push(steeringMessage(entry.content));
      }
      return Object.freeze(claimed);
    },

    identities(): readonly AgentSteeringIdentityRecord[] {
      return Object.freeze(ordered.map((entry) => entry.identity));
    },

    close(): void {
      open = false;
    },

    isOpen(): boolean {
      return open;
    },
  });
}

/** Digest steering content for identity records without storing the payload. */
export function hashSteeringContent(content: AgentSteeringContent): string {
  return `sha256:${sha256Hex(encoder.encode(fingerprintSteeringContent(content)))}`;
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

function fingerprintSteeringContent(content: AgentSteeringContent): string {
  if (typeof content === "string") {
    return JSON.stringify({ kind: "text", text: content });
  }
  return JSON.stringify({
    kind: "parts",
    parts: content.map((part) => {
      if (part.type === "text") {
        return { type: "text", text: part.text };
      }
      return {
        type: part.type,
        mediaType: "mediaType" in part ? part.mediaType ?? null : null,
        filename: "filename" in part ? part.filename ?? null : null,
        source: fingerprintMediaSource(part.source),
      };
    }),
  });
}

function fingerprintMediaSource(source: unknown): string {
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
    return `blob:${source.type}:${source.size}`;
  }
  if (
    typeof source === "object" &&
    source !== null &&
    "sha256" in source &&
    typeof (source as { sha256?: unknown }).sha256 === "string"
  ) {
    return `asset:${(source as { sha256: string }).sha256}`;
  }
  return `opaque:${Object.prototype.toString.call(source)}`;
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
