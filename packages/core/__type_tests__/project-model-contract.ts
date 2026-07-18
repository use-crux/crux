import { expectTypeOf } from "vitest";
import {
  PROJECT_MODEL_DIAGNOSTIC_CODES,
  PROJECT_MODEL_RESOLUTION_MODES,
  createProjectModelDefinitionId,
  createProjectModelDiagnosticId,
  createProjectModelRelationId,
  isProjectModelDiagnosticCode,
  isProjectModelProvenance,
  isProjectModelResolutionMode,
} from "../src/project-index";
import type {
  ProjectModelDefinitionId,
  ProjectModelDiagnosticCode,
  ProjectModelDiagnosticId,
  ProjectModelField,
  ProjectModelProvenance,
  ProjectModelResolutionMode,
  ProjectModelRelationId,
  ResolvedProjectModel,
} from "../src/project-index";

function describeProvenance(provenance: ProjectModelProvenance): string {
  switch (provenance.kind) {
    case "source":
      return provenance.exportName === undefined
        ? provenance.file
        : `${provenance.file}#${provenance.exportName}`;
    case "runtime":
      return provenance.traceId === undefined
        ? provenance.attribute
        : `${provenance.traceId}:${provenance.attribute}`;
    case "filesystem":
      return `${provenance.convention}:${provenance.path}`;
    case "config":
      return `${provenance.path}:${provenance.key}`;
    case "cli":
      return provenance.flag;
    default: {
      const exhaustive: never = provenance;
      return exhaustive;
    }
  }
}

function describeDiagnosticCode(code: ProjectModelDiagnosticCode): string {
  switch (code) {
    case "project_model.dynamic_tool_map_unproven":
      return "dynamic tool map";
    case "project_model.missing_stable_id":
      return "missing stable id";
    case "project_model.model_executor_missing":
      return "model executor missing";
    case "project_model.source_skipped":
      return "source skipped";
    case "project_model.source_only_discovery":
      return "source-only discovery";
    case "project_model.config_import_failed":
      return "config import failed";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

function describeResolutionMode(mode: ProjectModelResolutionMode): string {
  switch (mode) {
    case "source-only":
      return "source-only";
    case "config-policy":
      return "config-policy";
    case "semantic":
      return "semantic";
    case "runtime-rich":
      return "runtime-rich";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

const definitionId = createProjectModelDefinitionId(
  "definition:prompt:greeting",
);
const relationId = createProjectModelRelationId(
  "relation:prompt.uses_context:prompt:greeting:context:locale",
);
const diagnosticId = createProjectModelDiagnosticId("diagnostic:source-only");

const sameDefinitionId: ProjectModelDefinitionId = definitionId;
const sameRelationId: ProjectModelRelationId = relationId;
const sameDiagnosticId: ProjectModelDiagnosticId = diagnosticId;

// @ts-expect-error plain strings must not cross the Project Model boundary as definition ids.
const invalidDefinitionId: ProjectModelDefinitionId =
  "definition:prompt:greeting";

// @ts-expect-error relation ids are branded separately from definition ids.
const invalidRelationId: ProjectModelRelationId = definitionId;

// @ts-expect-error diagnostic ids are branded separately from definition ids.
const invalidDiagnosticId: ProjectModelDiagnosticId = definitionId;

const root: ProjectModelField<string> = {
  value: "/repo",
  provenance: {
    kind: "filesystem",
    path: "/repo/package.json",
    convention: "nearest-package-root",
  },
};

const model: ResolvedProjectModel = {
  root,
  resolutionMode: {
    value: "source-only",
    provenance: { kind: "runtime", attribute: "project-model.resolutionMode" },
  },
  packageName: {
    value: "@acme/project",
    provenance: {
      kind: "filesystem",
      path: "/repo/package.json",
      convention: "package-json-name",
    },
  },
  configFiles: [],
  sourceRoots: [root],
  ignoredPaths: [],
  definitions: [
    {
      id: definitionId,
      kind: "prompt",
      name: {
        value: "greeting",
        provenance: {
          kind: "source",
          file: "/repo/src/prompts.ts",
          exportName: "greeting",
        },
      },
      path: {
        value: ["support", "greeting"],
        provenance: {
          kind: "source",
          file: "/repo/src/prompts.ts",
          exportName: "greeting",
        },
      },
      visibility: {
        value: "inferred",
        provenance: { kind: "source", file: "/repo/src/prompts.ts" },
      },
    },
  ],
  relations: [
    {
      id: relationId,
      type: "prompt.uses_context",
      from: definitionId,
      to: createProjectModelDefinitionId("context:locale"),
      visibility: {
        value: "inferred",
        provenance: {
          kind: "source",
          file: "/repo/src/prompts.ts",
          exportName: "greeting",
        },
      },
    },
  ],
  diagnostics: [
    {
      id: diagnosticId,
      code: "project_model.source_only_discovery",
      severity: "info",
      message: "Crux is using source discovery only.",
      provenance: {
        kind: "filesystem",
        path: "/repo",
        convention: "no-config-source-discovery",
      },
    },
  ],
};

expectTypeOf<
  (typeof PROJECT_MODEL_DIAGNOSTIC_CODES)[number]
>().toEqualTypeOf<ProjectModelDiagnosticCode>();
expectTypeOf(PROJECT_MODEL_DIAGNOSTIC_CODES).toMatchTypeOf<
  readonly ProjectModelDiagnosticCode[]
>();
expectTypeOf<
  (typeof PROJECT_MODEL_RESOLUTION_MODES)[number]
>().toEqualTypeOf<ProjectModelResolutionMode>();
expectTypeOf(PROJECT_MODEL_RESOLUTION_MODES).toMatchTypeOf<
  readonly ProjectModelResolutionMode[]
>();
expectTypeOf(model.root.provenance).toMatchTypeOf<ProjectModelProvenance>();
expectTypeOf(
  model.resolutionMode.value,
).toEqualTypeOf<ProjectModelResolutionMode>();

const unknownCode: unknown = "project_model.source_only_discovery";
if (isProjectModelDiagnosticCode(unknownCode)) {
  expectTypeOf(unknownCode).toEqualTypeOf<ProjectModelDiagnosticCode>();
}

const unknownProvenance: unknown = { kind: "cli", flag: "--cwd" };
if (isProjectModelProvenance(unknownProvenance)) {
  expectTypeOf(unknownProvenance).toEqualTypeOf<ProjectModelProvenance>();
}

const unknownMode: unknown = "config-policy";
if (isProjectModelResolutionMode(unknownMode)) {
  expectTypeOf(unknownMode).toEqualTypeOf<ProjectModelResolutionMode>();
}

void describeProvenance;
void describeDiagnosticCode;
void describeResolutionMode;
void sameDefinitionId;
void sameRelationId;
void sameDiagnosticId;
void invalidDefinitionId;
void invalidRelationId;
void invalidDiagnosticId;
void model;
