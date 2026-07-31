/**
 * The per-call `ToolLifecycle` session — the single consumption entry point
 * for everything between "the model emitted tool calls" and "tool results
 * are ready for the next round".
 *
 * Authoring stays with `tool()`, `toolMiddleware()`, and
 * `approvalMiddleware()`. Execution goes through one session per
 * `generate()`/`stream()` call, created with {@link createToolLifecycle}.
 * The session owns everything the adapter dialects used to coordinate by
 * hand:
 *
 * - Tool merge precedence (call tools shadow prompt tools) and middleware
 *   chain order (prompt middleware before call middleware).
 * - The full approval protocol: deterministic `approval_<toolCallId>` ids,
 *   crypto token minting, token verification, the approval-request message
 *   shape, decision discovery, and idempotent resume replay.
 * - The per-call gate → execute → settle state machine that both
 *   inversion-of-control regimes drive.
 * - Observability emission for both regime profiles: spans, artifacts,
 *   events, and edges from the canonical graph-record spine.
 * - Output normalization (`toModelOutput`, default shaping, rendering) —
 *   identical in live, resumed, and denied paths.
 * - The `LoadSkill` side effect: detection, re-resolution via the injected
 *   closure, system-prompt augmentation, tool re-arm, step refund.
 * - Post-generation memory capture with at-most-once semantics.
 *
 * Adapter dialects must contain zero tool policy: construct a session,
 * `resume()` before the first provider call, drive rounds (pull regime) or
 * hand over the armed `tools` map (push regime), `applySkillLoads()` per
 * step, `suspend()` on SDK suspension, and `captureTurn()` at the end.
 *
 * @module
 */

import { z } from "zod";
import type { ResolvedPrompt } from "../../resolver/types";
import type { ManagedMemoryWriteGuard } from "../../memory/managed-write-guard";
import type { TimeoutOptions } from "../../generation/timeout";
import {
  TimeoutError,
  toolBudgetMs,
  withAbortSignal,
  withBudget,
} from "../../generation/timeout";
import type { Message } from "../../generation/messages";
import type { JsonValue, ToolModelOutput } from "../../types/tool";
import type { SystemBlock } from "../../resolver/types";
import type { AdapterResponse, CallArgs, ToolResultEntry } from "../types";
import type { StructuredOutputCapabilities } from "../structured-output";
import {
  CruxStructuredOutputDecodeError,
  CruxUnsupportedStructuredOutputError,
} from "../structured-output";
import type { JsonSchemaObject } from "../structured-output";
import {
  CruxToolInputValidationError,
  decodeToolArgs,
  isZodParameters,
  DEFAULT_TOOL_INPUT_CAPABILITIES,
  type ToolInputPlan,
} from "./tool-input";
import {
  canonicalAppendToolRound,
  canonicalToolResultMessage,
  convertTools,
  inheritMockSourceProvenance,
  normalizeMiddlewareChain,
  prepareToolInputPlans,
  registryHasAuthoredToolSchema,
  withToolInputDecode,
} from "./tool-schema-projection";
import {
  applyToolMiddleware,
  notifyToolApprovalResponses,
} from "../../tools/middleware";
import {
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from "../../tools/approvals";
import type { ToolMiddleware } from "../../tools/types";
import type {
  ApprovalDeclaration,
  ToolApprovalMap,
} from "../../tools/approval-policy";
import { getHooks } from "../../runtime/runtime";
import { getExecutionContext } from "../../runtime/execution-context";
import { observe } from "../../observability";
import {
  instrumentToolSet,
  createToolModelOutput,
  renderToolModelOutput,
  measureModelOutput,
  measureUnknown,
  normalizeToolInput,
  toJsonValue,
  openToolCallSpan,
  emitToolCallArgsArtifact,
  emitToolResultArtifact,
  sourceResultPreview,
  toolCallProvenance,
  emitToolRequestArtifacts,
} from "./emission";
import { captureMemoryTurn, readSkillActivationSession } from "./resolved";
import {
  enrichToolCallsFromMessages,
  enrichToolCallsWithResults,
} from "./memory-capture";
import type { SkillActivationSession } from "../../skill/session";
import { createToolRegistry } from "../../tools/tool-registry";
import { LOAD_SKILL_TOOL_NAME } from "../../skill/tools";
import {
  canonicalToolOutput,
  toolOutputOffloadReceipt,
  withToolOutputOffloadPolicies,
} from "../../request/offload/tool-output";
import {
  OFFLOAD_SUPPORT_TOOL_NAME,
  offloadSupportTools,
} from "../../request/offload/support-tool";
import {
  createApprovalId,
  createApprovalToken as defaultCreateApprovalToken,
  createApprovalRequestMessage,
  createSyntheticToolCallResponse,
  findValidApprovalDecision,
  findApprovedOrDeniedToolCalls,
  findInvalidApprovalToolCalls,
  emitToolApprovalObservation,
} from "./approval";
import type { ApprovalRequestInfo } from "./approval";
import {
  callApprovalDeclarations,
  requiresToolApproval,
} from "./approval-policy-evaluator";
import type { ToolApprovalRequirement } from "./approval-policy-evaluator";
import {
  createApprovalReplayProvenance,
  createCommittedApprovalReplayProvenance,
  matchesApprovalReplayIdentity,
  verifyApprovalReplayCommitment,
  type CommittedApprovalReplayLifecycle,
} from "./approval-replay";
import {
  emitToolApprovalDecisionAuthority,
  emitToolApprovalRequestAuthority,
  recordResumedToolApprovalAuthority,
} from "./approval-evidence";
import { toolSourceReplayIdentity } from "../../tools/tool-source";
import { resolveToolsContext, type ResolvedToolsContext } from "./context";
import {
  withToolLifecycleExecutionOptions,
  type PartialToolLifecycleExecutionOptions,
  type ToolLifecycleExecutionOptions,
} from "./execution-options";
import { runToolScope } from "./scope";
import type { ModelIngressGuard } from "../../safety/input/model-ingress";
import { isPolicyTerminal } from "../../safety/errors";
import { guardToolModelOutput } from "./model-ingress";
import type { ToolModelIngressDialect } from "./model-ingress-port";
import type {
  GuardedSkillIngressAmendment,
  GuardSkillIngressAmendment,
} from "../execution/skill-ingress-amendment";
import {
  systemMessagePrefixPatch,
  type SystemMessagePrefixPatch,
} from "../execution/system-prefix-patch";
import { createToolExposureEvaluator } from "./exposure/evaluator";
import { readToolExposureProvenance } from "./exposure/provenance";
import type { ToolExposureGuards } from "./exposure/types";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** One canonical, schema-sanitized tool descriptor for a provider call. */
export type ToolDescriptor = NonNullable<CallArgs["tools"]>[number];

/** How to append a tool round (assistant tool calls + results) to history. */
export type AppendToolRound = (
  messages: Message[],
  assistantResponse: AdapterResponse,
  toolResults: ToolResultEntry[],
) => Message[];

/**
 * How tool input schemas are compiled for the selected model.
 *
 * - `verified` — the model's declared capability profile is used to lower every
 *   tool schema.
 * - `unverified` — the runtime declares a capability resolver but cannot vouch
 *   for the selected model; any authored tool schema fails before provider I/O.
 * - `default` — no capability resolver applies (e.g. a runtime without
 *   structured-output semantics); the permissive default is used.
 */
export type ToolInputCapabilitiesResolution =
  | {
      readonly kind: "verified";
      readonly capabilities: StructuredOutputCapabilities;
    }
  | {
      readonly kind: "unverified";
      readonly providerId: string;
      readonly modelId?: string;
    }
  | { readonly kind: "default" };

/** Options for {@link createToolLifecycle} — one session per generate/stream call. */
export interface ToolLifecycleOptions {
  /**
   * Which inversion-of-control regime drives the gates.
   *
   * - `'core'` — the dialect extracts tool calls from the provider response
   *   and hands them to `executeRound()`; the session executes them.
   * - `'sdk'` — the underlying SDK runs the tool loop and calls the armed
   *   execute functions; the session never runs a loop of its own
   *   (`executeRound()` throws in this regime — RFC #28 SDK delegation).
   *
   * Also selects the instrumentation emission profile, preserved from the
   * pre-session dialects (resume replays use the full core profile in both
   * regimes).
   */
  readonly regime: "core" | "sdk";
  /** The resolved prompt — tools, toolMiddleware, `_skillSession`, and memory bindings are read internally. */
  readonly resolved: ResolvedPrompt;
  /** Per-call additions (highest precedence), straight from generate/stream opts. */
  readonly call?: {
    readonly tools?: Record<string, unknown>;
    readonly toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
    readonly toolApproval?: ToolApprovalMap;
    readonly toolsContext?: Readonly<Record<string, unknown>>;
    readonly runtimeContext?: unknown;
  };
  /** Identity threaded into spans, hooks, and memory capture. */
  readonly promptId: string | undefined;
  readonly input?: Record<string, unknown>;
  /** Structured timeout budgets for tool execution in this session. */
  readonly timeout?: TimeoutOptions;
  /** @internal Caller cancellation propagated through execution and ingress. */
  readonly abortSignal?: AbortSignal;
  /** @internal Guards post-conversion canonical tool output before writeback. */
  readonly modelIngress?: ModelIngressGuard;
  /** @internal Gates block-managed memory candidates before durable commit. */
  readonly memoryWriteGuard?: ManagedMemoryWriteGuard;
  /** @internal Wraps SDK-owned tools in their native model-output dialect. */
  readonly sdkModelIngress?: ToolModelIngressDialect;
  /** @internal Active provider used for dialect-native semantic projections. */
  readonly modelIngressProvider?: string;
  /**
   * Dialect-owned re-resolution closure: how to resolve the prompt again
   * after `LoadSkill` activates a skill. The session owns everything else
   * about the skill round. When omitted, `applySkillLoads()` is inert.
   */
  readonly reresolve?: (
    skillSession: SkillActivationSession,
  ) => Promise<ResolvedPrompt>;
  /** @internal Guards and exactly shapes post-skill model-input amendments. */
  readonly guardSkillAmendment?: GuardSkillIngressAmendment;
  /**
   * Provider message-shape for a tool round (from `AdapterSpec`). Core
   * regime; the sdk regime always uses the canonical default.
   */
  readonly appendToolRound?: AppendToolRound;
  /** Provider-specific JSON Schema sanitization (from `AdapterSpec`). Core regime. */
  readonly sanitizeToolSchema?: (
    schema: Record<string, unknown>,
  ) => Record<string, unknown>;
  /**
   * Provider structured-output capabilities used to compile tool input schemas.
   * Shorthand for `{ kind: 'verified' }`; absent (and no {@link
   * toolInputCapabilities}) means the permissive default.
   */
  readonly structuredOutputCapabilities?: StructuredOutputCapabilities;
  /**
   * How tool input schemas are compiled for the selected model. Distinguishes an
   * explicitly supported permissive default from a model whose semantics cannot
   * be verified: an `unverified` model with any authored tool schema fails before
   * transport rather than silently receiving permissive capabilities. Takes
   * precedence over {@link structuredOutputCapabilities}.
   */
  readonly toolInputCapabilities?: ToolInputCapabilitiesResolution;
  /** Determinism seam for golden transcript tests. @defaultValue `Date.now` */
  readonly now?: () => number;
  /** Determinism seam for golden transcript tests. @defaultValue crypto random */
  readonly createApprovalToken?: () => string;
}

/** Outcome of {@link ToolLifecycle.resume}. */
export interface ToolResumeOutcome {
  /** History with the synthetic tool round appended (unchanged when nothing replayed). */
  readonly messages: Message[];
  /** How many decided calls were replayed through the gates. */
  readonly replayed: number;
}

/** Outcome of {@link ToolLifecycle.executeRound}. */
export type ToolRoundOutcome =
  | {
      readonly kind: "completed";
      readonly results: readonly ToolResultEntry[];
      /** History with the tool round appended via the appendToolRound strategy. */
      readonly messages: Message[];
    }
  | {
      readonly kind: "suspended";
      /** First call that required approval. */
      readonly request: ApprovalRequestInfo;
      /** Siblings settled before suspension — already executed, side effects included. */
      readonly settled: readonly ToolResultEntry[];
      /**
       * History with the approval-request message appended, followed by one
       * tool message per settled sibling (their side effects happened — the
       * model must hear about them, and their presence keeps `resume()`
       * from replaying them). Persist as-is.
       */
      readonly messages: Message[];
    };

/** A skill amendment reported by {@link ToolLifecycle.applySkillLoads}. */
export interface SkillAmendment {
  /** Replacement standalone system; absent when active history receives a patch. */
  readonly system?: string;
  /** Fresh system blocks when their text still matches the replacement system. */
  readonly systemBlocks?: readonly SystemBlock[];
  /** Always `true` — `LoadSkill` never consumes loop budget. */
  readonly refundStep: true;
  /** @internal One-shot active-history amendment for the loop owner. */
  readonly [systemMessagePrefixPatch]?: SystemMessagePrefixPatch;
}

/** A sealed SDK suspension from {@link ToolLifecycle.suspend}. */
export interface SuspendedRound {
  /** History ending in the approval-request message(s) — persist as-is. */
  readonly messages: Message[];
  /** The minted approval requests, one per pending call. */
  readonly requests: readonly ApprovalRequestInfo[];
}

/**
 * Machine-readable protocol trace for the dialect parity suite: both
 * dialects must produce identical event sequences for the same inputs.
 * (`round` events are core-regime only — the SDK owns round boundaries in
 * the push regime, so `executeRound()` is what emits them.)
 */
export type ToolProtocolEvent =
  | {
      readonly t: "prepare";
      readonly tools: number;
      readonly middleware: number;
    }
  | { readonly t: "decision.notify"; readonly decisions: number }
  | { readonly t: "resume"; readonly replayed: number }
  | {
      readonly t: "gate";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly verdict: "execute" | "denied" | "suspend" | "not-found";
      readonly origin: "live" | "replay";
    }
  | {
      readonly t: "approval.policy";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly policy: "always" | "never" | "function";
      readonly result: "approve" | "suspend";
      readonly layer?: "call" | "prompt" | "context";
      readonly key?: string;
      readonly owner?: string;
    }
  | {
      readonly t: "execute.settle";
      readonly toolCallId: string;
      readonly outcome: "ok" | "error";
    }
  | {
      readonly t: "suspend.mint";
      readonly toolCallId: string;
      readonly approvalId: string;
    }
  | { readonly t: "skill.load"; readonly skillId: string }
  | {
      readonly t: "round";
      readonly settled: number;
      readonly suspended: number;
    }
  | { readonly t: "memory.capture"; readonly bindings: number };

/**
 * A per-call tool-lifecycle session. Create with {@link createToolLifecycle}.
 */
export interface ToolLifecycle {
  /** False when no tools apply — all methods become no-op passthroughs. */
  readonly enabled: boolean;

  /**
   * SDK regime: the merged → middleware-wrapped → instrumented tool map to
   * hand to the SDK. Rebuilt (and approval-middleware re-notified) after a
   * skill amendment. `undefined` in the core regime or when no tools apply.
   */
  readonly tools: Record<string, unknown> | undefined;

  /**
   * SDK regime: the compiled wire schema for each tool whose authored schema
   * core owns and validates, keyed by tool name. The loop runtime installs
   * these as the SDK's tool `inputSchema` so the SDK never runs the authored
   * validator. `undefined` when no such tool applies.
   */
  readonly toolWireSchemas: Record<string, JsonSchemaObject> | undefined;

  /**
   * Canonical, schema-sanitized descriptors for request planning and Core-owned
   * provider calls. Always current — re-read after each round instead of
   * keeping a dialect-local copy.
   */
  readonly descriptors: readonly ToolDescriptor[] | undefined;

  /** Rebuild prompt-owned tools after request representation selection. @internal */
  rearm(resolved: ResolvedPrompt): Promise<void>;

  /**
   * Evaluate the current provider-visible tool set before transport.
   *
   * The first call evaluates every winning definition. Later calls after skill
   * activation reuse unchanged descriptor/provenance fingerprints and evaluate
   * only new or changed definitions.
   *
   * @internal
   */
  guardExposure(guards: ToolExposureGuards): Promise<void>;

  /**
   * SDK regime: evaluate the effective approval policy for one tool call.
   * Core regime uses the same logic inside `executeRound()`.
   */
  requiresApproval(
    toolCall: {
      readonly id: string;
      readonly name: string;
      readonly args: unknown;
    },
    messages: readonly Message[],
  ): Promise<boolean>;

  /**
   * Fire approvalMiddleware `onApproved`/`onDenied` callbacks for decisions
   * found in history, exactly once. Stream paths call this alone; generate
   * paths get it implicitly via `resume()`.
   */
  notifyDecisions(messages: readonly Message[] | undefined): Promise<void>;

  /**
   * Resume protocol — once before the first provider call. Finds approval
   * requests whose decision arrived but whose tool result does not exist,
   * verifies tokens (emitting the token-mismatch observation before
   * throwing), replays approved calls through replay-origin gates, settles
   * denied calls as execution-denied outputs, and returns history with the
   * synthetic tool round appended. Idempotent over the same history.
   */
  resume(messages: readonly Message[]): Promise<ToolResumeOutcome>;

  /**
   * Core regime only — one full round for the calls the dialect extracted:
   * per call, middleware → approval gate → span wrap → execute → normalize.
   * Suspension is a value, not a throw: stops at the first undecided
   * approval policy and returns the minted request + suspension message.
   * @throws in the `'sdk'` regime (the SDK owns the loop — RFC #28).
   */
  executeRound(
    response: AdapterResponse,
    messages: readonly Message[],
  ): Promise<ToolRoundOutcome>;

  /**
   * Skill-load side effect, shared verbatim by both regimes: detect
   * `LoadSkill` calls, emit `onSkillLoad`/`onSkillResolve`, invoke the
   * dialect's `reresolve` closure, append skill instructions to the system
   * prompt, re-arm the tool map, and report the amendment (`refundStep`
   * always true — `LoadSkill` never consumes loop budget). `undefined` on
   * the common path.
   */
  applySkillLoads(
    toolCalls: ReadonlyArray<{ readonly name: string; readonly args: unknown }>,
  ): Promise<SkillAmendment | undefined>;

  /**
   * SDK regime: seal an SDK-reported suspension — mint approval ids and
   * anti-forgery tokens, append one approval-request message per pending
   * call, emit request observations and `onToolApprovalRequest` hooks.
   */
  suspend(
    pending: ReadonlyArray<{
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: JsonValue;
    }>,
    assistantResponse: AdapterResponse,
    messages: readonly Message[],
  ): SuspendedRound;

  /**
   * Post-generation memory capture: fan the completed turn into every
   * memory binding, then flush. At-most-once per session — safe to call
   * from both a stream's completion and consumption paths without the
   * dialect keeping a `memoryCaptured` flag. No-op without bindings.
   */
  captureTurn(args: {
    readonly messages: readonly Message[];
    readonly assistantText?: string;
    readonly toolCalls?: ReadonlyArray<{
      readonly id?: string;
      readonly name: string;
      readonly args: unknown;
    }>;
  }): Promise<void>;

  /** Protocol transcript — see {@link ToolProtocolEvent}. */
  readonly transcript: readonly ToolProtocolEvent[];
}

/**
 * Structural shape of a (middleware-wrapped) tool as the kernel consumes
 * it. Tool objects are heavily generic in SDK land; the kernel only needs
 * these three members, so structural typing is sufficient.
 */
interface SessionToolShape {
  readonly execute?: (
    input: unknown,
    options: ToolLifecycleExecutionOptions,
  ) => unknown;
  readonly toModelOutput?: (args: {
    toolCallId: string;
    input: Record<string, unknown>;
    output: unknown;
  }) => ToolModelOutput | Promise<ToolModelOutput>;
}

/**
 * The private verdict kernel: `gate()` returns a capability-carrying
 * verdict — the variant IS the only legal continuation, so per-call
 * mis-ordering is unrepresentable. NOT exported: exposing it would let
 * callers bypass `executeRound()`/`resume()` and recreate the old
 * hand-orchestration.
 */
type ToolGateVerdict =
  | { readonly kind: "execute"; readonly run: () => Promise<ToolResultEntry> }
  | { readonly kind: "denied"; readonly settled: ToolResultEntry }
  | { readonly kind: "suspend"; readonly request: ApprovalRequestInfo }
  | { readonly kind: "not-found"; readonly settled: ToolResultEntry }
  | { readonly kind: "decode-error"; readonly settled: ToolResultEntry };

interface SessionToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

interface SdkAttemptedToolCall {
  readonly inputIdentity: string;
  readonly span: ReturnType<typeof openToolCallSpan>;
  readonly toolName: string;
}

const MAX_PENDING_SDK_ATTEMPTS = 1000;

// ─────────────────────────────────────────────────────────────────
// createToolLifecycle
// ─────────────────────────────────────────────────────────────────

/**
 * Create the per-call tool-lifecycle session.
 *
 * Reads runtime instrumentation hooks once at creation and snapshots them,
 * so a mid-call `setHooks()` cannot half-instrument a run.
 */
export function createToolLifecycle(
  options: ToolLifecycleOptions,
): ToolLifecycle {
  const transcript: ToolProtocolEvent[] = [];

  // ── Preparation: merge precedence + middleware chain order ──────
  let wrappedTools: Record<string, unknown> = {};
  let armedTools: Record<string, unknown> | undefined;
  const armedToolWireSchemas: Record<string, JsonSchemaObject> | undefined =
    options.regime === "sdk" ? {} : undefined;
  let descriptors: ToolDescriptor[] | undefined;
  let exposedDescriptors: readonly ToolDescriptor[] = [];
  let armedDescriptors: readonly ToolDescriptor[] = [];
  let dormantSdkOffloadSupport: ToolDescriptor | undefined;
  let exposureCandidates: Array<{
    readonly descriptor: ToolDescriptor;
    readonly provenance: ReturnType<typeof readToolExposureProvenance>;
  }> = [];
  let exposureGuards: ToolExposureGuards | undefined;
  let enabled = false;
  let middlewareCount = 0;
  let preserveArmedIdentity = false;
  const capabilityResolution: ToolInputCapabilitiesResolution =
    options.toolInputCapabilities ??
    (options.structuredOutputCapabilities
      ? { kind: "verified", capabilities: options.structuredOutputCapabilities }
      : { kind: "default" });
  // Per-tool compiled input plans (wire schema + decode manifest + Zod), rebuilt
  // on every arm() alongside the tool registry.
  const toolInputPlans = new Map<string, ToolInputPlan>();
  const exposureEvaluator = createToolExposureEvaluator();
  let skillSession: SkillActivationSession | undefined;
  let approvalDeclarations: readonly ApprovalDeclaration[] = [];
  let toolContexts: ResolvedToolsContext = {};
  const pendingApprovalRequirements = new Map<
    string,
    ToolApprovalRequirement
  >();
  const sdkAttempts = new Map<string, SdkAttemptedToolCall>();
  let currentResolved = options.resolved;
  let forcedOffloadSupport = false;

  function activateForcedOffloadSupport(): void {
    if (forcedOffloadSupport) return;
    forcedOffloadSupport = true;
    arm(currentResolved);
  }

  function arm(resolved: ResolvedPrompt): void {
    currentResolved = resolved;
    skillSession = readSkillActivationSession(resolved);
    // Recomputed per arm: a re-resolved prompt (skill load) can contribute
    // a different middleware chain, and rebuilt tools must wear it.
    const middlewareChain = normalizeMiddlewareChain(
      resolved.toolMiddleware,
      options.call?.toolMiddleware,
    );
    const middleware = middlewareChain.length > 0 ? middlewareChain : undefined;
    middlewareCount = middlewareChain.length;
    const callTools = inheritMockSourceProvenance(
      resolved.tools,
      options.call?.tools,
    );
    const baseTools = createToolRegistry(resolved.tools, callTools);
    const includeDormantSupport =
      options.regime === "sdk" &&
      Object.keys(baseTools).length > 0 &&
      !(OFFLOAD_SUPPORT_TOOL_NAME in baseTools) &&
      !forcedOffloadSupport;
    const merged =
      (forcedOffloadSupport || includeDormantSupport) &&
      !(OFFLOAD_SUPPORT_TOOL_NAME in baseTools)
        ? createToolRegistry(baseTools, offloadSupportTools())
        : baseTools;
    // Resolve the profile that lowers tool input schemas. An unverified model
    // (resolver present, semantics unknown) with any authored tool schema fails
    // before provider I/O rather than silently receiving permissive lowering.
    if (
      capabilityResolution.kind === "unverified" &&
      registryHasAuthoredToolSchema(baseTools)
    ) {
      throw new CruxUnsupportedStructuredOutputError(
        capabilityResolution.providerId,
        `the selected model "${
          capabilityResolution.modelId || "unknown"
        }" has no verified structured-output capability profile for tool schemas`,
      );
    }
    const toolCapabilities =
      capabilityResolution.kind === "verified"
        ? capabilityResolution.capabilities
        : DEFAULT_TOOL_INPUT_CAPABILITIES;
    // Compile each tool's input schema and wrap the authored execute with a
    // authored `safeParse` boundary, then middleware, then the outer decode
    // boundary — so the execution order is: wire args → decode → middleware over
    // canonical z.input → authored safeParse exactly once → execute(safeParse.data).
    const prepared = prepareToolInputPlans(
      withToolOutputOffloadPolicies(
        merged,
        activateForcedOffloadSupport,
      ),
      toolCapabilities,
      toolInputPlans,
    );
    wrappedTools = withToolInputDecode(
      applyToolMiddleware(prepared, middleware),
      toolInputPlans,
    );
    toolContexts = resolveToolsContext(
      wrappedTools,
      options.call?.toolsContext,
    );
    approvalDeclarations = [
      ...(resolved.toolApprovalDeclarations ?? []),
      ...callApprovalDeclarations(options.call?.toolApproval),
    ];
    const canonical =
      convertTools(
        wrappedTools,
        toolInputPlans,
        options.regime === "core" ? options.sanitizeToolSchema : undefined,
      ) ?? [];
    dormantSdkOffloadSupport = includeDormantSupport
      ? canonical.find(
          (descriptor) =>
            descriptor.name === OFFLOAD_SUPPORT_TOOL_NAME,
        )
      : undefined;
    const exposedCanonical = dormantSdkOffloadSupport
      ? canonical.filter(
          (descriptor) =>
            descriptor.name !== OFFLOAD_SUPPORT_TOOL_NAME,
        )
      : canonical;
    exposureCandidates = exposedCanonical.map((descriptor) => ({
      descriptor,
      provenance: readToolExposureProvenance(wrappedTools[descriptor.name]),
    }));
    applyExposedDescriptors(exposedCanonical);
  }

  arm(options.resolved);

  transcript.push({
    t: "prepare",
    tools: Object.keys(wrappedTools).length,
    middleware: middlewareCount,
  });

  let memoryCaptured = false;
  let lastMessages: readonly Message[] | undefined;
  const settledToolResults = new Map<string, ToolResultEntry>();
  const announcedSkills = new Set<string>();

  // Snapshot runtime hooks once — a mid-call setHooks() cannot
  // half-instrument this run (same rule as createSafety).
  const now = options.now ?? (() => Date.now());
  const mintToken = options.createApprovalToken ?? defaultCreateApprovalToken;
  const appendRound: AppendToolRound =
    options.appendToolRound ?? canonicalAppendToolRound;

  function applyExposedDescriptors(
    exposed: readonly ToolDescriptor[],
  ): void {
    exposedDescriptors = exposed;
    armedDescriptors =
      dormantSdkOffloadSupport && exposed.length > 0
      ? [...exposed, dormantSdkOffloadSupport]
      : exposed;
    const retained = new Set(
      armedDescriptors.map((descriptor) => descriptor.name),
    );
    wrappedTools = createToolRegistry(
      Object.fromEntries(
        Object.entries(wrappedTools).filter(([name]) => retained.has(name)),
      ),
    );
    for (const name of [...toolInputPlans.keys()]) {
      if (!retained.has(name)) toolInputPlans.delete(name);
    }
    if (armedToolWireSchemas) {
      for (const name of Object.keys(armedToolWireSchemas)) {
        delete armedToolWireSchemas[name];
      }
      const exposedByName = new Map(
        armedDescriptors.map((descriptor) => [descriptor.name, descriptor]),
      );
      for (const [name, plan] of toolInputPlans) {
        if (!plan.hasAuthoredSchema) continue;
        const descriptor = exposedByName.get(name);
        if (descriptor) armedToolWireSchemas[name] = descriptor.parameters;
      }
    }
    enabled = retained.size > 0;

    if (options.regime === "core") {
      descriptors = exposed.length > 0 ? [...exposed] : undefined;
      armedTools = undefined;
      return;
    }

    descriptors = exposed.length > 0 ? [...exposed] : undefined;
    const exposedTools = createToolRegistry<unknown>();
    for (const descriptor of armedDescriptors) {
      const tool = wrappedTools[descriptor.name];
      exposedTools[descriptor.name] =
        tool && typeof tool === "object"
          ? { ...tool, description: descriptor.description }
          : tool;
    }
    if (Object.keys(exposedTools).length === 0) {
      if (preserveArmedIdentity && armedTools) {
        for (const name of Object.keys(armedTools)) delete armedTools[name];
      } else {
        armedTools = undefined;
      }
      return;
    }

    let executable = withToolLifecycleExecutionOptions(
      exposedTools,
      executionOptionsForSdkTool,
    );
    if (options.modelIngress) {
      if (!options.sdkModelIngress) {
        throw new Error(
          "The loop runtime cannot guard native tool model output because it does not provide a model-ingress dialect hook.",
        );
      }
      const guard = options.abortSignal
        ? (input: Parameters<ModelIngressGuard>[0]) =>
            withAbortSignal(
              () => options.modelIngress!(input),
              options.abortSignal,
            )
        : options.modelIngress;
      executable = options.sdkModelIngress(executable, guard, {
        provider: options.modelIngressProvider,
      });
    }
    const nextArmedTools = instrumentToolSet(executable, {
      takeAttemptedSpan: consumeSdkAttempt,
    });
    if (armedTools) {
      for (const name of Object.keys(armedTools)) delete armedTools[name];
      Object.assign(armedTools, nextArmedTools);
    } else {
      armedTools = nextArmedTools;
    }
  }

  const currentTraceId = (): string | undefined =>
    getExecutionContext()?.traceId ?? observe.captureContext()?.traceId;

  function rememberSdkAttempt(
    toolCall: SessionToolCall,
    tool: SessionToolShape,
  ): SdkAttemptedToolCall {
    const inputIdentity = sdkAttemptInputIdentity(toolCall.args);
    const existing = sdkAttempts.get(toolCall.id);
    if (
      existing?.toolName === toolCall.name &&
      existing.inputIdentity === inputIdentity
    ) {
      return existing;
    }
    if (existing) {
      endAbandonedSdkAttempt(existing, "sdk_attempt_replaced");
      sdkAttempts.delete(toolCall.id);
    }
    const attempted = {
      inputIdentity,
      span: openAttemptedToolCall(toolCall, tool),
      toolName: toolCall.name,
    } satisfies SdkAttemptedToolCall;
    sdkAttempts.set(toolCall.id, attempted);
    if (sdkAttempts.size > MAX_PENDING_SDK_ATTEMPTS) {
      const oldestId = sdkAttempts.keys().next().value;
      if (oldestId !== undefined) {
        const oldest = sdkAttempts.get(oldestId);
        if (oldest) {
          endAbandonedSdkAttempt(oldest, "sdk_attempt_capacity");
        }
        sdkAttempts.delete(oldestId);
      }
    }
    return attempted;
  }

  function consumeSdkAttempt(
    toolName: string,
    toolCallId: string,
    input: unknown,
  ): ReturnType<typeof openToolCallSpan> | undefined {
    const attempted = sdkAttempts.get(toolCallId);
    if (
      !attempted ||
      attempted.toolName !== toolName ||
      attempted.inputIdentity !== sdkAttemptInputIdentity(input)
    ) {
      return undefined;
    }
    sdkAttempts.delete(toolCallId);
    return attempted.span;
  }

  function finalizeSdkAttempts(): void {
    for (const attempted of sdkAttempts.values()) {
      endAbandonedSdkAttempt(attempted, "sdk_attempt_unconsumed");
    }
    sdkAttempts.clear();
  }

  function endAbandonedSdkAttempt(
    attempted: SdkAttemptedToolCall,
    reason: string,
  ): void {
    attempted.span.end({
      status: "skipped",
      attributes: { isError: false, reason },
    });
  }

  function sdkAttemptInputIdentity(input: unknown): string {
    return JSON.stringify(toJsonValue(input));
  }

  function executionOptionsFor(
    toolCall: SessionToolCall,
    messages: readonly Message[],
  ): ToolLifecycleExecutionOptions {
    const base = {
      toolCallId: toolCall.id,
      messages,
      runtimeContext: options.call?.runtimeContext,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    };
    return Object.prototype.hasOwnProperty.call(toolContexts, toolCall.name)
      ? { ...base, context: toolContexts[toolCall.name] }
      : base;
  }

  function executionOptionsForSdkTool(
    toolName: string,
    rawOptions: PartialToolLifecycleExecutionOptions | undefined,
  ): ToolLifecycleExecutionOptions {
    const base = {
      ...(rawOptions ?? {}),
      toolCallId: rawOptions?.toolCallId ?? `tc_${now()}`,
      runtimeContext: options.call?.runtimeContext,
    };
    return Object.prototype.hasOwnProperty.call(toolContexts, toolName)
      ? { ...base, context: toolContexts[toolName] }
      : base;
  }

  // ── The kernel: gate → execute → settle ─────────────────────────

  function guardCanonicalToolOutput(
    output: ToolModelOutput,
    toolName: string,
    toolCallId: string,
  ): Promise<ToolModelOutput> {
    return withAbortSignal(
      () =>
        guardToolModelOutput({
          output,
          toolName,
          toolCallId,
          guard: options.modelIngress,
        }),
      options.abortSignal,
    );
  }

  async function settleNotFound(
    toolCall: SessionToolCall,
    traceId: string | undefined,
  ): Promise<ToolResultEntry> {
    const startedAt = now();
    const span = openToolCallSpan(toolCall.name, toolCall.id, toolCall.args);
    const convertedModelOutput: ToolModelOutput = {
      type: "error-json",
      value: { error: `Tool "${toolCall.name}" not found` },
    };
    const modelOutput = await span.withContext(() =>
      guardCanonicalToolOutput(
        convertedModelOutput,
        toolCall.name,
        toolCall.id,
      ),
    );
    const modelOutputSize = measureModelOutput(modelOutput);
    span.withContext(() => {
      emitToolCallArgsArtifact(
        span.spanId,
        toolCall.name,
        toolCall.id,
        toolCall.args,
      );
      emitToolResultArtifact(
        span.spanId,
        toolCall.name,
        toolCall.id,
        modelOutput,
        {
          resultKind: "model",
          modelOutputType: modelOutput.type,
          modelOutputSize,
          isError: true,
          errorKind: "tool_not_found",
        },
      );
    });
    span.error(new Error(`Tool "${toolCall.name}" not found`), {
      isError: true,
      phase: "tool.lookup",
      errorKind: "tool_not_found",
      outputSize: 0,
      modelOutputSize,
    });
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      modelOutput,
      content: renderToolModelOutput(modelOutput),
      outputSize: 0,
      modelOutputSize,
      modelOutputError: `Tool "${toolCall.name}" not found`,
      isError: true,
    };
  }

  /**
   * Decode a tool call's wire arguments to canonical z.input against its exact
   * plan. Fails closed: a decode error is returned as a value so the caller can
   * settle it before any policy, middleware, validation, or execution runs.
   */
  function decodeToolCallArgs(
    toolCall: SessionToolCall,
  ):
    | { readonly ok: true; readonly args: unknown }
    | { readonly ok: false; readonly error: CruxStructuredOutputDecodeError } {
    const plan = toolInputPlans.get(toolCall.name);
    if (!plan || plan.manifest.operations.length === 0) {
      return { ok: true, args: toolCall.args };
    }
    try {
      return { ok: true, args: decodeToolArgs(toolCall.args, plan) };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof CruxStructuredOutputDecodeError
            ? error
            : new CruxStructuredOutputDecodeError(
                [],
                error instanceof Error ? error.message : String(error),
              ),
      };
    }
  }

  /** Settle a decode failure as a sanitized, model-visible tool error. */
  async function settleDecodeError(
    toolCall: SessionToolCall,
    error: CruxStructuredOutputDecodeError,
    traceId: string | undefined,
  ): Promise<ToolResultEntry> {
    void traceId;
    const span = openToolCallSpan(toolCall.name, toolCall.id, toolCall.args);
    // The error message is already sanitized (path + reason, never raw args).
    const convertedModelOutput: ToolModelOutput = {
      type: "error-json",
      value: { error: error.message },
    };
    const modelOutput = await span.withContext(() =>
      guardCanonicalToolOutput(
        convertedModelOutput,
        toolCall.name,
        toolCall.id,
      ),
    );
    const modelOutputSize = measureModelOutput(modelOutput);
    span.withContext(() => {
      emitToolResultArtifact(
        span.spanId,
        toolCall.name,
        toolCall.id,
        modelOutput,
        {
          resultKind: "model",
          modelOutputType: modelOutput.type,
          modelOutputSize,
          isError: true,
          errorKind: "tool_input_decode",
        },
      );
    });
    span.error(error, {
      isError: true,
      phase: "tool.decode",
      errorKind: "tool_input_decode",
      outputSize: 0,
      modelOutputSize,
    });
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      modelOutput,
      content: renderToolModelOutput(modelOutput),
      outputSize: 0,
      modelOutputSize,
      modelOutputError: error.message,
      isError: true,
    };
  }

  async function settleInvalidApproval(toolCall: {
    readonly id: string;
    readonly name: string;
    readonly args: unknown;
    readonly approvalId: string;
    readonly message: string;
  }): Promise<ToolResultEntry> {
    const convertedModelOutput: ToolModelOutput = {
      type: "error-json",
      value: {
        status: "error",
        reason: "approval-invalid",
        message: toolCall.message,
      },
    };
    const modelOutput = await guardCanonicalToolOutput(
      convertedModelOutput,
      toolCall.name,
      toolCall.id,
    );
    const modelOutputSize = measureModelOutput(modelOutput);
    emitToolApprovalObservation("token-mismatch", {
      approvalId: toolCall.approvalId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.args,
      modelOutput,
      modelOutputSize,
      error: new Error(toolCall.message),
    });
    transcript.push({
      t: "gate",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      verdict: "denied",
      origin: "replay",
    });
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      modelOutput,
      content: renderToolModelOutput(modelOutput),
      outputSize: 0,
      modelOutputSize,
      modelOutputError: toolCall.message,
      isError: true,
    };
  }

  function rememberToolResults(results: readonly ToolResultEntry[]): void {
    for (const result of results) {
      settledToolResults.set(result.toolCallId, result);
    }
  }

  async function runTool(
    toolCall: SessionToolCall,
    tool: SessionToolShape,
    messages: readonly Message[],
    traceId: string | undefined,
    attemptedSpan?: ReturnType<typeof openToolCallSpan>,
  ): Promise<ToolResultEntry> {
    return runToolScope(toolCall.name, async () => {
      const startedAt = now();
      const provenance = toolCallProvenance(tool);
      const span =
        attemptedSpan ??
        openToolCallSpan(
          toolCall.name,
          toolCall.id,
          toolCall.args,
          provenance?.definitionRefs,
          provenance,
        );
      try {
        if (attemptedSpan === undefined) {
          emitAttemptedToolCallIntent(span, toolCall);
        }
        const execute = tool.execute ?? (() => undefined);
        const toolOptions = executionOptionsFor(toolCall, messages);
        const result = await span.withContext(() =>
          withBudget(
            () => Promise.resolve(execute(toolCall.args, toolOptions)),
            {
              budget: "tool",
              limitMs: toolBudgetMs(options.timeout, toolCall.name),
              toolName: toolCall.name,
            },
          ),
        );
        const convertedModelOutput = await span.withContext(() =>
          createToolModelOutput({
            tool,
            toolCallId: toolCall.id,
            input: normalizeToolInput(toolCall.args),
            output: result,
          }),
        );
        const modelOutput = await span.withContext(() =>
          guardCanonicalToolOutput(
            convertedModelOutput,
            toolCall.name,
            toolCall.id,
          ),
        );
        const canonicalOutput = canonicalToolOutput(result);
        const outputSize = measureUnknown(canonicalOutput);
        const modelOutputSize = measureModelOutput(modelOutput);
        const offloadReceipt =
          toolOutputOffloadReceipt(convertedModelOutput);
        const content = renderToolModelOutput(modelOutput);
        span.withContext(() => {
          emitToolResultArtifact(
            span.spanId,
            toolCall.name,
            toolCall.id,
            canonicalOutput,
            {
              resultKind: "raw",
              outputSize,
              isError: false,
            },
            sourceResultPreview(provenance, canonicalOutput),
          );
          emitToolResultArtifact(
            span.spanId,
            toolCall.name,
            toolCall.id,
            modelOutput,
            {
              resultKind: "model",
              modelOutputType: modelOutput.type,
              modelOutputSize,
              tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
              isError: false,
            },
            sourceResultPreview(provenance, modelOutput),
          );
        });
        span.end({
          attributes: {
            isError: false,
            outputSize,
            modelOutputSize,
            modelOutputType: modelOutput.type,
            tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
          },
        });
        transcript.push({
          t: "execute.settle",
          toolCallId: toolCall.id,
          outcome: "ok",
        });
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          output: canonicalOutput,
          modelOutput,
          content,
          outputSize,
          modelOutputSize,
          ...(offloadReceipt ? { offloadReceipt } : {}),
        };
      } catch (err) {
        if (options.abortSignal?.aborted) {
          throw options.abortSignal.reason ?? err;
        }
        if (err instanceof Error && err.name === "AbortError") throw err;
        if (isPolicyTerminal(err)) throw err;
        if (TimeoutError.isInstance(err)) {
          span.error(err, {
            ...provenance?.errorAttributes,
            isError: true,
            phase: "tool.execute",
            errorKind: "timeout",
          });
          throw err;
        }
        // Tool-input decode/validation failures settle as a distinct,
        // model-visible tool error (never re-thrown, never failing the whole
        // generation). Their messages are already sanitized (no raw arguments).
        const errorKind =
          err instanceof CruxToolInputValidationError
            ? "tool_input_validation"
            : err instanceof CruxStructuredOutputDecodeError
              ? "tool_input_decode"
              : "execute_error";
        const convertedModelOutput: ToolModelOutput = {
          type: "error-json",
          value: { error: err instanceof Error ? err.message : String(err) },
        };
        const modelOutput = await span.withContext(() =>
          guardCanonicalToolOutput(
            convertedModelOutput,
            toolCall.name,
            toolCall.id,
          ),
        );
        const modelOutputSize = measureModelOutput(modelOutput);
        span.withContext(() => {
          emitToolResultArtifact(
            span.spanId,
            toolCall.name,
            toolCall.id,
            modelOutput,
            {
              resultKind: "model",
              modelOutputType: modelOutput.type,
              modelOutputSize,
              tokenSavingsEstimate: 0,
              isError: true,
              errorKind,
            },
            sourceResultPreview(provenance, modelOutput),
          );
        });
        span.error(err, {
          ...provenance?.errorAttributes,
          isError: true,
          phase: "tool.execute",
          errorKind,
          outputSize: 0,
          modelOutputSize,
          modelOutputType: modelOutput.type,
          tokenSavingsEstimate: 0,
        });
        transcript.push({
          t: "execute.settle",
          toolCallId: toolCall.id,
          outcome: "error",
        });
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          modelOutput,
          content: renderToolModelOutput(modelOutput),
          outputSize: 0,
          modelOutputSize,
          modelOutputError: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    });
  }

  function openAttemptedToolCall(
    toolCall: SessionToolCall,
    tool: SessionToolShape,
  ): ReturnType<typeof openToolCallSpan> {
    const provenance = toolCallProvenance(tool);
    const span = openToolCallSpan(
      toolCall.name,
      toolCall.id,
      toolCall.args,
      provenance?.definitionRefs,
      provenance,
    );
    emitAttemptedToolCallIntent(span, toolCall);
    return span;
  }

  function emitAttemptedToolCallIntent(
    span: ReturnType<typeof openToolCallSpan>,
    toolCall: SessionToolCall,
  ): void {
    span.withContext(() =>
      emitToolCallArgsArtifact(
        span.spanId,
        toolCall.name,
        toolCall.id,
        toolCall.args,
      ),
    );
  }

  async function approvalRequirement(
    toolCall: SessionToolCall,
    messages: readonly Message[],
    notifyRequest = true,
  ): Promise<ToolApprovalRequirement> {
    const tool = wrappedTools[toolCall.name];
    return requiresToolApproval({
      tool,
      toolCall,
      messages,
      runtimeContext: options.call?.runtimeContext,
      toolContext: toolContexts[toolCall.name],
      declarations: approvalDeclarations,
      onPolicyTrace: (trace) =>
        transcript.push({ t: "approval.policy", ...trace }),
      notifyRequest,
    });
  }

  function approvalRequest(
    toolCall: Pick<SessionToolCall, "id" | "name" | "args">,
    requirement: ToolApprovalRequirement,
    prepared?: Readonly<{
      approvalId: string;
      approvalToken: string;
      lifecycle?: CommittedApprovalReplayLifecycle;
    }>,
  ): ApprovalRequestInfo {
    const approvalId = prepared?.approvalId ?? createApprovalId(toolCall.id);
    const input = toJsonValue(toolCall.args);
    const approvalToken = prepared?.approvalToken ?? mintToken();
    const toolIdentity = toolSourceReplayIdentity(wrappedTools[toolCall.name]);
    return {
      approvalId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input,
      approvalToken,
      ...(toolIdentity !== undefined
        ? {
            replay: prepared?.lifecycle
              ? createCommittedApprovalReplayProvenance(
                  {
                    approvalId,
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    input,
                  },
                  approvalToken,
                  toolIdentity,
                  requirement.policies,
                  prepared.lifecycle,
                )
              : createApprovalReplayProvenance(
                  {
                    approvalId,
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    input,
                  },
                  approvalToken,
                  toolIdentity,
                  requirement.policies,
                ),
          }
        : {}),
    };
  }

  /**
   * The per-call verdict gate. Order is part of the protocol: the history
   * decision (and its token check) comes BEFORE approval policy, so a
   * token mismatch throws even for tools that no longer require approval.
   */
  async function gate(
    toolCall: SessionToolCall,
    messages: readonly Message[],
    origin: "live" | "replay",
  ): Promise<ToolGateVerdict> {
    // Decode transport sentinels to canonical z.input so the gate, approval, and
    // middleware operate on canonical input. Fails closed: a decode error settles
    // as a model-visible decode error here, before any approval policy, history
    // decision, middleware, validation, or execution runs.
    const traceId = currentTraceId();
    const decode = decodeToolCallArgs(toolCall);
    if (!decode.ok) {
      return {
        kind: "decode-error",
        settled: await settleDecodeError(toolCall, decode.error, traceId),
      };
    }
    if (decode.args !== toolCall.args) {
      toolCall = { ...toolCall, args: decode.args };
    }
    const approvalId = createApprovalId(toolCall.id);
    const request = findToolApprovalRequests(messages).find(
      (candidate) => candidate.approvalId === approvalId,
    );
    let decision: ReturnType<typeof findValidApprovalDecision>;
    try {
      decision = findValidApprovalDecision(messages, request);
    } catch (error) {
      emitToolApprovalObservation("token-mismatch", {
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
        error,
      });
      throw error;
    }
    if (
      decision &&
      request?.replay &&
      !verifyApprovalReplayCommitment(
        {
          approvalId: request.approvalId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          input: toJsonValue(request.input),
        },
        request.approvalToken ?? "",
        request.replay,
      )
    ) {
      return await changedApprovalVerdict(toolCall, approvalId);
    }
    const tool = wrappedTools[toolCall.name];
    if (!tool || typeof tool !== "object") {
      if (decision && request?.replay) {
        return await changedApprovalVerdict(toolCall, approvalId);
      }
      transcript.push({
        t: "gate",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        verdict: "not-found",
        origin,
      });
      return {
        kind: "not-found",
        settled: await settleNotFound(toolCall, traceId),
      };
    }
    const shaped = tool as SessionToolShape;

    if (decision) {
      if (request?.replay) {
        const currentRequirement = await approvalRequirement(
          toolCall,
          messages,
          false,
        );
        if (
          !matchesApprovalReplayIdentity(
            request.replay,
            toolSourceReplayIdentity(tool),
            currentRequirement.policies,
          )
        ) {
          return await changedApprovalVerdict(toolCall, approvalId);
        }
      }
      const committedReplay =
        request?.replay?.version === 2 ? request.replay : undefined;
      if (!decision.approved) {
        const modelOutput = deniedToolModelOutput(decision.reason);
        const modelOutputSize = measureModelOutput(modelOutput);
        emitToolApprovalDecisionAuthority({
          approvalId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.args,
          ...(committedReplay ? { replay: committedReplay } : {}),
          status: "denied",
          reason: decision.reason,
          modelOutput,
          modelOutputSize,
        });
        transcript.push({
          t: "gate",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          verdict: "denied",
          origin,
        });
        return {
          kind: "denied",
          settled: {
            toolCallId: toolCall.id,
            name: toolCall.name,
            modelOutput,
            content: renderToolModelOutput(modelOutput),
            outputSize: 0,
            modelOutputSize,
            modelOutputError: decision.reason ?? "Tool execution was denied.",
            isError: true,
          },
        };
      }
      const decisionEvidence = emitToolApprovalDecisionAuthority({
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
        ...(committedReplay ? { replay: committedReplay } : {}),
        status: "approved",
      });
      const executionSpan = openAttemptedToolCall(toolCall, shaped);
      if (committedReplay) {
        executionSpan.withContext(() =>
          observe.edge({
            edgeType: "triggered",
            from: {
              kind: "span",
              id: committedReplay.attempt.spanId,
            },
            to: { kind: "span", id: executionSpan.spanId },
          }),
        );
      }
      if (decisionEvidence) {
        executionSpan.withContext(() =>
          recordResumedToolApprovalAuthority(
            decisionEvidence,
            executionSpan.spanId,
          ),
        );
      }
      transcript.push({
        t: "gate",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        verdict: "execute",
        origin,
      });
      return {
        kind: "execute",
        run: () =>
          runTool(
            toolCall,
            shaped,
            messages,
            traceId,
            executionSpan,
          ),
      };
    }

    const attemptedSpan = openAttemptedToolCall(toolCall, shaped);
    const requirement = await approvalRequirement(toolCall, messages);
    if (requirement.requiresApproval) {
      const approvalToken = mintToken();
      const preparedLifecycle = attemptedSpan.withContext(() =>
        emitToolApprovalRequestAuthority({
          approvalId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.args,
          attempt: attemptedSpan,
          ...(requirement.observeRequest
            ? { observePolicyDecision: requirement.observeRequest }
            : {}),
        }),
      );
      if (preparedLifecycle instanceof Promise) {
        throw new TypeError(
          "Tool approval evidence preparation must remain synchronous.",
        );
      }
      const lifecycle = preparedLifecycle;
      const minted = approvalRequest(toolCall, requirement, {
        approvalId,
        approvalToken,
        ...(lifecycle ? { lifecycle } : {}),
      });
      attemptedSpan.end({
        status: "suspended",
        attributes: {
          isError: false,
          approvalId,
          approvalRequired: true,
        },
      });
      transcript.push({
        t: "gate",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        verdict: "suspend",
        origin,
      });
      transcript.push({
        t: "suspend.mint",
        toolCallId: toolCall.id,
        approvalId,
      });
      return { kind: "suspend", request: minted };
    }

    transcript.push({
      t: "gate",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      verdict: "execute",
      origin,
    });
    return {
      kind: "execute",
      run: () =>
        runTool(toolCall, shaped, messages, traceId, attemptedSpan),
    };
  }

  async function changedApprovalVerdict(
    toolCall: SessionToolCall,
    approvalId: string,
  ): Promise<Extract<ToolGateVerdict, { kind: "denied" }>> {
    return {
      kind: "denied",
      settled: await settleInvalidApproval({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
        approvalId,
        message:
          "The approved tool request changed and was not executed. Request approval again.",
      }),
    };
  }

  // ── Session methods ──────────────────────────────────────────────

  async function notifyDecisions(
    messages: readonly Message[] | undefined,
  ): Promise<void> {
    if (!enabled || !messages) return;
    lastMessages = messages;
    const decisions = findToolApprovalRequests(messages).filter(
      (request) =>
        findToolApprovalDecision(messages, request.approvalId) !== undefined,
    ).length;
    transcript.push({ t: "decision.notify", decisions });
    await notifyToolApprovalResponses(wrappedTools, messages);
  }

  return {
    get enabled() {
      return enabled;
    },

    get tools() {
      return armedTools;
    },

    get toolWireSchemas() {
      // Every tool that declared an input schema gets its SDK-installed schema
      // set to the compiled wire schema: Zod tools so the SDK never runs the
      // authored validator, non-Zod tools so an AI SDK `jsonSchema(...)` wrapper
      // is unwrapped and a raw JSON Schema is installed correctly. Tools with no
      // schema are left untouched. Undefined when no such tool exists.
      return armedToolWireSchemas;
    },

    get descriptors() {
      return descriptors;
    },

    async rearm(resolved) {
      preserveArmedIdentity = true;
      try {
        arm(resolved);
        if (!exposureGuards) return;
        const exposed = await exposureEvaluator.evaluate(
          exposureCandidates,
          exposureGuards,
        );
        applyExposedDescriptors(exposed);
      } finally {
        preserveArmedIdentity = false;
      }
    },

    async guardExposure(guards) {
      exposureGuards = guards;
      const exposed = await exposureEvaluator.evaluate(
        exposureCandidates,
        guards,
      );
      applyExposedDescriptors(exposed);
    },

    requiresApproval: async (toolCall, messages) => {
      // SDK-owned tool loops evaluate approval outside the core gate, so decode
      // the model's wire arguments to canonical z.input here before approval
      // policies observe them. Fails closed: on a decode error no approval policy
      // runs and the tool is not gated — the execution decode boundary settles
      // the sanitized model-visible decode error without executing.
      const decode = decodeToolCallArgs(toolCall);
      if (!decode.ok) return false;
      const decodedCall =
        decode.args !== toolCall.args
          ? { ...toolCall, args: decode.args }
          : toolCall;
      const tool = wrappedTools[decodedCall.name];
      if (!tool || typeof tool !== "object") return false;
      rememberSdkAttempt(decodedCall, tool as SessionToolShape);
      const requirement = await approvalRequirement(decodedCall, messages);
      if (requirement.requiresApproval)
        pendingApprovalRequirements.set(toolCall.id, requirement);
      return requirement.requiresApproval;
    },

    notifyDecisions,

    async resume(messages) {
      if (!enabled) return { messages: [...messages], replayed: 0 };
      await notifyDecisions(messages);
      const invalidApprovalCalls = findInvalidApprovalToolCalls(messages);
      const replayCalls = findApprovedOrDeniedToolCalls(messages);
      const replayed = invalidApprovalCalls.length + replayCalls.length;
      transcript.push({ t: "resume", replayed });
      if (replayed === 0) return { messages: [...messages], replayed: 0 };

      const results: ToolResultEntry[] = [];
      for (const toolCall of invalidApprovalCalls) {
        results.push(await settleInvalidApproval(toolCall));
      }
      for (const toolCall of replayCalls) {
        const verdict = await gate(toolCall, messages, "replay");
        // `suspend` is unreachable here: the scan only returns decided calls
        // and the gate consults the decision before approval policy.
        if (verdict.kind === "execute") results.push(await verdict.run());
        else if (verdict.kind !== "suspend") results.push(verdict.settled);
      }
      rememberToolResults(results);
      const synthetic = createSyntheticToolCallResponse([
        ...invalidApprovalCalls,
        ...replayCalls,
      ]);
      return {
        messages: appendRound([...messages], synthetic, results),
        replayed,
      };
    },

    async executeRound(response, messages) {
      if (options.regime === "sdk") {
        throw new Error(
          "executeRound() is unavailable in the sdk regime — the SDK owns the tool loop (RFC #28). Hand lifecycle.tools to the SDK instead.",
        );
      }
      // NOT gated on `enabled`: a model can hallucinate a tool call against
      // a tool-less prompt, and the round must settle it as tool_not_found
      // so the model hears the failure.
      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return { kind: "completed", results: [], messages: [...messages] };
      }
      emitToolRequestArtifacts(toolCalls);

      const results: ToolResultEntry[] = [];
      for (const toolCall of toolCalls) {
        const verdict = await gate(toolCall, messages, "live");
        if (verdict.kind === "suspend") {
          rememberToolResults(results);
          transcript.push({
            t: "round",
            settled: results.length,
            suspended: 1,
          });
          // Settled siblings already executed — persist their results after
          // the approval-request message (which carries the assistant turn
          // and tool calls) so the model hears about the side effects and
          // resume() treats them as completed.
          const siblingMessages = results.map(canonicalToolResultMessage);
          return {
            kind: "suspended",
            request: verdict.request,
            settled: results,
            messages: [
              ...messages,
              createApprovalRequestMessage(response, verdict.request),
              ...siblingMessages,
            ],
          };
        }
        results.push(
          verdict.kind === "execute" ? await verdict.run() : verdict.settled,
        );
      }
      transcript.push({ t: "round", settled: results.length, suspended: 0 });
      rememberToolResults(results);
      return {
        kind: "completed",
        results,
        messages: appendRound([...messages], response, results),
      };
    },

    async applySkillLoads(toolCalls) {
      if (!skillSession || !options.reresolve) return undefined;
      const loadCalls = toolCalls.filter(
        (toolCall) => toolCall.name === LOAD_SKILL_TOOL_NAME,
      );
      if (loadCalls.length === 0) return undefined;

      // Announce newly active skills exactly once per session.
      const newSkills = skillSession.newlyActivated();
      for (const loadedSkill of newSkills) {
        if (announcedSkills.has(loadedSkill.id)) continue;
        announcedSkills.add(loadedSkill.id);
        transcript.push({ t: "skill.load", skillId: loadedSkill.id });
      }

      if (newSkills.length === 0) return { refundStep: true };

      // Re-resolve — activated skills now contribute their full instructions.
      const reResolved = await options.reresolve(skillSession);
      const guarded: GuardedSkillIngressAmendment = options.guardSkillAmendment
        ? await options.guardSkillAmendment({
            resolved: reResolved,
            newlyLoadedSkillIds: newSkills.map((entry) => entry.id),
          })
        : {
            system: reResolved.system ?? "",
            systemBlocks: reResolved.systemBlocks,
          };
      const { prefixPatch, ...amendment } = guarded;
      // Re-arm the surface and re-notify approval middleware against the
      // REBUILT tool instances (decision dedup keeps this idempotent).
      arm(reResolved);
      if (exposureGuards) {
        const exposed = await exposureEvaluator.evaluate(
          exposureCandidates,
          exposureGuards,
        );
        applyExposedDescriptors(exposed);
      }
      skillSession.markInjected(newSkills.map((entry) => entry.id));
      await notifyToolApprovalResponses(wrappedTools, lastMessages);

      return {
        ...amendment,
        ...(prefixPatch ? { [systemMessagePrefixPatch]: prefixPatch } : {}),
        refundStep: true,
      };
    },

    suspend(pending, assistantResponse, messages) {
      if (options.regime === "core") {
        throw new Error(
          "suspend() is unavailable in the core regime — executeRound() returns suspension as a value instead.",
        );
      }
      const requests: ApprovalRequestInfo[] = [];
      let sealedMessages = [...messages];
      for (const pendingCall of pending) {
        const requirement = pendingApprovalRequirements.get(
          pendingCall.toolCallId,
        ) ?? {
          requiresApproval: true,
          policies: [],
        };
        pendingApprovalRequirements.delete(pendingCall.toolCallId);
        const call = {
          id: pendingCall.toolCallId,
          name: pendingCall.toolName,
          args: pendingCall.input,
        };
        const approvalId = createApprovalId(call.id);
        const approvalToken = mintToken();
        const attemptedSpan = consumeSdkAttempt(
          call.name,
          call.id,
          call.args,
        );
        let lifecycle: CommittedApprovalReplayLifecycle | undefined;
        if (attemptedSpan) {
          const preparedLifecycle = attemptedSpan.withContext(() =>
            emitToolApprovalRequestAuthority({
              approvalId,
              toolCallId: call.id,
              toolName: call.name,
              input: call.args,
              attempt: attemptedSpan,
              ...(requirement.observeRequest
                ? {
                    observePolicyDecision:
                      requirement.observeRequest,
                  }
                : {}),
            }),
          );
          if (preparedLifecycle instanceof Promise) {
            throw new TypeError(
              "Tool approval evidence preparation must remain synchronous.",
            );
          }
          lifecycle = preparedLifecycle;
        } else {
          emitToolApprovalObservation("request", {
            approvalId,
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
            ...(requirement.observeRequest
              ? { observePolicyDecision: requirement.observeRequest }
              : {}),
          });
        }
        const request = approvalRequest(call, requirement, {
          approvalId,
          approvalToken,
          ...(lifecycle ? { lifecycle } : {}),
        });
        requests.push(request);
        if (attemptedSpan) {
          attemptedSpan.end({
            status: "suspended",
            attributes: {
              isError: false,
              approvalId: request.approvalId,
              approvalRequired: true,
            },
          });
        }
        transcript.push({
          t: "suspend.mint",
          toolCallId: request.toolCallId,
          approvalId: request.approvalId,
        });
        sealedMessages = [
          ...sealedMessages,
          createApprovalRequestMessage(assistantResponse, request),
        ];
      }
      return { messages: sealedMessages, requests };
    },

    // Keyed on memory bindings, not `enabled` — a prompt can bind memory
    // without declaring any tools.
    async captureTurn(args) {
      finalizeSdkAttempts();
      if (memoryCaptured) return;
      memoryCaptured = true;
      const bindings = options.resolved.memoryBindings?.length ?? 0;
      if (bindings === 0) return;
      transcript.push({ t: "memory.capture", bindings });
      const toolCalls = enrichToolCallsFromMessages(
        enrichToolCallsWithResults(args.toolCalls, [
          ...settledToolResults.values(),
        ]),
        args.messages,
      );
      await captureMemoryTurn(options.resolved, {
        promptId: options.promptId,
        input: options.input ?? {},
        messages: [...args.messages],
        assistantText: args.assistantText,
        toolCalls,
        memoryWriteGuard: options.memoryWriteGuard,
      });
    },

    transcript,
  };
}
