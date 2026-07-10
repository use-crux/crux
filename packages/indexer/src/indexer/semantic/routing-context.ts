import type { RoutingFacts } from "@use-crux/core/project-index";
import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "./candidates";
import { resolveSemanticExpression, unwrapExpression } from "./model";

/** Routing context facts shared by the semantic and native-direct projectors. */
export type RoutingContextFacts = Pick<
  RoutingFacts,
  "routingContextRequired" | "routingContextType"
>;

/**
 * Extracts the non-empty `RouteArgs` context type used by one routing callback.
 *
 * The type display comes from the selected semantic compiler backend. This
 * keeps TypeScript and TypeScript-Go evidence aligned without exposing either
 * compiler's AST or checker through the Project Index contract.
 */
export function routingContextFactsForCallback(
  callback: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): RoutingContextFacts | undefined {
  const functionNode = routingCallbackFunction(callback, view);
  if (!functionNode) return undefined;

  const parameter = view.syntax
    .children(functionNode)
    .find((node) => view.syntax.isKind(node, "parameter"));
  if (!parameter) return undefined;

  const context = findContextBinding(parameter, view);
  if (!context) return undefined;
  const type = view.typesAt([context])[0];
  const compilerContextType = type
    ? canonicalRoutingContextType(view.typeStrings([type], context)[0])
    : undefined;
  const routeArgsContextType = routeArgsContextTypeArgument(parameter, view);
  const contextType = isRouteArgsWrapper(compilerContextType)
    ? routeArgsContextType ?? compilerContextType
    : compilerContextType ?? routeArgsContextType;
  return contextType && contextType !== "object"
    ? { routingContextType: contextType, routingContextRequired: true }
    : undefined;
}

/** Normalizes backend-specific string-literal quoting in compiler type displays. */
function canonicalRoutingContextType(type: string | undefined): string | undefined {
  const quoted = type?.replace(/'((?:\\.|[^'\\])*)'/g, (_match, literal: string) =>
    `"${literal.replace(/"/g, '\\"')}"`,
  );
  if (!quoted?.startsWith("{") || !quoted.endsWith("}")) return quoted;
  const beforeClosingBrace = quoted.slice(0, -1).trimEnd();
  return beforeClosingBrace === "{" || beforeClosingBrace.endsWith(";")
    ? quoted
    : `${beforeClosingBrace}; }`;
}

function routingCallbackFunction(
  callback: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const expression = unwrapExpression(callback, view);
  if (view.syntax.isFunctionLike(expression)) return expression;
  const resolved = resolveSemanticExpression(expression, view);
  if (resolved?.declaration && view.syntax.isFunctionLike(resolved.declaration))
    return resolved.declaration;
  return resolved?.expression && view.syntax.isFunctionLike(resolved.expression)
    ? resolved.expression
    : undefined;
}

function findContextBinding(
  root: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  if (view.syntax.identifierText(root) === "context") return root;
  for (const child of view.syntax.children(root)) {
    const context = findContextBinding(child, view);
    if (context) return context;
  }
  return undefined;
}

/** Preserves an authored `RouteArgs<TContext>` argument when the import is unresolved. */
function routeArgsContextTypeArgument(
  parameter: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  const reference = view.syntax.parameterTypeReference(parameter);
  const context = reference?.name === "RouteArgs" ? reference.arguments[0] : undefined;
  return context ? canonicalRoutingContextType(view.syntax.text(context)) : undefined;
}

function isRouteArgsWrapper(type: string | undefined): boolean {
  return type?.startsWith("RouteArgs<") ?? false;
}
