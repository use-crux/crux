import { PRIMITIVE_EVIDENCE_COVERAGE } from "./index";
import {
  renderPrimitiveEvidenceCoverageJson,
  renderPrimitiveEvidenceCoverageMarkdown,
} from "./render";

const rows = Object.values(PRIMITIVE_EVIDENCE_COVERAGE);

export const generatedPrimitiveEvidenceCoverage = Object.freeze({
  json: renderPrimitiveEvidenceCoverageJson(rows),
  markdown: renderPrimitiveEvidenceCoverageMarkdown(rows),
});
