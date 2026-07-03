/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as memory from "../memory.js";
import type * as runtime_events from "../runtime/events.js";
import type * as runtime_leases from "../runtime/leases.js";
import type * as runtime_outbox from "../runtime/outbox.js";
import type * as runtime_shared from "../runtime/shared.js";
import type * as runtime_state from "../runtime/state.js";
import type * as runtime_timers from "../runtime/timers.js";
import type * as runtime_waiters from "../runtime/waiters.js";
import type * as swarm from "../swarm.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  memory: typeof memory;
  "runtime/events": typeof runtime_events;
  "runtime/leases": typeof runtime_leases;
  "runtime/outbox": typeof runtime_outbox;
  "runtime/shared": typeof runtime_shared;
  "runtime/state": typeof runtime_state;
  "runtime/timers": typeof runtime_timers;
  "runtime/waiters": typeof runtime_waiters;
  swarm: typeof swarm;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
