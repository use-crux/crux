/**
 * One prompt-resolution compiler pass.
 *
 * This module owns the ordered pass from validated input to SDK-ready
 * `ResolvedPrompt` plus an inspect projection. The resolver plan
 * (`createPromptResolverPlan`) binds config, schema, and ports, then delegates
 * each call here; the public `compilePrompt()` entrypoint never touches this
 * pass directly. `runPromptPass` is mode-agnostic — observability scoping for
 * `'resolve'` lives in the plan, so this function is the pure ordered transform.
 *
 * @module
 */

import type { z } from "zod";
import type { AnyToolSet, AnyMessage, ModelInfo } from "../types";
import type { AnyPromptConfig } from "../prompt/prompt-types";
import type { ContextEntry } from "../prompt/context-types";
import type { ResolvedPrompt } from "./types";
import type { ToolMiddleware } from "../tools/types";
import { LOAD_REFERENCE_TOOL_NAME, LOAD_SKILL_TOOL_NAME } from "../skill/tools";
import {
  applyPromptAdaptation,
  applySystemAdaptationBlocks,
  applySystemAdaptationText,
  foldSystemIntoMessagesWithBoundary,
  joinSystemText,
} from "./adaptation";
import { detectSuspiciousPatterns, escapeXml } from "../shared/sanitize";
import { collectStaticEntryIds } from "./definition-analysis";
import { resolveUse } from "./driver";
import {
  collectDeclaredRawFields,
  collectResolverPrivateInput,
  containsNestedString,
  mergeResolverPrivateInput,
} from "./input-pipeline";
import { guardInputs } from "./input-guard";
import {
  assertNoObjectMessageContent,
  assertNoObjectPromptText,
} from "./pass-guards";
import { resolvePostMergeSurface } from "./post-merge-surface";
import {
  emitPromptInputArtifact,
  emitSecurityWarningSpan,
  promptInputPreview,
} from "./prompt-observability";
import { mergeSettings, selectAdaptation } from "./prompt-settings";
import type { ResolverPorts } from "./ports";
import {
  collectContextConstraints,
  collectContextGuardrails,
  mergeActiveContextToolSurfaces,
  mergeBlackboardTools,
} from "./runtime-surface";
import {
  inspectToolApprovalPolicies,
  type ApprovalDeclaration,
  type ToolApprovalMap,
} from "../tools/approval-policy";
import { safeParseSchema } from "./schema";
import {
  PromptInputValidationError,
  promptInputValidationIssues,
} from "./input-validation-error";
import { createSkillToolSurface } from "./skills";
import { buildSystemMessage } from "./system-message";
import {
  alignSystemIngressBlocks,
  attachSystemIngressCarrier,
} from "./system-ingress-provenance";
import { resolveSystemContent } from "./system-content";
import { resolveRepresentationPolicies } from "./representation-policy";
import { inspectPromptText, resolvePromptText } from "./prompt-content";
import { attachPromptTextObservation } from "./prompt-text-observation";
import { createToolMergeAccumulator, type ToolOwnerLabel } from "./tool-merge";
import type {
  PromptResolutionPass,
  ProjectionMode,
  ResolveCallOptions,
} from "./compiler-types";

function promptApprovalDeclarations(
  map: ToolApprovalMap | undefined,
): ApprovalDeclaration[] {
  if (!map) return [];
  return Object.entries(map).map(([key, policy]) => ({
    layer: "prompt" as const,
    key,
    policy,
  }));
}

/** Validate prompt config invariants that the compiler depends on. */
export function validatePromptConfig(config: AnyPromptConfig): void {
  if (config.messages && (config.system || config.prompt)) {
    throw new Error(
      'prompt: "messages" is mutually exclusive with "system" and "prompt". ' +
        "Use either messages mode or system+prompt mode, not both.",
    );
  }
}

/** Run one compiler pass and return both resolved args and inspect data. */
export async function runPromptPass(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
  ports: ResolverPorts,
  mode: ProjectionMode,
): Promise<PromptResolutionPass> {
  let input = opts.input ?? {};
  const resolverPrivateInput = collectResolverPrivateInput(input);

  if (mergedSchema) {
    const parseResult = safeParseSchema(mergedSchema, input);
    if (!parseResult.success) {
      if (mode === "resolve") {
        emitPromptInputArtifact(
          ports,
          promptInputPreview(config.id, input, mergedSchema, "failed"),
        );
      }
      throw new PromptInputValidationError(
        promptInputValidationIssues(parseResult.error?.issues),
        `Input validation failed: ${JSON.stringify(parseResult.error?.issues ?? parseResult.error)}`,
      );
    }
    if (mode === "resolve") {
      emitPromptInputArtifact(
        ports,
        promptInputPreview(config.id, input, mergedSchema, "passed"),
      );
    }
    input = parseResult.data as Record<string, unknown>;
  } else if (mode === "resolve") {
    emitPromptInputArtifact(
      ports,
      promptInputPreview(config.id, input, undefined, "not-configured"),
    );
  }

  const entries: readonly ContextEntry[] = config.use ?? [];

  if (config.sanitize) {
    input = config.sanitize(input as never) as Record<string, unknown>;
  }

  if (ports.policy().autoEscape) {
    const rawFieldSet = new Set<string>([
      ...(config.rawFields ?? []),
      ...collectDeclaredRawFields(entries),
    ]);

    const sanitizedInput: Record<string, unknown> = { ...input };
    let warnedNestedStrings = false;
    for (const [key, value] of Object.entries(sanitizedInput)) {
      if (typeof value === "string" && !rawFieldSet.has(key)) {
        sanitizedInput[key] = escapeXml(value);
      } else if (
        typeof value !== "string" &&
        !warnedNestedStrings &&
        containsNestedString(value)
      ) {
        ports.diagnostics.warn(
          `auto-escape: input field "${key}" contains nested string values; ` +
            `auto-escape covers top-level strings only. Escape nested content explicitly or restructure the input.`,
        );
        warnedNestedStrings = true;
      }
    }
    input = sanitizedInput;
  }

  input = mergeResolverPrivateInput(
    input as Record<string, unknown>,
    resolverPrivateInput,
  );

  if (mode === "resolve" && ports.policy().securityWarnings) {
    for (const [key, value] of Object.entries(opts.input ?? {})) {
      if (typeof value === "string") {
        const warnings = detectSuspiciousPatterns(value, key);
        for (const warning of warnings) {
          ports.diagnostics.warn(`[@use-crux/core] ${warning.message}`);
          emitSecurityWarningSpan({
            promptId: config.id ?? "unknown",
            field: key,
            pattern: warning.pattern,
            message: warning.message,
            inputPreview: value.slice(0, 200),
          });
        }
      }
    }
  }

  const guardedInput = guardInputs(input as Record<string, unknown>, config.id);
  const mergedUse = await resolveUse(
    entries,
    guardedInput,
    config.id,
    ports,
    0,
    new Set(),
    undefined,
    collectStaticEntryIds(entries),
  );
  const postMerge = await resolvePostMergeSurface(
    mergedUse,
    guardedInput,
    ports,
  );
  const ownSystem = await resolveSystemContent(
    config.system,
    guardedInput,
    ports.tokenizer.count,
    config.id,
  );
  const composed = await buildSystemMessage(
    ownSystem,
    postMerge.contexts,
    guardedInput,
    ports,
    {
      ownProviderCache: config.cache?.provider === true,
      ownSystemIsStatic:
        config.system !== undefined && typeof config.system !== "function",
      ownSystemIsDynamic: typeof config.system === "function",
      promptId: config.id,
    },
  );
  const representations = await resolveRepresentationPolicies(
    postMerge.representationLadders,
    postMerge.representationOwnership,
    postMerge.skills,
    (skills) => ports.skills.index(skills),
    postMerge.contexts,
    composed.parts,
    guardedInput,
    ports.tokenizer.count,
  );
  let system = composed.system;
  let systemBlocks = composed.blocks;

  const modelInfo: ModelInfo = {
    provider: opts.provider ?? "",
    modelId: opts.modelId ?? "",
  };
  const adaptation = selectAdaptation(config.adapt, modelInfo);
  systemBlocks = applySystemAdaptationBlocks(systemBlocks, adaptation);
  const systemIngressBlocks = alignSystemIngressBlocks(
    systemBlocks,
    composed.blocks,
    composed.ingressBlocks,
  );
  system =
    systemBlocks.length > 0
      ? joinSystemText(systemBlocks.map((block) => block.text))
      : applySystemAdaptationText(system, adaptation);
  const inspectionSystem = system;

  let promptText: string | undefined;
  let promptInfo: ReturnType<typeof inspectPromptText> = undefined;
  let messages: AnyMessage[] | undefined;
  let foldedSystem:
    | ReturnType<typeof foldSystemIntoMessagesWithBoundary>
    | undefined;

  if (config.messages) {
    messages = (
      config.messages as (arg: {
        input: Record<string, unknown>;
      }) => AnyMessage[]
    )({ input: guardedInput });
    assertNoObjectMessageContent(messages);

    foldedSystem = foldSystemIntoMessagesWithBoundary(system, messages);
    messages = foldedSystem?.messages ?? messages;
    system = "";
  } else {
    const resolvedPromptText = applyPromptAdaptation(
      resolvePromptText(config.prompt, guardedInput, config.id),
      adaptation,
    );
    promptText = resolvedPromptText?.text;
    promptInfo = inspectPromptText(resolvedPromptText, ports.tokenizer.count);
  }

  assertNoObjectPromptText(promptText, config.id);

  const {
    input: _input,
    provider: _provider,
    modelId: _modelId,
    ...callSettings
  } = opts;
  void _input;
  void _provider;
  void _modelId;
  const settings = mergeSettings(
    config.settings,
    adaptation?.adaptation.settings,
    callSettings,
  );

  const resolved: ResolvedPrompt = {
    ...(system ? { system } : {}),
    ...(!config.messages && systemBlocks.length > 0 ? { systemBlocks } : {}),
    ...(promptText ? { prompt: promptText } : {}),
    ...(messages ? { messages } : {}),
    ...(config.output ? { schema: config.output } : {}),
    settings,
    ...(postMerge.historyProjection
      ? { historyProjection: postMerge.historyProjection }
      : {}),
    ...(representations.length > 0 ? { representations } : {}),
  };
  attachPromptTextObservation(resolved, promptInfo);
  if (systemIngressBlocks.length > 0) {
    if (foldedSystem) {
      attachSystemIngressCarrier(resolved, {
        mode: "messages",
        blocks: systemIngressBlocks,
        targetMessageIndex: foldedSystem.targetMessageIndex,
        foldedPrefix: foldedSystem.foldedPrefix,
        prefixLength: foldedSystem.prefixLength,
        hasTrustedSuffix: foldedSystem.hasTrustedSuffix,
      });
    } else if (system) {
      attachSystemIngressCarrier(resolved, {
        mode: "system",
        blocks: systemIngressBlocks,
      });
    }
  }

  const configTools = config.tools;
  const toolMerge = createToolMergeAccumulator();
  let skillTools: AnyToolSet = {};
  let skillSession: unknown;
  if (mode === "resolve" && postMerge.skills.length > 0) {
    const toolSurface = createSkillToolSurface(postMerge.skills, input, ports);
    skillTools = toolSurface.tools;
    skillSession = toolSurface.session;
    const owner = skillToolOwner(postMerge.skills);
    if (owner) toolMerge.merge(skillTools, owner);
  }

  const toolApprovalDeclarations = [
    ...mergeActiveContextToolSurfaces(toolMerge, postMerge.contexts, input),
    ...promptApprovalDeclarations(config.toolApproval),
  ];
  toolMerge.mergeOwned(postMerge.injectedTools, postMerge.injectedToolOwners);
  mergeBlackboardTools(toolMerge, postMerge.blackboards);
  toolMerge.merge(configTools, "prompt config");

  if (skillSession !== undefined) {
    (resolved as ResolvedPrompt & { _skillSession?: unknown })._skillSession =
      skillSession;
  }

  const merged = toolMerge.tools;
  if (Object.keys(merged).length > 0) resolved.tools = merged;
  if (postMerge.toolSources.length > 0)
    resolved.toolSources = postMerge.toolSources;
  if (toolApprovalDeclarations.length > 0)
    resolved.toolApprovalDeclarations = toolApprovalDeclarations;
  const toolMiddleware = mergeToolMiddleware(
    postMerge.injectedToolMiddleware,
    config.toolMiddleware,
  );
  if (toolMiddleware !== undefined) resolved.toolMiddleware = toolMiddleware;

  const allConstraints = [
    ...postMerge.injectedConstraints,
    ...collectContextConstraints(postMerge.contexts),
    ...(config.constraints ?? []),
  ];
  if (allConstraints.length > 0) resolved.constraints = allConstraints;

  const allGuardrails = [
    ...postMerge.injectedGuardrails,
    ...collectContextGuardrails(postMerge.contexts),
    ...(config.guardrails ?? []),
  ];
  if (allGuardrails.length > 0) resolved.guardrails = allGuardrails;

  if (Object.keys(postMerge.injectedMetadata).length > 0) {
    resolved.metadata = postMerge.injectedMetadata;
  }

  if (postMerge.memories.length > 0) {
    resolved.memoryBindings = postMerge.memories.map((memory) => ({
      memory,
      input: input as Record<string, unknown>,
      promptId: config.id,
    }));
  }

  const systemTokens = inspectionSystem
    ? ports.tokenizer.count(inspectionSystem)
    : 0;
  const promptTokens = promptInfo?.tokens ?? 0;
  const skillToolNames =
    postMerge.skills.length > 0
      ? [LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME]
      : [];
  const toolNames =
    mode === "resolve"
      ? Object.keys(merged)
      : [...skillToolNames, ...Object.keys(merged)];

  return {
    args: resolved,
    inspection: {
      system: {
        total: inspectionSystem,
        parts: composed.parts,
        totalTokens: systemTokens,
      },
      prompt: promptInfo,
      totalTokens: systemTokens + promptTokens,
      droppedContexts: composed.droppedContexts,
      excludedContexts: postMerge.excluded,
      tools: toolNames.length > 0 ? toolNames : undefined,
      ...(toolNames.length > 0
        ? {
            toolApprovals: inspectToolApprovalPolicies(
              toolNames,
              toolApprovalDeclarations,
            ),
          }
        : {}),
    },
  };
}

function skillToolOwner(
  skills: readonly { id: string }[],
): ToolOwnerLabel | undefined {
  const first = skills[0];
  return first ? `skill:${first.id}` : undefined;
}

function mergeToolMiddleware(
  injected: readonly ToolMiddleware[],
  configured: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): ToolMiddleware | readonly ToolMiddleware[] | undefined {
  const chain = [...injected, ...normalizeToolMiddleware(configured)];
  if (chain.length === 0) return undefined;
  return chain;
}

function normalizeToolMiddleware(
  middleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): ToolMiddleware[] {
  if (middleware === undefined) return [];
  return isToolMiddlewareArray(middleware) ? [...middleware] : [middleware];
}

function isToolMiddlewareArray(
  middleware: ToolMiddleware | readonly ToolMiddleware[],
): middleware is readonly ToolMiddleware[] {
  return Array.isArray(middleware);
}
