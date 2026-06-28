/**
 * One prompt-resolution compiler pass.
 *
 * This module owns the ordered pass from validated input to SDK-ready
 * `ResolvedPrompt` plus an inspect projection. The public `compilePrompt()`
 * entrypoint binds schemas and ports, then delegates each call here.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyToolSet, AnyMessage, AnyPromptConfig, ContextEntry, ModelInfo } from '../types'
import type { ResolvedPrompt } from './types'
import { LOAD_REFERENCE_TOOL_NAME, LOAD_SKILL_TOOL_NAME } from '../skill/tools'
import { countTokens } from '../shared/tokenizer'
import { detectSuspiciousPatterns, escapeXml } from '../shared/sanitize'
import { resolveUse } from './driver'
import { guardInputs } from './input-guard'
import { assertNoObjectMessageContent, assertNoObjectPromptText } from './pass-guards'
import { resolvePostMergeSurface } from './post-merge-surface'
import { emitPromptInputArtifact, emitSecurityWarningSpan, promptInputPreview } from './prompt-observability'
import { mergeSettings, selectAdaptation } from './prompt-settings'
import type { ResolverPorts } from './ports'
import {
  collectActiveContextTools,
  collectBlackboardTools,
  collectContextConstraints,
  collectContextGuardrails,
} from './runtime-surface'
import { safeParseSchema } from './schema'
import { createSkillToolSurface } from './skills'
import { buildSystemMessage } from './system-message'
import { renderPromptText, resolveSystemContent } from './system-content'
import type { PromptResolutionPass, ResolutionEmissionMode, ResolveCallOptions } from './compiler-types'

/** Validate prompt config invariants that the compiler depends on. */
export function validatePromptConfig(config: AnyPromptConfig): void {
  if (config.messages && (config.system || config.prompt)) {
    throw new Error(
      'prompt: "messages" is mutually exclusive with "system" and "prompt". ' +
        'Use either messages mode or system+prompt mode, not both.',
    )
  }
}

/** Run a normal, observable prompt-resolution pass. */
export async function runPromptResolvePass(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
  ports: ResolverPorts,
): Promise<PromptResolutionPass> {
  validatePromptConfig(config)
  return ports.observability.scope(
    {
      name: config.id ?? 'prompt.resolve',
      family: 'prompt',
      primitive: 'prompt.resolve',
      attributes: {
        promptId: config.id,
        contextEntryCount: (config.use ?? []).length,
        hasMessages: !!config.messages,
        hasOutput: !!config.output,
      },
    },
    async () => runPromptPass(config, opts, mergedSchema, ports, 'resolve'),
  )
}

/** Run one compiler pass and return both resolved args and inspect data. */
export async function runPromptPass(
  config: AnyPromptConfig,
  opts: ResolveCallOptions,
  mergedSchema: z.ZodType | undefined,
  ports: ResolverPorts,
  mode: ResolutionEmissionMode,
): Promise<PromptResolutionPass> {
  let input = opts.input ?? {}

  if (mergedSchema) {
    const parseResult = safeParseSchema(mergedSchema, input)
    if (!parseResult.success) {
      if (mode === 'resolve') {
        emitPromptInputArtifact(ports, promptInputPreview(config.id, input, mergedSchema, 'failed'))
      }
      throw new Error(`Input validation failed: ${JSON.stringify(parseResult.error?.issues ?? parseResult.error)}`)
    }
    if (mode === 'resolve') {
      emitPromptInputArtifact(ports, promptInputPreview(config.id, input, mergedSchema, 'passed'))
    }
  } else if (mode === 'resolve') {
    emitPromptInputArtifact(ports, promptInputPreview(config.id, input, undefined, 'not-configured'))
  }

  const entries: readonly ContextEntry[] = config.use ?? []
  const mergedUse = await resolveUse(entries, input as Record<string, unknown>, config.id, ports)
  const postMerge = await resolvePostMergeSurface(mergedUse, input, ports)

  if (ports.policy().autoEscape) {
    const rawFieldSet = new Set<string>([
      ...(config.rawFields ?? []),
      ...postMerge.contexts.flatMap((ctx) => ctx.rawFields ?? []),
    ])

    const sanitizedInput: Record<string, unknown> = { ...input }
    for (const [key, value] of Object.entries(sanitizedInput)) {
      if (typeof value === 'string' && !rawFieldSet.has(key)) {
        sanitizedInput[key] = escapeXml(value)
      }
    }
    input = sanitizedInput
  }

  if (config.sanitize) {
    input = config.sanitize(input as never) as Record<string, unknown>
  }

  if (mode === 'resolve' && ports.policy().securityWarnings) {
    for (const [key, value] of Object.entries(opts.input ?? {})) {
      if (typeof value === 'string') {
        const warnings = detectSuspiciousPatterns(value, key)
        for (const warning of warnings) {
          ports.diagnostics.warn(`[@use-crux/core] ${warning.message}`)
          emitSecurityWarningSpan({
            promptId: config.id ?? 'unknown',
            field: key,
            pattern: warning.pattern,
            message: warning.message,
            inputPreview: value.slice(0, 200),
          })
        }
      }
    }
  }

  const guardedInput = guardInputs(input as Record<string, unknown>, config.id)
  const ownSystem = await resolveSystemContent(config.system, guardedInput)
  const composed = await buildSystemMessage(ownSystem, postMerge.contexts, guardedInput, opts.tokenBudget, ports)
  let system = composed.system
  const systemBlocks = composed.blocks

  let promptText: string | undefined
  let messages: AnyMessage[] | undefined

  if (config.messages) {
    messages = (config.messages as (arg: { input: Record<string, unknown> }) => AnyMessage[])({ input: guardedInput })
    assertNoObjectMessageContent(messages)

    if (system) {
      const firstSystemIdx = messages.findIndex((message) => message.role === 'system')
      if (firstSystemIdx >= 0) {
        const first = messages[firstSystemIdx]!
        const firstContent = typeof first.content === 'string' ? first.content : String(first.content)
        messages = [...messages]
        messages[firstSystemIdx] = {
          ...first,
          content: system + '\n\n' + firstContent,
        }
      } else {
        messages = [{ role: 'system' as const, content: system }, ...messages]
      }
      system = ''
    }
  } else {
    promptText = await renderPromptText(config.prompt, guardedInput)
  }

  const promptInfo = promptText ? { text: promptText, tokens: countTokens(promptText) } : undefined
  assertNoObjectPromptText(promptText, config.id)

  const modelInfo: ModelInfo = {
    provider: opts.provider ?? '',
    modelId: opts.modelId ?? '',
  }
  const adaptation = selectAdaptation(config.adapt, modelInfo)
  if (adaptation) {
    if (adaptation.prependSystem) system = adaptation.prependSystem + '\n\n' + system
    if (adaptation.appendSystem) system = system + '\n\n' + adaptation.appendSystem
    if (promptText !== undefined) {
      if (adaptation.prependPrompt) promptText = adaptation.prependPrompt + promptText
      if (adaptation.appendPrompt) promptText = promptText + adaptation.appendPrompt
    }
  }

  const { input: _input, provider: _provider, modelId: _modelId, tokenBudget: _tokenBudget, ...callSettings } = opts
  void _input
  void _provider
  void _modelId
  void _tokenBudget
  const settings = mergeSettings(config.settings, adaptation?.settings, callSettings)

  const resolved: ResolvedPrompt = {
    ...(system ? { system } : {}),
    ...(systemBlocks.length > 0 ? { systemBlocks } : {}),
    ...(composed.promptBudgetArtifactId ? { promptBudgetArtifactId: composed.promptBudgetArtifactId } : {}),
    ...(promptText ? { prompt: promptText } : {}),
    ...(messages ? { messages } : {}),
    ...(config.output ? { schema: config.output } : {}),
    settings,
  }

  const contextTools = collectActiveContextTools(postMerge.contexts, input)
  const configTools = config.tools
  let skillTools: AnyToolSet = {}
  let skillSession: unknown
  if (mode === 'resolve' && postMerge.skills.length > 0) {
    const toolSurface = createSkillToolSurface(postMerge.skills, input)
    skillTools = toolSurface.tools
    skillSession = toolSurface.session
  }

  const blackboardExistingTools =
    mode === 'resolve'
      ? { ...skillTools, ...contextTools, ...(configTools ?? {}) }
      : { ...contextTools, ...(configTools ?? {}) }
  const blackboardTools = collectBlackboardTools(postMerge.blackboards, blackboardExistingTools)

  if (skillSession !== undefined) {
    ;(resolved as ResolvedPrompt & { _skillSession?: unknown })._skillSession = skillSession
  }

  const merged = {
    ...skillTools,
    ...contextTools,
    ...postMerge.injectedTools,
    ...blackboardTools,
    ...configTools,
  }

  if (Object.keys(merged).length > 0) resolved.tools = merged
  if (config.toolMiddleware !== undefined) resolved.toolMiddleware = config.toolMiddleware
  if (config.toolChoice !== undefined) resolved.toolChoice = config.toolChoice
  if (config.stopWhen !== undefined) resolved.stopWhen = config.stopWhen

  const allConstraints = [
    ...postMerge.injectedConstraints,
    ...collectContextConstraints(postMerge.contexts),
    ...(config.constraints ?? []),
  ]
  if (allConstraints.length > 0) resolved.constraints = allConstraints

  const allGuardrails = [
    ...postMerge.injectedGuardrails,
    ...collectContextGuardrails(postMerge.contexts),
    ...(config.guardrails ?? []),
  ]
  if (allGuardrails.length > 0) resolved.guardrails = allGuardrails

  if (Object.keys(postMerge.injectedMetadata).length > 0) {
    resolved.metadata = postMerge.injectedMetadata
  }

  if (postMerge.memories.length > 0) {
    resolved.memoryBindings = postMerge.memories.map((memory) => ({
      memory,
      input: input as Record<string, unknown>,
      promptId: config.id,
    }))
  }

  const systemTokens = composed.system ? countTokens(composed.system) : 0
  const promptTokens = promptInfo?.tokens ?? 0
  const skillToolNames = postMerge.skills.length > 0 ? [LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME] : []
  const inspectTools = { ...contextTools, ...postMerge.injectedTools, ...blackboardTools, ...configTools }
  const toolNames = [...skillToolNames, ...Object.keys(inspectTools)]

  return {
    args: resolved,
    inspection: {
      system: {
        total: composed.system,
        parts: composed.parts,
        totalTokens: systemTokens,
      },
      prompt: promptInfo,
      totalTokens: systemTokens + promptTokens,
      droppedContexts: composed.droppedContexts,
      excludedContexts: postMerge.excluded,
      tokenBudget: opts.tokenBudget,
      tools: toolNames.length > 0 ? toolNames : undefined,
    },
  }
}
