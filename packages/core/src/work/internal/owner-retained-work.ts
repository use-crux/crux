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

/** Internal capability for accepting and recovering one owner's child Work. */
export interface InternalWorkOwnerPort {
  /** Accept one Work occurrence and retain its typed handle under this owner. */
  spawnAndRetain<TOutput>(
    driver: InternalWorkTargetDriver<TOutput>,
    options?: InternalWorkOwnerSpawnOptions,
  ): Promise<InternalRetainedWorkReference<TOutput>>;

  /** Recover a retained handle only when this port originated its reference. */
  recover<TOutput>(
    reference: InternalRetainedWorkReference<TOutput>,
  ): InternalWorkHandle<TOutput> | undefined;

  /** List frozen, content-free references retained by this owner. */
  list(): readonly InternalRetainedWorkReference<unknown>[];

  /** Look up a retained handle by id within this owner's private inbox. */
  lookup(id: string): InternalWorkHandle<unknown> | undefined;

  /** Remove one directly owned Work from this inbox without cancelling it. */
  detach(id: string): boolean;
}

/** Cancellation-only linkage accepted by owner-retained child Work. @internal */
export interface InternalWorkOwnerSpawnOptions {
  readonly kind: "cancellation-only";
  readonly signal?: AbortSignal;
  /** Run without retaining this Work in the ambient Effect boundary. */
  readonly effectParent?: "independent";
}

/** Create one isolated logical-owner capability over an injected Work kernel. */
export function createInternalWorkOwnerPort(
  kernel: ProcessLocalWorkKernel,
): InternalWorkOwnerPort {
  const owner = Symbol("internal-work-owner");
  const retainedHandles = new Map<string, InternalWorkHandle<unknown>>();

  return Object.freeze({
    async spawnAndRetain<TOutput>(
      driver: InternalWorkTargetDriver<TOutput>,
      options?: InternalWorkOwnerSpawnOptions,
    ): Promise<InternalRetainedWorkReference<TOutput>> {
      const handle = await kernel.spawn(driver, options);
      const reference = new OwnerRetainedWorkReference<TOutput>(handle.id, owner);
      retainedHandles.set(handle.id, handle);
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

      return retainedHandles.get(reference.id) as
        | InternalWorkHandle<TOutput>
        | undefined;
    },

    list(): readonly InternalRetainedWorkReference<unknown>[] {
      return Object.freeze(
        [...retainedHandles.keys()].map(
          (id) => new OwnerRetainedWorkReference<unknown>(id, owner),
        ),
      );
    },

    lookup(id: string): InternalWorkHandle<unknown> | undefined {
      return retainedHandles.get(id);
    },

    detach(id: string): boolean {
      return retainedHandles.delete(id);
    },
  });
}
