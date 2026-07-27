import type { EvalRunnerCore } from "../eval-core-bridge";

type EvalDefinition = ReturnType<
  EvalRunnerCore["getEvalDefinitionForInternalUse"]
>;
type AuthoredTimeout = EvalDefinition["timeout"];

interface CatalogCase {
  readonly id: string;
  readonly origin: string;
  readonly authored: { readonly timeout?: AuthoredTimeout };
  readonly unvalidatedExpected: boolean;
}

function projectTimeout(
  core: EvalRunnerCore,
  inherited: AuthoredTimeout,
  authored: AuthoredTimeout,
) {
  const effective = core.projectResolvedEvalTimeoutPolicy(
    core.resolveEvalTimeoutPolicy(inherited, authored),
  );
  if (authored === undefined && Object.keys(effective).length === 0) {
    return undefined;
  }
  return Object.freeze({
    ...(authored === undefined ? {} : { authored }),
    effective,
  });
}

/**
 * Project one hydrated Eval into its JSON-safe catalog timeout read model.
 *
 * @param core - Project-local Core instance that owns timeout resolution.
 * @param definition - Normalized inert Eval definition.
 * @param cases - Hydrated inline and file-backed Cases in catalog order.
 * @returns The optional Eval projection and safe Case catalog rows.
 * @internal
 */
export function projectEvalCatalogTimeouts(
  core: EvalRunnerCore,
  definition: EvalDefinition,
  cases: readonly CatalogCase[],
) {
  const timeout = projectTimeout(core, undefined, definition.timeout);
  return Object.freeze({
    ...(timeout === undefined ? {} : { timeout }),
    cases: Object.freeze(
      cases.map((item) => {
        const caseTimeout = projectTimeout(
          core,
          definition.timeout,
          item.authored.timeout,
        );
        return Object.freeze({
          id: item.id,
          origin: item.origin,
          ...(item.unvalidatedExpected
            ? { unvalidatedExpected: true as const }
            : {}),
          ...(caseTimeout === undefined ? {} : { timeout: caseTimeout }),
        });
      }),
    ),
  });
}
