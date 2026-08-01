/**
 * Request-time preparation of generated representation rungs.
 *
 * @module
 */

import type { GenerateHistorySummary } from "../artifacts/lifecycle";
import {
  findSourceSummaryArtifact,
  scheduleSourceSummaryArtifact,
  sourceSummaryArtifact,
} from "../artifacts/source-lifecycle";
import type { ResolvedRepresentationPolicy } from "./ladder-types";
import type { CallArgs } from "../../adapter/types";
import { countTokens } from "../../shared/tokenizer";
import { prepareOffload } from "../offload/publish";

/** Prepare summary rungs that are required for the current strict limit. @internal */
export async function prepareRepresentationPolicies(input: {
  readonly policies: readonly ResolvedRepresentationPolicy[];
  readonly provider: string;
  readonly model: string;
  readonly responseModel?: unknown;
  readonly fullInputTokens: number;
  readonly max: number;
  readonly optimizeAt: number;
  readonly generate?: GenerateHistorySummary;
  readonly request: CallArgs<Record<string, unknown>>;
}): Promise<readonly ResolvedRepresentationPolicy[]> {
  return Promise.all(
    input.policies.map(async (policy) => {
      let prepared = policy;
      if (!policy.summary || !input.generate) {
        prepared = policy;
      } else {
        const model =
          policy.summary.model ??
          input.responseModel ??
          input.model;
        const artifactInput = {
          sourceTexts: policy.summary.sourceTexts,
          ...(policy.summary.sourceDigests
            ? { sourceDigests: policy.summary.sourceDigests }
            : {}),
          strategy: policy.summary.strategy,
          provider: input.provider,
          model: modelIdentity(model),
          generationModel: model,
          generate: input.generate,
        };
        try {
          let artifact = await findSourceSummaryArtifact(artifactInput);
          if (!artifact && input.fullInputTokens > input.max) {
            artifact = await sourceSummaryArtifact(artifactInput);
          } else if (
            !artifact &&
            input.fullInputTokens > input.optimizeAt
          ) {
            if (!scheduleSourceSummaryArtifact(artifactInput)) {
              await sourceSummaryArtifact(artifactInput);
            }
          }
          prepared = artifact
            ? withSummaryArtifact(policy, artifact)
            : policy;
        } catch {
          prepared = policy;
        }
      }
      if (!prepared.offload) return prepared;
      const toolLessStructured =
        !!input.request.outputSchema &&
        (input.request.tools?.every((tool) =>
          prepared.supportToolNames?.includes(tool.name)
        ) ?? true);
      const serializedTokens = countTokens(
        typeof prepared.offload.value === "string"
          ? prepared.offload.value
          : JSON.stringify(prepared.offload.value),
      );
      if (
        toolLessStructured ||
        (!prepared.offload.forced &&
          prepared.offload.options.aboveTokens !== undefined &&
          serializedTokens <= prepared.offload.options.aboveTokens)
      ) {
        return prepared;
      }
      const offload = prepareOffload(prepared.offload.value);
      if (!offload) return prepared;
      return Object.freeze({
        ...prepared,
        rungs: Object.freeze(
          prepared.rungs.map((rung) =>
            rung.kind === "offload"
              ? Object.freeze({
                  ...rung,
                  text: offload.text,
                  available: true,
                  publish: offload.publish,
                  validate: offload.validate,
                })
              : rung,
          ),
        ),
      });
    }),
  );
}

/** Reuse existing derived artifacts without creating or scheduling work. @internal */
export async function observeRepresentationPolicies(input: {
  readonly policies: readonly ResolvedRepresentationPolicy[];
  readonly provider: string;
  readonly model: string;
}): Promise<readonly ResolvedRepresentationPolicy[]> {
  return Promise.all(
    input.policies.map(async (policy) => {
      if (!policy.summary) return policy;
      const model = policy.summary.model ?? input.model;
      const artifact = await findSourceSummaryArtifact({
        sourceTexts: policy.summary.sourceTexts,
        ...(policy.summary.sourceDigests
          ? { sourceDigests: policy.summary.sourceDigests }
          : {}),
        strategy: policy.summary.strategy,
        provider: input.provider,
        model: modelIdentity(model),
      });
      return artifact ? withSummaryArtifact(policy, artifact) : policy;
    }),
  );
}

/**
 * Materialize size-only placeholders for unavailable prospective rungs.
 *
 * The returned policies contain no publication or validation callbacks and
 * therefore cannot be dispatched. They exist only for observational fit
 * classification.
 *
 * @internal
 */
export function prospectiveRepresentationPolicies(
  policies: readonly ResolvedRepresentationPolicy[],
): readonly ResolvedRepresentationPolicy[] {
  return policies.map((policy) =>
    Object.freeze({
      ...policy,
      rungs: Object.freeze(
        policy.rungs.map((rung) => {
          if (rung.available) return rung;
          if (rung.kind === "summary") {
            return Object.freeze({
              ...rung,
              available: true,
              text: "[Unprepared summary]",
              messages:
                policy.lowerBoundMessages ??
                Object.freeze([{
                  role: "assistant" as const,
                  content: "[Unprepared historical summary]",
                }]),
            });
          }
          if (rung.kind === "offload") {
            return Object.freeze({
              ...rung,
              available: true,
              text: "[Unprepared exact-recovery reference]",
            });
          }
          return rung;
        }),
      ),
    }),
  );
}

function withSummaryArtifact(
  policy: ResolvedRepresentationPolicy,
  artifact: Awaited<ReturnType<typeof sourceSummaryArtifact>>,
): ResolvedRepresentationPolicy {
  return Object.freeze({
    ...policy,
    rungs: Object.freeze(
      policy.rungs.map((rung) =>
        rung.kind === "summary"
          ? Object.freeze({
              ...rung,
              text: artifact.summary,
              available: true,
              ...(artifact.supportRequestId
                ? { supportRequestId: artifact.supportRequestId }
                : {}),
              ...(artifact.supportRequestIds
                ? { supportRequestIds: artifact.supportRequestIds }
                : {}),
            })
          : rung,
      ),
    ),
  });
}

function modelIdentity(model: unknown): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const value = model as {
      readonly modelId?: unknown;
      readonly id?: unknown;
    };
    if (typeof value.modelId === "string") return value.modelId;
    if (typeof value.id === "string") return value.id;
  }
  return String(model);
}
