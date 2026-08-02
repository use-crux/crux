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
  readonly #handle: InternalWorkHandle<TOutput>;

  declare readonly [retainedWorkReferenceBrand]: (
    output: TOutput,
  ) => TOutput;

  constructor(
    readonly id: string,
    owner: symbol,
    handle: InternalWorkHandle<TOutput>,
  ) {
    this.#owner = owner;
    this.#handle = handle;
    Object.freeze(this);
  }

  recover(owner: symbol): InternalWorkHandle<TOutput> | undefined {
    return owner === this.#owner ? this.#handle : undefined;
  }
}

/** Internal capability for accepting and recovering one owner's child Work. */
export interface InternalWorkOwnerPort {
  /** Accept one Work occurrence and retain its typed handle under this owner. */
  spawnAndRetain<TOutput>(
    driver: InternalWorkTargetDriver<TOutput>,
  ): Promise<InternalRetainedWorkReference<TOutput>>;

  /** Recover a retained handle only when this port originated its reference. */
  recover<TOutput>(
    reference: InternalRetainedWorkReference<TOutput>,
  ): InternalWorkHandle<TOutput> | undefined;
}

/** Create one isolated logical-owner capability over an injected Work kernel. */
export function createInternalWorkOwnerPort(
  kernel: ProcessLocalWorkKernel,
): InternalWorkOwnerPort {
  const owner = Symbol("internal-work-owner");

  return Object.freeze({
    async spawnAndRetain<TOutput>(
      driver: InternalWorkTargetDriver<TOutput>,
    ): Promise<InternalRetainedWorkReference<TOutput>> {
      const handle = await kernel.spawn(driver);
      return new OwnerRetainedWorkReference(handle.id, owner, handle);
    },

    recover<TOutput>(
      reference: InternalRetainedWorkReference<TOutput>,
    ): InternalWorkHandle<TOutput> | undefined {
      return reference instanceof OwnerRetainedWorkReference
        ? reference.recover(owner)
        : undefined;
    },
  });
}
