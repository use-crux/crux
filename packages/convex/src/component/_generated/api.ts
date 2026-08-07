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
import type * as runtime_composite_deferred from "../runtime/composite_deferred.js";
import type * as runtime_composite_effects from "../runtime/composite_effects.js";
import type * as runtime_composite_events from "../runtime/composite_events.js";
import type * as runtime_composite_outbox from "../runtime/composite_outbox.js";
import type * as runtime_composite_state from "../runtime/composite_state.js";
import type * as runtime_composite_timers from "../runtime/composite_timers.js";
import type * as runtime_composite_transaction from "../runtime/composite_transaction.js";
import type * as runtime_composite_utils from "../runtime/composite_utils.js";
import type * as runtime_composite_waiters from "../runtime/composite_waiters.js";
import type * as runtime_composites from "../runtime/composites.js";
import type * as runtime_deferred from "../runtime/deferred.js";
import type * as runtime_eval_host from "../runtime/eval_host.js";
import type * as runtime_events from "../runtime/events.js";
import type * as runtime_leases from "../runtime/leases.js";
import type * as runtime_outbox from "../runtime/outbox.js";
import type * as runtime_results from "../runtime/results.js";
import type * as runtime_session_checkpoint from "../runtime/session_checkpoint.js";
import type * as runtime_session_execution from "../runtime/session_execution.js";
import type * as runtime_session_helpers from "../runtime/session_helpers.js";
import type * as runtime_session_identity from "../runtime/session_identity.js";
import type * as runtime_session_port from "../runtime/session_port.js";
import type * as runtime_sessions from "../runtime/sessions.js";
import type * as runtime_shared from "../runtime/shared.js";
import type * as runtime_state from "../runtime/state.js";
import type * as runtime_state_helpers from "../runtime/state_helpers.js";
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
  "runtime/composite_deferred": typeof runtime_composite_deferred;
  "runtime/composite_effects": typeof runtime_composite_effects;
  "runtime/composite_events": typeof runtime_composite_events;
  "runtime/composite_outbox": typeof runtime_composite_outbox;
  "runtime/composite_state": typeof runtime_composite_state;
  "runtime/composite_timers": typeof runtime_composite_timers;
  "runtime/composite_transaction": typeof runtime_composite_transaction;
  "runtime/composite_utils": typeof runtime_composite_utils;
  "runtime/composite_waiters": typeof runtime_composite_waiters;
  "runtime/composites": typeof runtime_composites;
  "runtime/deferred": typeof runtime_deferred;
  "runtime/eval_host": typeof runtime_eval_host;
  "runtime/events": typeof runtime_events;
  "runtime/leases": typeof runtime_leases;
  "runtime/outbox": typeof runtime_outbox;
  "runtime/results": typeof runtime_results;
  "runtime/session_checkpoint": typeof runtime_session_checkpoint;
  "runtime/session_execution": typeof runtime_session_execution;
  "runtime/session_helpers": typeof runtime_session_helpers;
  "runtime/session_identity": typeof runtime_session_identity;
  "runtime/session_port": typeof runtime_session_port;
  "runtime/sessions": typeof runtime_sessions;
  "runtime/shared": typeof runtime_shared;
  "runtime/state": typeof runtime_state;
  "runtime/state_helpers": typeof runtime_state_helpers;
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
