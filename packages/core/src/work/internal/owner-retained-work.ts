/**
 * Owner-scoped retention for typed process-local Work handles.
 *
 * @internal
 * @module
 */

import type {
  InternalWorkHandle,
  ProcessLocalWorkKernel,
} from "./process-local-kernel";
import type { InternalWorkTargetDriver } from "./target-driver";

declare const retainedWorkReferenceBrand: unique symbol;

/** Opaque reference to Work retained by one logical owner. @internal */
export interface InternalRetainedWorkReference<TOutput> {
  /** Process-local identity of the retained Work occurrence. */
  readonly id: string;
  readonly [retainedWorkReferenceBrand]: (output: TOutput) => TOutput;
}

class OwnerRetainedWorkReference<TOutput>
  implements InternalRetainedWorkReference<TOutput>
{
  readonly #owner: symbol;

  declare readonly [retainedWorkReferenceBrand]: (
    output: TOutput,
  ) => TOutput;

  constructor(
    readonly id: string,
    owner: symbol,
  ) {
    this.#owner = owner;
    Object.freeze(this);
  }

  belongsTo(owner: symbol): boolean {
    return owner === this.#owner;
  }
}

/** One retained handle and its safe target metadata. @internal */
export interface InternalOwnedWork {
  readonly handle: InternalWorkHandle<unknown>;
  readonly targetId: string;
  readonly targetLabel: string;
}

/** Internal capability for accepting and recovering one owner's child Work. */
export interface InternalWorkOwnerPort {
  /** Accept one Work occurrence and retain its typed handle under this owner. */
  spawnAndRetain<TOutput>(
    driver: InternalWorkTargetDriver<TOutput>,
    options?: InternalWorkOwnerSpawnOptions,
  ): Promise<InternalRetainedWorkReference<TOutput>>;

  /**
   * Retain an already accepted process-local handle in this owner's inbox.
   *
   * @remarks Used when Agent Work acceptance already ran through the shared
   * kernel and the owner only needs visibility for model-facing control.
   */
  retainExisting<TOutput>(
    handle: InternalWorkHandle<TOutput>,
    options: {
      readonly targetId: string;
      readonly targetLabel: string;
    },
  ): InternalRetainedWorkReference<TOutput>;

  /** Recover a retained handle only when this port originated its reference. */
  recover<TOutput>(
    reference: InternalRetainedWorkReference<TOutput>,
  ): InternalWorkHandle<TOutput> | undefined;

  /** List frozen, content-free references retained by this owner. */
  list(): readonly InternalRetainedWorkReference<unknown>[];

  /** Look up a retained handle by id within this owner's private inbox. */
  lookup(id: string): InternalWorkHandle<unknown> | undefined;

  /** Inspect the private metadata-bearing record retained for one Work id. */
  inspect(id: string): InternalOwnedWork | undefined;

  /** Remove one directly owned Work from this inbox without cancelling it. */
  detach(id: string): boolean;
}

/** Cancellation-only linkage accepted by owner-retained child Work. @internal */
export interface InternalWorkOwnerSpawnOptions {
  readonly kind: "cancellation-only";
  readonly signal?: AbortSignal;
  /** Run without retaining this Work in the ambient Effect boundary. */
  readonly effectParent?: "independent";
  /** Bound child Agent identity. */
  readonly targetId: string;
  /** Authored Tool map name for the bound child. */
  readonly targetLabel: string;
}

/** Create one isolated logical-owner capability over an injected Work kernel. */
export function createInternalWorkOwnerPort(
  kernel: ProcessLocalWorkKernel,
): InternalWorkOwnerPort {
  const owner = Symbol("internal-work-owner");
  const retainedHandles = new Map<string, InternalOwnedWork>();

  return Object.freeze({
    async spawnAndRetain<TOutput>(
      driver: InternalWorkTargetDriver<TOutput>,
      options?: InternalWorkOwnerSpawnOptions,
    ): Promise<InternalRetainedWorkReference<TOutput>> {
      const handle = await kernel.spawn(driver, options);
      return this.retainExisting(handle, {
        targetId: options?.targetId ?? "",
        targetLabel: options?.targetLabel ?? "",
      });
    },

    retainExisting<TOutput>(
      handle: InternalWorkHandle<TOutput>,
      options: {
        readonly targetId: string;
        readonly targetLabel: string;
      },
    ): InternalRetainedWorkReference<TOutput> {
      const reference = new OwnerRetainedWorkReference<TOutput>(
        handle.id,
        owner,
      );
      retainedHandles.set(
        handle.id,
        Object.freeze({
          handle,
          targetId: options.targetId,
          targetLabel: options.targetLabel,
        }),
      );
      return reference;
    },

    recover<TOutput>(
      reference: InternalRetainedWorkReference<TOutput>,
    ): InternalWorkHandle<TOutput> | undefined {
      if (
        !(reference instanceof OwnerRetainedWorkReference) ||
        !reference.belongsTo(owner)
      ) {
        return undefined;
      }

      return retainedHandles.get(reference.id)?.handle as
        | InternalWorkHandle<TOutput>
        | undefined;
    },

    list(): readonly InternalRetainedWorkReference<unknown>[] {
      return Object.freeze(
        [...retainedHandles.entries()].map(
          ([id]) => new OwnerRetainedWorkReference<unknown>(
            id,
            owner,
          ),
        ),
      );
    },

    lookup(id: string): InternalWorkHandle<unknown> | undefined {
      return retainedHandles.get(id)?.handle;
    },

    inspect(id: string): InternalOwnedWork | undefined {
      return retainedHandles.get(id);
    },

    detach(id: string): boolean {
      return retainedHandles.delete(id);
    },
  });
}
