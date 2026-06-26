/**
 * Observability projections emitted by prompt resolution.
 *
 * These helpers build redacted read models for validation, budget decisions,
 * and security warnings. They accept resolved facts from the compiler pass
 * and keep all artifact-shape details out of the pass coordinator.
 *
 * @module
 */

import { z } from 'zod'
import type { CruxArtifactId, CruxPromptBudgetPreview, CruxPromptInputPreview } from '../observability/contract'
import { observe } from '../observability'
import type { ResolverPorts } from './ports'
import { promptInputRequiredKeys, promptInputSchemaKeys } from './schema'

/** Emit the token-budget artifact for a prompt-resolution pass. */
export function emitPromptBudgetArtifact(
  ports: ResolverPorts,
  preview: CruxPromptBudgetPreview,
): CruxArtifactId | undefined {
  return ports.observability.artifact(
    {
      kind: 'prompt.budget',
      contentType: 'application/json',
      encoding: 'json',
      preview,
      attributes: {
        budgetUsedTokens: preview.usedTokens,
        budgetTotalTokens: preview.totalTokens,
        droppedContextCount: preview.dropped.length,
      },
    },
    { primitive: 'prompt.budget' },
  )
}

/**
 * Emit a prompt-input artifact without serializing input values.
 *
 * The preview is limited to top-level key names and validation status so
 * devtools can compare runtime input with the effective schema while
 * preserving the same redaction boundary for successful and failed calls.
 */
export function emitPromptInputArtifact(
  ports: ResolverPorts,
  preview: CruxPromptInputPreview,
): CruxArtifactId | undefined {
  return ports.observability.artifact(
    {
      kind: 'input',
      contentType: 'application/json',
      encoding: 'json',
      preview,
      attributes: {
        primitive: 'prompt.input',
        promptId: preview.promptId,
        validationStatus: preview.validationStatus,
        providedKeyCount: preview.providedKeys.length,
        schemaKeyCount: preview.schemaKeys?.length ?? 0,
        requiredKeyCount: preview.requiredKeys?.length ?? 0,
        missingKeyCount: preview.missingKeys?.length ?? 0,
        unexpectedKeyCount: preview.unexpectedKeys?.length ?? 0,
      },
    },
    { primitive: 'prompt.input', validationStatus: preview.validationStatus },
  )
}

/**
 * Build the redacted prompt-input preview used by runtime validation views.
 *
 * The comparison is intentionally shallow: Crux effective schemas are
 * presented as top-level prompt fields. Nested value inspection would require
 * raw values or schema-specific traversal, so missing and unexpected keys are
 * computed only at the top level.
 */
export function promptInputPreview(
  promptId: string | undefined,
  input: Record<string, unknown>,
  schema: z.ZodType | undefined,
  validationStatus: CruxPromptInputPreview['validationStatus'],
): CruxPromptInputPreview {
  const providedKeys = Object.keys(input).sort()
  if (!schema) {
    return {
      kind: 'prompt.input',
      promptId,
      validationStatus,
      providedKeys,
    }
  }
  const schemaKeys = promptInputSchemaKeys(schema)
  const requiredKeys = promptInputRequiredKeys(schema)
  const provided = new Set(providedKeys)
  const schemaKeySet = new Set(schemaKeys)
  return {
    kind: 'prompt.input',
    promptId,
    validationStatus,
    providedKeys,
    schemaKeys,
    requiredKeys,
    missingKeys: requiredKeys.filter((key) => !provided.has(key)),
    unexpectedKeys: providedKeys.filter((key) => !schemaKeySet.has(key)),
  }
}

/** Emit the security-warning report for suspicious prompt input. */
export function emitSecurityWarningSpan(input: {
  promptId: string
  field: string
  pattern: string
  message: string
  inputPreview: string
}): void {
  const span = observe.openSpan({
    name: 'security.warning',
    family: 'security',
    primitive: 'security.warning',
    attributes: {
      promptId: input.promptId,
      field: input.field,
      pattern: input.pattern,
      inputPreview: input.inputPreview,
    },
  })
  span.withContext(() => {
    const artifactId = observe.artifact({
      kind: 'security.report',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        kind: 'security.report',
        severity: 'warn',
        promptId: input.promptId,
        field: input.field,
        pattern: input.pattern,
        location: input.field,
        action: 'warn',
        message: input.message,
        preview: input.inputPreview,
      },
      attributes: {
        primitive: 'security.warning',
        promptId: input.promptId,
        field: input.field,
        pattern: input.pattern,
      },
    })
    if (!artifactId) return
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: span.spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { primitive: 'security.warning', pattern: input.pattern },
    })
  })
  span.end({
    promptId: input.promptId,
    field: input.field,
    pattern: input.pattern,
  })
}
