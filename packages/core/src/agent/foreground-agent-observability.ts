import { observe } from "../observability";
import { agentDefinitionRef } from "../observability/definition-ref";
import type { AnyAgent } from "./agent";

/** Observe one foreground Agent Tool child without projecting execution content. */
export async function observeForegroundAgentRun<T>(
  agent: AnyAgent,
  run: () => Promise<T>,
): Promise<T> {
  const span = observe.openSpan({
    name: agent.id,
    primitive: "agent.run",
    attributes: { agentId: agent.id },
    definitionRefs: [agentDefinitionRef(agent.id)],
  });

  try {
    const result = await span.withContext(run);
    span.end({ attributes: { agentId: agent.id } });
    return result;
  } catch (error) {
    span.error(error);
    throw error;
  }
}
