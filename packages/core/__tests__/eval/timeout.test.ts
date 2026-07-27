import { describe } from "vitest";

import { cellDeadlineBehavior } from "./cell-deadline.behavior";
import { cellObservabilityBehavior } from "./cell-observability.behavior";
import { nestedTimeoutBehavior } from "./nested-timeout.behavior";
import { opaqueTimeoutContextBehavior } from "./opaque-timeout-context.behavior";
import { timeoutQuarantineBehavior } from "./timeout-quarantine.behavior";

describe("Eval cell timeout", () => {
  cellDeadlineBehavior();
  cellObservabilityBehavior();
  nestedTimeoutBehavior();
  opaqueTimeoutContextBehavior();
  timeoutQuarantineBehavior();
});
