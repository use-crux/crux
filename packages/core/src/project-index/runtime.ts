/**
 * Provider-neutral delivery for owner-scoped Project Index runtime facts.
 *
 * Runtime updates are development visibility: enqueueing never waits for Local
 * and delivery failures must not alter model or tool execution.
 *
 * @module
 */

import { z } from "zod";

import {
  ProjectDefinitionKindSchema,
  ProjectDefinitionSchema,
  ProjectRelationSchema,
  type ProjectDefinition,
  type ProjectDefinitionKind,
  type ProjectRelation,
} from "./index";
import { getHooks } from "../runtime/runtime";

export interface ProjectIndexRuntimeOwner {
  readonly definitionId: string;
  readonly kind: ProjectDefinitionKind;
}

export interface ProjectIndexRuntimeError {
  readonly phase: string;
  readonly category: string;
}

/** Safe owner-level facts associated with one successful runtime replacement. */
export type ProjectIndexRuntimeOwnerFacts = {
  readonly kind: "mcp.discovery";
  /** Crux materialization path, not the remote server implementation. */
  readonly implementation: "official-client" | "ai-sdk-native";
  /** Negotiated MCP protocol version. */
  readonly protocolVersion?: string;
  /** Self-reported, presentation-only identity from MCP initialization. */
  readonly server?: {
    readonly untrusted: true;
    readonly name?: string;
    readonly version?: string;
  };
};

export type ProjectIndexRuntimeUpdate =
  | {
      readonly schemaVersion: 1;
      readonly operation: "replace";
      readonly updateId: string;
      readonly owner: ProjectIndexRuntimeOwner;
      readonly observedAt: string;
      readonly revision: string;
      readonly ownerFacts: ProjectIndexRuntimeOwnerFacts;
      readonly definitions: readonly ProjectDefinition[];
      readonly relations: readonly ProjectRelation[];
    }
  | {
      readonly schemaVersion: 1;
      readonly operation: "failure";
      readonly updateId: string;
      readonly owner: ProjectIndexRuntimeOwner;
      readonly observedAt: string;
      readonly error: ProjectIndexRuntimeError;
    };

const ProjectIndexRuntimeOwnerSchema = z.object({
  definitionId: z.string().min(1),
  kind: ProjectDefinitionKindSchema,
}) satisfies z.ZodType<ProjectIndexRuntimeOwner>;

const ProjectIndexRuntimeErrorSchema = z.object({
  phase: z.string().min(1),
  category: z.string().min(1),
}) satisfies z.ZodType<ProjectIndexRuntimeError>;

const CONTROL_CHARACTER = /\p{Cc}/u;

function normalizedBoundedText(maxCodePoints: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1)
        .refine((value) => !CONTROL_CHARACTER.test(value))
        .refine((value) => Array.from(value).length <= maxCodePoints),
    );
}

const ProjectIndexRuntimeOwnerFactsSchema = z
  .object({
    kind: z.literal("mcp.discovery"),
    implementation: z.enum(["official-client", "ai-sdk-native"]),
    protocolVersion: normalizedBoundedText(64).optional(),
    server: z
      .object({
        untrusted: z.literal(true),
        name: normalizedBoundedText(256).optional(),
        version: normalizedBoundedText(128).optional(),
      })
      .strict()
      .refine(
        (server) => server.name !== undefined || server.version !== undefined,
      )
      .optional(),
  })
  .strict() satisfies z.ZodType<ProjectIndexRuntimeOwnerFacts>;

/** Runtime-update wire schema shared by producers and delivery transports. */
export const ProjectIndexRuntimeUpdateSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        schemaVersion: z.literal(1),
        operation: z.literal("replace"),
        updateId: z.string().min(1),
        owner: ProjectIndexRuntimeOwnerSchema,
        observedAt: z.string().min(1),
        revision: z.string().min(1),
        ownerFacts: ProjectIndexRuntimeOwnerFactsSchema,
        definitions: z.array(ProjectDefinitionSchema),
        relations: z.array(ProjectRelationSchema),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        operation: z.literal("failure"),
        updateId: z.string().min(1),
        owner: ProjectIndexRuntimeOwnerSchema,
        observedAt: z.string().min(1),
        error: ProjectIndexRuntimeErrorSchema,
      })
      .strict(),
  ],
) satisfies z.ZodType<ProjectIndexRuntimeUpdate>;

export interface ProjectIndexRuntimeFlushOptions {
  /** Maximum time to wait for requests already accepted by the transport. */
  readonly timeoutMs: number;
}

export interface ProjectIndexRuntimeTransport {
  /** Queue one update without awaiting external delivery. */
  enqueue(update: ProjectIndexRuntimeUpdate): void;
  /** Wait within a fixed bound for updates accepted before this call. */
  flush(options: ProjectIndexRuntimeFlushOptions): Promise<"ok" | "timeout">;
}

export interface CreateProjectIndexRuntimeTransportOptions {
  /** Deliver one validated update to a Project Index service boundary. */
  readonly deliver: (update: ProjectIndexRuntimeUpdate) => Promise<void>;
  /** Receive a safe delivery failure without affecting the queue. */
  readonly onDeliveryError?: (error: unknown) => void;
}

/**
 * Enqueue a runtime update when a host transport is installed.
 *
 * Missing or faulty development tooling is intentionally ignored so Project
 * Index visibility can never become part of tool execution correctness.
 */
export function enqueueProjectIndexRuntimeUpdate(
  update: ProjectIndexRuntimeUpdate,
): void {
  try {
    getHooks().projectIndexRuntimeTransport?.enqueue(update);
  } catch {
    if (typeof console !== "undefined") {
      console.warn("[crux] project index runtime update could not be queued");
    }
  }
}

/**
 * Create a non-blocking transport with an independent FIFO per owner.
 *
 * An unavailable owner cannot head-of-line block discoveries from another
 * owner, while each owner's observations retain their enqueue order.
 */
export function createProjectIndexRuntimeTransport(
  options: CreateProjectIndexRuntimeTransportOptions,
): ProjectIndexRuntimeTransport {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue(update) {
      const parsed = ProjectIndexRuntimeUpdateSchema.parse(update);
      const ownerId = parsed.owner.definitionId;
      const tail = (tails.get(ownerId) ?? Promise.resolve())
        .then(() => options.deliver(parsed))
        .catch((error: unknown) => {
          try {
            options.onDeliveryError?.(error);
          } catch {
            // Diagnostics must not poison delivery for subsequent updates.
          }
        });
      tails.set(ownerId, tail);
      void tail.then(() => {
        if (tails.get(ownerId) === tail) tails.delete(ownerId);
      });
    },
    async flush({ timeoutMs }) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
      });
      const accepted = [...tails.values()];
      const outcome = await Promise.race([
        Promise.all(accepted).then(() => "ok" as const),
        timeout,
      ]);
      if (timer !== undefined) clearTimeout(timer);
      return outcome;
    },
  };
}
