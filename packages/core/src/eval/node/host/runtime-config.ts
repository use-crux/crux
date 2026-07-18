import type { RuntimeEngineDefinition } from "../../../runtime/api/runtime-definition";
import { loadProjectEvalSettings } from "../project-settings";

/** Load the project's one selected Runtime declaration through its normal module cache. */
export async function loadSelectedRuntimeDefinition(
  projectRoot: string,
): Promise<RuntimeEngineDefinition | undefined> {
  return (await loadProjectEvalSettings(projectRoot)).runtime;
}
