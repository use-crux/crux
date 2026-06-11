import ts from 'typescript'
import type { ProjectSourceRef } from '@crux/core/project-index'
import { helperSourceRefsForNode, projectSourceRef, resolveIdentifierSourceNode } from '../ast/source-refs'
import type { StaticCallContext } from '../extractors/types'
import {
  primitiveDataAccessRefs,
  primitiveDataAccessRefsWithHelpers,
  type PrimitiveDataAccessRef,
} from '../extractors/data-access'

/**
 * Source-local flow step evidence returned by the internal flow traversal facade.
 *
 * This keeps parser-owned TypeScript traversal details out of the flow extractor while preserving the
 * index data flow needs: step labels, target variables, callback source refs, and visible data access.
 */
export interface InternalFlowStepRef {
  readonly name: string
  readonly targetVariable?: string
  readonly dataAccesses: readonly PrimitiveDataAccessRef[]
  readonly sourceRefs: readonly ProjectSourceRef[]
}

/**
 * Source-local flow suspension evidence returned by the internal flow traversal facade.
 *
 * Suspensions are associated with the most recently discovered step when possible, matching the
 * existing source-order semantics used by flow relation projection.
 */
export interface InternalFlowSuspensionRef {
  readonly signal: string
  readonly stepName?: string
}

/** Immutable traversal result for the parts of `flow(...)` that still need parser-owned source walks. */
export interface InternalFlowTraversalResult {
  readonly steps: readonly InternalFlowStepRef[]
  readonly suspensions: readonly InternalFlowSuspensionRef[]
}

/**
 * Discovers flow steps and suspension points through a compiler-owned traversal facade.
 *
 * The returned value is deliberately index-facing and immutable. Raw TypeScript nodes stay inside
 * this module so the flow extractor can reason in terms of step evidence instead of visitors.
 */
export function internalFlowTraversal(ctx: StaticCallContext, flowDefinitionKey: string): InternalFlowTraversalResult {
  if (!ts.isCallExpression(ctx.call)) {
    return { steps: [], suspensions: [] }
  }
  const call = ctx.call
  const steps = flowStepRefs(ctx, flowDefinitionKey, call)
  const stepNames = [...new Set(steps.map((step) => step.name))]
  return {
    steps,
    suspensions: flowSuspensionRefs(call, stepNames[stepNames.length - 1]),
  }
}

/** Collects ordered flow step calls from either object-style handlers or positional flow callbacks. */
function flowStepRefs(
  ctx: StaticCallContext,
  flowDefinitionKey: string,
  call: ts.CallExpression,
): readonly InternalFlowStepRef[] {
  return flowTraversalRoots(call).flatMap((root) => collectFlowStepRefs(ctx, flowDefinitionKey, root))
}

/** Recursively collects flow step calls below one traversal root. */
function collectFlowStepRefs(
  ctx: StaticCallContext,
  flowDefinitionKey: string,
  node: ts.Node,
): readonly InternalFlowStepRef[] {
  const current = flowStepRefForCall(ctx, flowDefinitionKey, node)
  return [
    ...(current ? [current] : []),
    ...childrenOf(node).flatMap((child) => collectFlowStepRefs(ctx, flowDefinitionKey, child)),
  ]
}

/** Converts one `step.step("name", target)` call into flow step evidence when it is statically visible. */
function flowStepRefForCall(
  ctx: StaticCallContext,
  flowDefinitionKey: string,
  node: ts.Node,
): InternalFlowStepRef | undefined {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'step'
  ) {
    return undefined
  }
  const firstArg = node.arguments[0]
  if (!firstArg || !ts.isStringLiteralLike(firstArg)) return undefined
  const targetArg = node.arguments[1]
  const stepDefinitionId = `flow.step:${ctx.safeId(flowDefinitionKey)}:${ctx.safeId(firstArg.text)}`
  const resolved =
    targetArg && ts.isIdentifier(targetArg)
      ? resolveIdentifierSourceNode(ctx.root, ctx.file, ctx.sourceFile, targetArg.text, ctx.localInitializers)
      : undefined
  const sourceRefs = resolved
    ? [
        projectSourceRef({
          definitionId: stepDefinitionId,
          role: 'handler',
          property: 'step',
          resolved,
        }),
        ...helperSourceRefsForNode({
          definitionId: stepDefinitionId,
          root: ctx.root,
          file: resolved.sourceFile.fileName,
          sourceFile: resolved.sourceFile,
          node: resolved.node,
          localInitializers: resolved.localInitializers,
        }),
      ]
    : []
  const dataAccesses = resolved
    ? primitiveDataAccessRefsWithHelpers(resolved.node, resolved.sourceFile, {
        root: ctx.root,
        file: resolved.sourceFile.fileName,
        localInitializers: resolved.localInitializers,
      })
    : targetArg
      ? primitiveDataAccessRefs(targetArg, ctx.sourceFile)
      : []
  return {
    name: firstArg.text,
    targetVariable: targetArg && ts.isIdentifier(targetArg) ? targetArg.text : undefined,
    dataAccesses,
    sourceRefs,
  }
}

/** Collects signal waits/suspensions while preserving the previous source-order step association rule. */
function flowSuspensionRefs(
  initializer: ts.CallExpression,
  fallbackStepName: string | undefined,
): readonly InternalFlowSuspensionRef[] {
  const collected = flowTraversalRoots(initializer).reduce(
    (state, root) => collectSuspensions(root, state.currentStepName, fallbackStepName),
    { refs: [] as readonly InternalFlowSuspensionRef[], currentStepName: undefined as string | undefined },
  )
  return collected.refs
}

/** Recursively collects suspensions and carries the most recent step label through source-order traversal. */
function collectSuspensions(
  node: ts.Node,
  currentStepName: string | undefined,
  fallbackStepName: string | undefined,
): { readonly refs: readonly InternalFlowSuspensionRef[]; readonly currentStepName: string | undefined } {
  const nextStepName = flowStepName(node) ?? currentStepName
  const current = flowSuspensionForCall(node, nextStepName ?? fallbackStepName)
  return childrenOf(node).reduce(
    (state, child) => {
      const childState = collectSuspensions(child, state.currentStepName, fallbackStepName)
      return {
        refs: [...state.refs, ...childState.refs],
        currentStepName: childState.currentStepName,
      }
    },
    {
      refs: current ? [current] : [],
      currentStepName: nextStepName,
    } as { readonly refs: readonly InternalFlowSuspensionRef[]; readonly currentStepName: string | undefined },
  )
}

/** Returns the step label for a `step(...)` call when present. */
function flowStepName(node: ts.Node): string | undefined {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'step'
  ) {
    return undefined
  }
  const firstArg = node.arguments[0]
  return firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text : undefined
}

/** Returns signal evidence for `waitFor(...)` or `suspend(...)` calls. */
function flowSuspensionForCall(node: ts.Node, stepName: string | undefined): InternalFlowSuspensionRef | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined
  const method = node.expression.name.text
  const firstArg = node.arguments[0]
  if ((method !== 'waitFor' && method !== 'suspend') || !firstArg || !ts.isStringLiteralLike(firstArg)) return undefined
  return { signal: firstArg.text, stepName }
}

/** Returns source roots that may contain flow step or suspension calls. */
function flowTraversalRoots(initializer: ts.CallExpression): readonly ts.Node[] {
  const objectArg = initializer.arguments[0]
  if (objectArg && ts.isObjectLiteralExpression(objectArg)) {
    const handler = objectArg.properties.find(
      (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'handler',
    )
    return handler ? [handler.initializer] : []
  }
  return [...initializer.arguments.slice(1)]
}

/**
 * Returns direct TypeScript children as immutable values.
 *
 * This is the contained callback-to-value bridge for flow traversal; callers only receive normalized
 * flow evidence.
 */
function childrenOf(node: ts.Node): readonly ts.Node[] {
  let children: readonly ts.Node[] = []
  ts.forEachChild(node, (child) => {
    children = [...children, child]
  })
  return children
}

/** Converts supported TypeScript property names into stable string keys for internal handler lookup. */
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}
