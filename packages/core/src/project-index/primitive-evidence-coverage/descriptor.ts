import { CRUX_PRIMITIVE_FAMILY_BY_NAME } from "../../observability";
import type { EvidenceRole } from "../../evidence";
import type {
  PrimitiveEvidenceCoverageDescriptor,
  PrimitiveEvidenceCoverageInput,
} from "./types";

const roles = [
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const satisfies readonly EvidenceRole[];

/** Builds one complete audit row without performing runtime projection. */
export function primitiveEvidenceCoverage(
  input: PrimitiveEvidenceCoverageInput,
): PrimitiveEvidenceCoverageDescriptor {
  const nativeRoles = new Set(input.nativeRoles ?? []);
  const automaticRoles = input.automaticRoles ?? {};
  const blockedRoles = input.blockedRoles ?? {};
  const notApplicableRoles = new Set(input.notApplicableRoles ?? []);
  const automaticRoleNames = new Set(
    Object.keys(automaticRoles) as EvidenceRole[],
  );
  const blockedRoleNames = new Set(Object.keys(blockedRoles) as EvidenceRole[]);
  for (const role of automaticRoleNames) nativeRoles.delete(role);
  for (const role of blockedRoleNames) nativeRoles.delete(role);
  const planned = nativeRoles.size > 0;
  const automatic = automaticRoleNames.size > 0;
  const blocked = blockedRoleNames.size > 0;
  const blockers = Object.freeze([
    ...new Set([
      ...(planned
        ? ["https://github.com/use-crux/crux/issues/287#native-producers"]
        : []),
      ...Object.values(blockedRoles).filter(
        (value): value is string => value !== undefined,
      ),
    ]),
  ]);
  const descriptor: PrimitiveEvidenceCoverageDescriptor = {
    name: input.name,
    family: CRUX_PRIMITIVE_FAMILY_BY_NAME[input.name],
    participation: input.participation,
    roles: Object.freeze(
      Object.fromEntries(
        roles.map((role) => [
          role,
          automaticRoleNames.has(role)
            ? "automatic"
            : blockedRoleNames.has(role)
              ? "blocked"
              : nativeRoles.has(role)
                ? "native-planned"
                : notApplicableRoles.has(role)
                  ? "not-applicable"
                  : "advanced-custom",
        ]),
      ) as Record<
        EvidenceRole,
        | "automatic"
        | "blocked"
        | "native-planned"
        | "not-applicable"
        | "advanced-custom"
      >,
    ),
    ...(automatic
      ? { automaticRoles: Object.freeze({ ...automaticRoles }) }
      : {}),
    ...(blocked ? { blockedRoles: Object.freeze({ ...blockedRoles }) } : {}),
    nativeEvidence: Object.freeze({
      status:
        automatic && (planned || blocked)
          ? "partial"
          : automatic
            ? "automatic"
            : planned && blocked
              ? "partial"
              : planned
                ? "planned"
                : blocked
                  ? "blocked"
                  : "custom-only",
      ...(blockers.length > 0 ? { blockers } : {}),
    }),
    runtimeDurability: "local-durable",
    otelPolicy: "closed-allowlist",
    devtoolsRenderer:
      "packages/devtools/ui/src/features/run-detail/evidence/EvidencePanel.tsx",
    conformanceTest: "packages/core/__tests__/evidence/record-inspect.test.ts",
    owner: "https://github.com/use-crux/crux/issues/287",
    interimBehavior:
      automatic && (planned || blocked)
        ? "Listed automatic roles are shipped; planned or dependency-blocked native roles remain explicit."
        : planned
          ? "Advanced custom authoring works durably; automatic native evidence remains pending."
          : blocked
            ? "Advanced custom authoring works durably; blocked native roles require the linked dependency."
            : automatic
              ? "Listed native roles are authored automatically; other roles remain available to advanced custom authors."
              : "Advanced custom authoring is supported; no automatic native producer is promised.",
  };
  return Object.freeze(descriptor);
}
