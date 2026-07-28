/** Definition identity projection for first-party factory call expressions. */

import type { SemanticTarget } from "../candidates";
import { semanticStringLiteralProperty } from "../syntax-readers";
import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "../candidates";
import { safeId } from "../../definitions";

/**
 * Resolve the definition created by a recognized factory call.
 *
 * The caller proves the call and object-literal shape; this function owns the
 * closed call-name-to-definition-kind mapping shared by semantic backends.
 */
export function semanticDefinitionTargetForCall(
  callName: string | undefined,
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  variableName: string | undefined,
  view: SemanticAnalyzerView,
): SemanticTarget | undefined {
  switch (callName) {
    case "prompt":
      return target(
        "prompt",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "context":
      return target(
        "context",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "mcp":
      return target(
        "mcp.server",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "injectable":
      return target(
        "injectable",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "guardrail":
      return target(
        "guardrail",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "constraint":
      return target(
        "constraint",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "tool":
    case "createTool": {
      const name =
        semanticStringLiteralProperty(object, "name", view.syntax) ??
        semanticStringLiteralProperty(object, "title", view.syntax) ??
        variableName;
      return target("tool", name);
    }
    case "agent":
    case "convexAgent":
      return target(
        "agent",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          semanticStringLiteralProperty(object, "name", view.syntax) ??
          variableName,
      );
    case "memory":
      return target(
        "memory",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "blackboard":
      return target(
        "blackboard",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "workspace":
      return target(
        "workspace",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "flow":
    case "cruxFlow":
      return target(
        "flow",
        semanticStringLiteralProperty(object, "name", view.syntax) ??
          variableName,
      );
    case "parallel":
      return target("composition.parallel", variableName);
    case "pipeline":
      return target("composition.pipeline", variableName);
    case "swarm":
      return target("composition.swarm", variableName);
    case "consensus":
      return target("composition.consensus", variableName);
    case "router":
      return target(
        "routing.router",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "split":
      return target(
        "routing.split",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "retry":
      return target(
        "routing.retry",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    case "cascade":
      return target(
        "routing.cascade",
        semanticStringLiteralProperty(object, "id", view.syntax) ??
          variableName,
      );
    default:
      return undefined;
  }
}

function target(
  kind: SemanticTarget["kind"],
  name: string | undefined,
): SemanticTarget {
  return { id: `${kind}:${safeId(name ?? "anonymous")}`, kind };
}
